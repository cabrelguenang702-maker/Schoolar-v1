-- ============================================================================
-- SCHOOLAR — ÉTAPE 6 / N — Notes (section 11 + "Saisie intelligente des notes")
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - GradeController::computeClassSummary() (boucles PHP : moyenne pondérée,
--     rang avec ex-aequo, mention) devient une fonction SQL,
--     compute_class_sequence_summary(), qui renvoie directement le même
--     objet JSON que l'ancienne API. RANK() OVER (...) reproduit
--     exactement "les ex-aequo partagent le même rang" du PHP (pas
--     DENSE_RANK, qui aurait un comportement différent sur les sauts de
--     rang après une égalité).
--   - Cette fonction est SECURITY DEFINER (et non INVOKER) volontairement :
--     calculer le rang d'un élève exige de lire les notes de TOUTE la
--     classe, mais un parent ne doit voir que celles de son enfant. La
--     fonction contourne donc la RLS de la table `grades` en interne, après
--     avoir vérifié elle-même l'autorisation d'appel (reproduisant
--     assertClassSummaryAccess() ET assertStudentGradesAccess() réunies,
--     puisqu'elle sert les deux usages).
--   - GradeController::saveSheet() (boucle transactionnelle avec détection
--     d'anomalie ≥ 8 points, motif obligatoire, historique) devient
--     save_grade_sheet(), une fonction PL/pgSQL. Différence assumée et
--     documentée : le PHP d'origine n'ouvrait PAS de transaction autour de
--     la boucle (une erreur en cours de lot laissait les items précédents
--     déjà enregistrés) ; ici, l'appel RPC est atomique par nature
--     (transaction implicite) — une erreur annule tout le lot. C'est une
--     amélioration délibérée, pas un oubli.
--   - `security_alerts` (utilisée par AuditLogController::raise(), section
--     16) est introduite ici par nécessité (anomalies de notes) ; le reste
--     du module audit/sécurité (journal des connexions, etc.) sera complété
--     à l'étape "Sécurité avancée".
--   - Restent volontairement HORS PÉRIMÈTRE de cette étape (à ajouter plus
--     tard, sans impact sur ce qui suit) : studentTermSummary() (moyenne
--     trimestrielle agrégée) et l'envoi des résultats aux parents à la
--     validation — les deux nécessitent soit plus de temps de calcul (agrégation
--     multi-séquences), soit un envoi d'email (Edge Function) ; la
--     validation/dévalidation elle-même (avec le "force" si notes
--     manquantes) est en revanche livrée via l'Edge Function
--     grades-validate-sequence.
-- ============================================================================

insert into public.permissions (code, label_fr, label_en, category) values
    ('sequences.manage', 'Gérer les séquences d''évaluation', 'Manage grading sequences', 'academics')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('proviseur','principal','directeur') and p.code = 'sequences.manage'
on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'censeur'), (select id from public.permissions where code = 'sequences.manage')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 1. Séquences d'évaluation
-- ----------------------------------------------------------------------------
create table public.sequences (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    school_year_id    uuid not null references public.school_years(id) on delete cascade,
    term_label        varchar(40),
    label             varchar(40) not null,
    order_index       smallint not null default 1,
    created_at        timestamptz not null default now(),
    unique (establishment_id, school_year_id, label)
);
create index idx_sequences_establishment_year on public.sequences(establishment_id, school_year_id, order_index);

create trigger trg_sequences_audit
after insert or update on public.sequences
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 2. Notes
-- ----------------------------------------------------------------------------
create table public.grades (
    id                    uuid primary key default gen_random_uuid(),
    class_subject_id      uuid not null references public.class_subjects(id) on delete cascade,
    sequence_id           uuid not null references public.sequences(id) on delete cascade,
    student_id            uuid not null references public.students(id) on delete cascade,
    score                 numeric(5,2),
    max_score             numeric(5,2) not null default 20,
    entered_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    unique (class_subject_id, sequence_id, student_id),
    constraint grades_score_range check (score is null or (score >= 0 and score <= max_score))
);
create index idx_grades_lookup on public.grades(class_subject_id, sequence_id);
create index idx_grades_student on public.grades(student_id);

create trigger trg_grades_updated_at
before update on public.grades
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 3. Validation d'une séquence pour une classe
-- ----------------------------------------------------------------------------
create table public.class_sequence_validations (
    id                      uuid primary key default gen_random_uuid(),
    class_id                uuid not null references public.classes(id) on delete cascade,
    sequence_id             uuid not null references public.sequences(id) on delete cascade,
    status                  varchar(20) not null default 'draft' check (status in ('draft','validated')),
    validated_by_profile_id uuid references public.profiles(id),
    validated_at            timestamptz,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now(),
    unique (class_id, sequence_id)
);

create trigger trg_class_sequence_validations_updated_at
before update on public.class_sequence_validations
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Alertes de sécurité (introduite ici pour les anomalies de notes —
--    complétée à l'étape "Sécurité avancée")
-- ----------------------------------------------------------------------------
create table public.security_alerts (
    id                      uuid primary key default gen_random_uuid(),
    establishment_id        uuid references public.establishments(id) on delete cascade, -- NULL = alerte plateforme (admin national)
    type                    varchar(60) not null,
    severity                varchar(20) not null default 'info' check (severity in ('info','warning','critical')),
    message                 text not null,
    entity_type             varchar(60),
    entity_id               varchar(60),
    triggered_by_profile_id uuid references public.profiles(id),
    acknowledged_by_profile_id uuid references public.profiles(id),
    acknowledged_at         timestamptz,
    created_at              timestamptz not null default now()
);
create index idx_security_alerts_establishment on public.security_alerts(establishment_id, created_at desc);
create index idx_security_alerts_unacknowledged on public.security_alerts(establishment_id, acknowledged_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.sequences enable row level security;
alter table public.grades enable row level security;
alter table public.class_sequence_validations enable row level security;
alter table public.security_alerts enable row level security;

create policy sequences_select on public.sequences for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy sequences_manage on public.sequences for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('sequences.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('sequences.manage'));

-- Notes : lecture réunissant toutes les vues d'origine (fiche de saisie,
-- résumé de classe, résumé élève/parent) ; écriture réservée à
-- assertSubjectEntryAccess() (direction, ou l'enseignant en charge de CETTE
-- matière de classe) — voir aussi save_grade_sheet() pour la logique fine
-- (verrouillage, anomalies) qu'une policy seule ne peut pas exprimer.
create policy grades_select on public.grades for select to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs
      join public.classes c on c.id = cs.class_id
      join public.students st on st.id = grades.student_id
      where cs.id = grades.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
          or st.profile_id = auth.uid()
          or exists (select 1 from public.student_parents sp where sp.student_id = st.id and sp.parent_id = auth.uid())
        )
    )
  );

create policy grades_manage on public.grades for all to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = grades.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = grades.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid())
    )
  );
-- NOTE : cette policy ne suffit pas à elle seule à reproduire saveSheet()
-- (verrouillage de séquence, motif obligatoire au-delà de 8 points d'écart,
-- historique + alerte). Utiliser save_grade_sheet() ci-dessous pour la
-- saisie réelle depuis le frontend ; un insert/update PostgREST brut reste
-- possible pour un usage avancé mais NE fait PAS ces contrôles fins.

create policy class_sequence_validations_select on public.class_sequence_validations for select to authenticated
  using (exists (select 1 from public.classes c where c.id = class_sequence_validations.class_id and c.establishment_id = public.my_establishment_id()));

-- L'écriture passe exclusivement par les fonctions/Edge Function de
-- validation (assertValidatorRole : proviseur/principal/directeur/censeur).
create policy class_sequence_validations_manage on public.class_sequence_validations for all to authenticated
  using (
    exists (select 1 from public.classes c where c.id = class_sequence_validations.class_id and c.establishment_id = public.my_establishment_id())
    and public.my_role_code() in ('proviseur','principal','directeur','censeur')
  )
  with check (
    exists (select 1 from public.classes c where c.id = class_sequence_validations.class_id and c.establishment_id = public.my_establishment_id())
    and public.my_role_code() in ('proviseur','principal','directeur','censeur')
  );

create policy security_alerts_select on public.security_alerts for select to authenticated
  using (
    (establishment_id is null and public.is_national_admin())
    or (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur'))
  );
create policy security_alerts_acknowledge on public.security_alerts for update to authenticated
  using (
    (establishment_id is null and public.is_national_admin())
    or (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur'))
  )
  with check (true);
-- Pas de policy INSERT : les alertes sont créées uniquement par des
-- fonctions SECURITY DEFINER (ex: save_grade_sheet ci-dessous).

-- ----------------------------------------------------------------------------
-- 5. save_grade_sheet() — remplace GradeController::saveSheet()
-- ----------------------------------------------------------------------------
create or replace function public.save_grade_sheet(
    p_class_subject_id uuid,
    p_sequence_id uuid,
    p_entries jsonb  -- [{ "student_id": "...", "score": 14.5, "reason": "..." }, ...]
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    v_class_id uuid;
    v_establishment_id uuid;
    v_teacher_id uuid;
    v_max_score numeric := 20;
    v_entry jsonb;
    v_student_id uuid;
    v_score numeric;
    v_reason text;
    v_existing_id uuid;
    v_existing_score numeric;
    v_new_id uuid;
    v_delta numeric;
    v_saved integer := 0;
    v_caller uuid := auth.uid();
    v_role text := public.my_role_code();
begin
    select c.id, c.establishment_id, cs.teacher_id
      into v_class_id, v_establishment_id, v_teacher_id
      from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = p_class_subject_id;

    if v_class_id is null or v_establishment_id is distinct from public.my_establishment_id() then
        raise exception 'class_subject_not_found';
    end if;
    if not (v_role in ('proviseur','principal','directeur') or v_teacher_id = v_caller) then
        raise exception 'grades_entry_denied';
    end if;
    if exists (
        select 1 from public.class_sequence_validations
        where class_id = v_class_id and sequence_id = p_sequence_id and status = 'validated'
    ) then
        raise exception 'grades_locked';
    end if;

    for v_entry in select * from jsonb_array_elements(p_entries) loop
        v_student_id := nullif(v_entry->>'student_id', '')::uuid;
        v_score := nullif(v_entry->>'score', '')::numeric;
        v_reason := trim(both from coalesce(v_entry->>'reason', ''));

        continue when v_student_id is null;

        if v_score is not null and (v_score < 0 or v_score > v_max_score) then
            raise exception 'grade_out_of_range';
        end if;
        if not exists (select 1 from public.students where id = v_student_id and class_id = v_class_id and status = 'active') then
            continue;
        end if;

        select id, score into v_existing_id, v_existing_score
          from public.grades
          where class_subject_id = p_class_subject_id and sequence_id = p_sequence_id and student_id = v_student_id;

        if v_existing_id is not null then
            if v_existing_score is not distinct from v_score then
                continue;
            end if;

            v_delta := case when v_existing_score is not null and v_score is not null
                            then abs(v_score - v_existing_score) else 0 end;
            if v_delta >= 8 and v_reason = '' then
                raise exception 'grade_change_reason_required (student_id: %)', v_student_id;
            end if;

            update public.grades set score = v_score, entered_by_profile_id = v_caller where id = v_existing_id;

            insert into public.audit_log (establishment_id, profile_id, action, entity_type, entity_id, details)
            values (v_establishment_id, v_caller, 'grade.updated', 'grade', v_existing_id,
                    jsonb_build_object('student_id', v_student_id, 'old_score', v_existing_score, 'new_score', v_score, 'reason', nullif(v_reason, '')));

            if v_delta >= 8 then
                insert into public.security_alerts (establishment_id, type, severity, message, entity_type, entity_id, triggered_by_profile_id)
                values (v_establishment_id, 'grade_anomaly', 'warning',
                        format('Variation de %s points sur une note déjà saisie (élève %s) — motif : %s', v_delta, v_student_id, v_reason),
                        'grade', v_existing_id, v_caller);
            end if;
        else
            insert into public.grades (class_subject_id, sequence_id, student_id, score, max_score, entered_by_profile_id)
            values (p_class_subject_id, p_sequence_id, v_student_id, v_score, v_max_score, v_caller)
            returning id into v_new_id;

            insert into public.audit_log (establishment_id, profile_id, action, entity_type, entity_id, details)
            values (v_establishment_id, v_caller, 'grade.created', 'grade', v_new_id,
                    jsonb_build_object('student_id', v_student_id, 'score', v_score));
        end if;

        v_saved := v_saved + 1;
    end loop;

    return v_saved;
end;
$$;
grant execute on function public.save_grade_sheet(uuid, uuid, jsonb) to authenticated;

-- ----------------------------------------------------------------------------
-- 6. compute_class_sequence_summary() — remplace
--    GradeController::computeClassSummary() (+ mention + rang)
-- ----------------------------------------------------------------------------
create or replace function public.compute_class_sequence_summary(p_class_id uuid, p_sequence_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid;
    v_role text := public.my_role_code();
    v_authorized boolean;
    v_result jsonb;
begin
    select establishment_id into v_establishment_id from public.classes where id = p_class_id;
    if v_establishment_id is null or v_establishment_id is distinct from public.my_establishment_id() then
        raise exception 'class_not_found';
    end if;

    -- Réunion d'assertClassSummaryAccess() (direction/PP/enseignant de la
    -- classe) et assertStudentGradesAccess() (parent/élève concerné) : cette
    -- fonction sert les deux usages (fiche de classe ET résumé individuel).
    select
        v_role in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
        or exists (select 1 from public.classes c where c.id = p_class_id and c.homeroom_teacher_id = auth.uid())
        or exists (select 1 from public.class_subjects cs where cs.class_id = p_class_id and cs.teacher_id = auth.uid())
        or exists (select 1 from public.students st where st.class_id = p_class_id and st.profile_id = auth.uid())
        or exists (
             select 1 from public.students st
             join public.student_parents sp on sp.student_id = st.id
             where st.class_id = p_class_id and sp.parent_id = auth.uid()
           )
    into v_authorized;

    if not v_authorized then
        raise exception 'class_access_denied';
    end if;

    with active_students as (
        select id, matricule, first_name, last_name
        from public.students where class_id = p_class_id and status = 'active'
    ),
    subj as (
        select id, coefficient from public.class_subjects where class_id = p_class_id
    ),
    per_student as (
        select
            s.id as student_id, s.matricule, s.first_name, s.last_name,
            sum(g.score * cs.coefficient) filter (where g.score is not null) as weighted_sum,
            sum(cs.coefficient) filter (where g.score is not null) as coeff_sum,
            count(g.score) filter (where g.score is not null) as entered_count
        from active_students s
        left join public.class_subjects cs on cs.class_id = p_class_id
        left join public.grades g on g.class_subject_id = cs.id and g.sequence_id = p_sequence_id and g.student_id = s.id
        group by s.id, s.matricule, s.first_name, s.last_name
    ),
    computed as (
        select *,
            case when coeff_sum > 0 then round(weighted_sum / coeff_sum, 2) end as average,
            (select count(*) from subj) - entered_count as missing_subjects
        from per_student
    ),
    ranks as (
        select student_id, rank() over (order by average desc) as rnk
        from computed where average is not null
    ),
    final as (
        select c.*, r.rnk as rank from computed c left join ranks r using (student_id)
    )
    select jsonb_build_object(
        'students', coalesce(jsonb_object_agg(student_id, jsonb_build_object(
            'student_id', student_id, 'matricule', matricule, 'first_name', first_name, 'last_name', last_name,
            'average', average,
            'mention', case when average is null then null
                            when average >= 14 then 'bien'
                            when average >= 10 then 'passable'
                            else 'insuffisant' end,
            'missing_subjects', missing_subjects,
            'rank', rank
        )), '{}'::jsonb),
        'class_size', (select count(*) from active_students),
        'total_subjects', (select count(*) from subj),
        'class_average', (select round(avg(average), 2) from final where average is not null),
        'missing_grades_count', (select coalesce(sum(greatest(missing_subjects, 0)), 0) from final),
        'locked', exists (
            select 1 from public.class_sequence_validations
            where class_id = p_class_id and sequence_id = p_sequence_id and status = 'validated'
        )
    ) into v_result
    from final;

    return v_result;
end;
$$;
grant execute on function public.compute_class_sequence_summary(uuid, uuid) to authenticated;
