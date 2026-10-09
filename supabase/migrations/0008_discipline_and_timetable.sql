-- ============================================================================
-- SCHOOLAR — ÉTAPE 8 / N — Discipline (section 15) & Emploi du temps (section 16)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Comme le PHP d'origine le corrigeait lui-même à cette étape : le
--     professeur principal doit pouvoir signaler un incident disciplinaire
--     (permission manquante depuis l'étape "Classes & matières").
--   - La détection de conflits d'emploi du temps (classe/enseignant/salle)
--     devient timetable_check_conflicts(), utilisée DEUX FOIS : en RPC
--     directe (pré-vérification côté frontend, retourne la liste détaillée
--     comme le PHP) ET dans un trigger BEFORE INSERT/UPDATE (garde-fou côté
--     base, en cas de contournement du pré-check) — même fonction, pas de
--     logique dupliquée.
--   - Le double contrôle "on ne peut pas résoudre un dossier déjà résolu" +
--     "resolved_by/resolved_at ne sont jamais dictés par le client" devient
--     un trigger (assertReportManageAccessByClassId reste, lui, une policy
--     RLS classique).
--   - L'historique des modifications d'emploi du temps (TimetableController::history())
--     lisait `audit_log` avec des droits plus larges (tout enseignant de la
--     classe) que ce que permet la policy générale d'audit_log (réservée à
--     audit.view, un permission de direction). Plutôt qu'élargir audit_log
--     pour tout le monde, une fonction dédiée SECURITY DEFINER
--     (timetable_history) applique EXACTEMENT assertClassViewAccess et
--     n'expose que les entrées "timetable_entry" — pas le reste du journal.
--   - L'opérateur JSON `->>'$.class_id'` (spécifique MySQL) redevient
--     `->>'class_id'` nativement.
--   - HORS PÉRIMÈTRE (reporté) : exportIcs() — génération de fichier .ics
--     pour la synchronisation Google/Apple Calendar. Nécessite une
--     génération de texte iCalendar (faisable en Edge Function le moment
--     venu, mais pas structurant pour la suite) ; la génération AUTOMATIQUE
--     complète de l'emploi du temps (optimisation sous contrainte) était
--     déjà explicitement hors périmètre du PHP d'origine.
-- ============================================================================

-- Correction (comme dans le PHP d'origine à cette même étape).
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'professeur_principal'),
       (select id from public.permissions where code = 'discipline.manage')
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 1. Signalements disciplinaires
-- ----------------------------------------------------------------------------
create table public.discipline_reports (
    id                      uuid primary key default gen_random_uuid(),
    establishment_id        uuid not null references public.establishments(id) on delete cascade,
    student_id              uuid not null references public.students(id) on delete cascade,
    class_id                uuid references public.classes(id) on delete set null,
    category                varchar(20) not null check (category in ('convocation','exclusion','retard','indiscipline','violence','fraude','avertissement')),
    description             text,
    incident_date           date not null default current_date,
    status                  varchar(20) not null default 'open' check (status in ('open','resolved')),
    resolution_note         text,
    resolved_by_profile_id  uuid references public.profiles(id),
    resolved_at             timestamptz,
    reported_by_profile_id  uuid references public.profiles(id),
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);
create index idx_discipline_reports_student on public.discipline_reports(student_id, created_at desc);
create index idx_discipline_reports_establishment on public.discipline_reports(establishment_id, status);

create trigger trg_discipline_reports_updated_at
before update on public.discipline_reports
for each row execute function public.set_updated_at();

create trigger trg_discipline_reports_audit
after insert or update on public.discipline_reports
for each row execute function public.log_audit_event();

-- Empêche de "re-résoudre" un dossier déjà résolu, et empêche le client de
-- dicter resolved_by/resolved_at (toujours déduits côté serveur).
create or replace function public.discipline_report_guard_resolve()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'resolved' and old.status = 'resolved' then
        raise exception 'discipline_already_resolved';
    end if;
    if new.status = 'resolved' and old.status <> 'resolved' then
        new.resolved_by_profile_id := auth.uid();
        new.resolved_at := now();
    end if;
    return new;
end;
$$;

create trigger trg_discipline_reports_guard_resolve
before update on public.discipline_reports
for each row execute function public.discipline_report_guard_resolve();

alter table public.discipline_reports enable row level security;

-- Lecture : réunit list()/show() (VIEW_ALL_ROLES + PP de la classe) et
-- studentHistory() (ajoute secretaire + parent) — pas d'accès élève
-- lui-même, comme dans le PHP d'origine (choix de confidentialité assumé).
create policy discipline_reports_select on public.discipline_reports for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','surveillant_secteur','secretaire')
      or exists (select 1 from public.classes c where c.id = discipline_reports.class_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = discipline_reports.student_id and sp.parent_id = auth.uid())
    )
  );

-- Création : FULL_ACCESS_ROLES (pas surveillant_secteur) ou PP de la classe
-- de l'élève — reproduit assertReportAccess().
create policy discipline_reports_insert on public.discipline_reports for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or (public.my_role_code() = 'professeur_principal' and exists (select 1 from public.classes c where c.id = class_id and c.homeroom_teacher_id = auth.uid()))
    )
  );

-- Résolution : reproduit assertReportManageAccessByClassId() — comme insert,
-- sans surveillant_secteur (lecture seule pour lui).
create policy discipline_reports_resolve on public.discipline_reports for update to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or (public.my_role_code() = 'professeur_principal' and exists (select 1 from public.classes c where c.id = discipline_reports.class_id and c.homeroom_teacher_id = auth.uid()))
    )
  )
  with check (establishment_id = public.my_establishment_id());

-- ----------------------------------------------------------------------------
-- 2. Emplois du temps
-- ----------------------------------------------------------------------------
create table public.timetable_entries (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    class_id              uuid not null references public.classes(id) on delete cascade,
    class_subject_id      uuid not null references public.class_subjects(id) on delete cascade,
    day_of_week           smallint not null check (day_of_week between 1 and 6),
    start_time            time not null,
    end_time              time not null,
    room                  varchar(60),
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    constraint tt_time_check check (end_time > start_time)
);
create index idx_timetable_establishment_day on public.timetable_entries(establishment_id, day_of_week);
create index idx_timetable_class_subject on public.timetable_entries(class_subject_id);
create index idx_timetable_class_day on public.timetable_entries(class_id, day_of_week);

create trigger trg_timetable_entries_updated_at
before update on public.timetable_entries
for each row execute function public.set_updated_at();

-- Audit dédié (pas le trigger générique) : on a besoin de conserver
-- class_id/subject_name/horaires dans `details`, exploités ensuite par
-- timetable_history() — le trigger générique log_audit_event() ne stocke
-- pas de `details`.
create or replace function public.timetable_log_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_row record := coalesce(new, old);
    v_subject_name text;
begin
    select s.name into v_subject_name from public.class_subjects cs join public.subjects s on s.id = cs.subject_id
      where cs.id = v_row.class_subject_id;

    insert into public.audit_log (establishment_id, profile_id, action, entity_type, entity_id, details)
    values (
        v_row.establishment_id, auth.uid(),
        'timetable.' || lower(TG_OP), 'timetable_entries', v_row.id::text,
        jsonb_build_object('class_id', v_row.class_id, 'subject_name', v_subject_name,
                            'day_of_week', v_row.day_of_week, 'start_time', v_row.start_time,
                            'end_time', v_row.end_time, 'room', v_row.room)
    );
    return v_row;
end;
$$;

create trigger trg_timetable_entries_audit
after insert or update or delete on public.timetable_entries
for each row execute function public.timetable_log_audit();

alter table public.timetable_entries enable row level security;

-- Lecture : assertClassViewAccess (direction/vie scolaire, PP, enseignant de
-- la matière) — sert classTimetable/history/myTimetable.
create policy timetable_entries_select on public.timetable_entries for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or exists (select 1 from public.classes c where c.id = timetable_entries.class_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.class_subjects cs where cs.id = timetable_entries.class_subject_id and cs.teacher_id = auth.uid())
    )
  );

-- Gestion : MANAGE_ROLES strict (pas surveillant_general, contrairement à la lecture).
create policy timetable_entries_manage on public.timetable_entries for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur'))
  with check (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur'));

-- ----------------------------------------------------------------------------
-- 3. timetable_check_conflicts() — remplace TimetableController::findConflicts()
--    Réutilisée par le trigger de garde-fou ci-dessous.
-- ----------------------------------------------------------------------------
create or replace function public.timetable_check_conflicts(
    p_establishment_id uuid, p_class_id uuid, p_teacher_id uuid,
    p_day smallint, p_start time, p_end time, p_room text, p_exclude_entry_id uuid default null
)
returns jsonb
language sql stable security invoker set search_path = public
as $$
    select coalesce(jsonb_agg(conflict), '[]'::jsonb) from (
        select jsonb_build_object('type', 'class', 'subject_name', s.name, 'start_time', te.start_time, 'end_time', te.end_time) as conflict
        from public.timetable_entries te
        join public.class_subjects cs on cs.id = te.class_subject_id
        join public.subjects s on s.id = cs.subject_id
        where te.class_id = p_class_id and te.day_of_week = p_day
          and te.start_time < p_end and te.end_time > p_start
          and (p_exclude_entry_id is null or te.id <> p_exclude_entry_id)

        union all

        select jsonb_build_object('type', 'teacher', 'subject_name', s.name,
                'class_label', trim(both ' ' from c.level || ' ' || coalesce(c.series, '') || ' ' || coalesce(c.section, '')),
                'start_time', te.start_time, 'end_time', te.end_time)
        from public.timetable_entries te
        join public.class_subjects cs on cs.id = te.class_subject_id
        join public.subjects s on s.id = cs.subject_id
        join public.classes c on c.id = te.class_id
        where p_teacher_id is not null and cs.teacher_id = p_teacher_id and te.establishment_id = p_establishment_id
          and te.day_of_week = p_day and te.start_time < p_end and te.end_time > p_start
          and (p_exclude_entry_id is null or te.id <> p_exclude_entry_id)

        union all

        select jsonb_build_object('type', 'room', 'subject_name', s.name,
                'class_label', trim(both ' ' from c.level || ' ' || coalesce(c.series, '') || ' ' || coalesce(c.section, '')),
                'start_time', te.start_time, 'end_time', te.end_time)
        from public.timetable_entries te
        join public.class_subjects cs on cs.id = te.class_subject_id
        join public.subjects s on s.id = cs.subject_id
        join public.classes c on c.id = te.class_id
        where p_room is not null and p_room <> '' and te.room = p_room and te.establishment_id = p_establishment_id
          and te.day_of_week = p_day and te.start_time < p_end and te.end_time > p_start
          and (p_exclude_entry_id is null or te.id <> p_exclude_entry_id)
    ) conflicts;
$$;
grant execute on function public.timetable_check_conflicts(uuid, uuid, uuid, smallint, time, time, text, uuid) to authenticated;

create or replace function public.timetable_enforce_no_conflicts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_teacher_id uuid;
    v_conflicts jsonb;
begin
    select teacher_id into v_teacher_id from public.class_subjects where id = new.class_subject_id;

    v_conflicts := public.timetable_check_conflicts(
        new.establishment_id, new.class_id, v_teacher_id, new.day_of_week, new.start_time, new.end_time, new.room,
        case when TG_OP = 'UPDATE' then old.id else null end
    );
    if jsonb_array_length(v_conflicts) > 0 then
        raise exception 'timetable_conflict: %', v_conflicts;
    end if;
    return new;
end;
$$;

create trigger trg_timetable_enforce_no_conflicts
before insert or update on public.timetable_entries
for each row execute function public.timetable_enforce_no_conflicts();

-- ----------------------------------------------------------------------------
-- 4. timetable_history() — remplace TimetableController::history() (lecture
--    de audit_log élargie à assertClassViewAccess, sans ouvrir audit_log
--    en général à ces rôles).
-- ----------------------------------------------------------------------------
create or replace function public.timetable_history(p_class_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid;
    v_authorized boolean;
begin
    select establishment_id into v_establishment_id from public.classes where id = p_class_id;
    if v_establishment_id is null or v_establishment_id is distinct from public.my_establishment_id() then
        raise exception 'class_not_found';
    end if;

    select
        public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
        or exists (select 1 from public.classes c where c.id = p_class_id and c.homeroom_teacher_id = auth.uid())
        or exists (select 1 from public.class_subjects cs where cs.class_id = p_class_id and cs.teacher_id = auth.uid())
    into v_authorized;
    if not v_authorized then
        raise exception 'class_access_denied';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'action', al.action, 'details', al.details, 'created_at', al.created_at,
            'first_name', p.first_name, 'last_name', p.last_name
        ) order by al.created_at desc), '[]'::jsonb)
        from public.audit_log al
        left join public.profiles p on p.id = al.profile_id
        where al.establishment_id = v_establishment_id
          and al.entity_type = 'timetable_entries'
          and al.details->>'class_id' = p_class_id::text
        limit 100
    );
end;
$$;
grant execute on function public.timetable_history(uuid) to authenticated;
