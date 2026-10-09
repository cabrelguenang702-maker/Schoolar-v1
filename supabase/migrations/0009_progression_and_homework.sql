-- ============================================================================
-- SCHOOLAR — ÉTAPE 9 / N — Progression pédagogique (section 13) & Devoirs (section 14)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Fichiers de devoirs : FileStorage::storeUpload()/stream() (hors racine
--     web, téléchargement via point d'accès authentifié) devient Supabase
--     Storage (bucket privé "homework") + URL signée à durée limitée générée
--     par une Edge Function après vérification d'accès — équivalent direct
--     du flux "jamais d'URL publique, toujours via un endpoint contrôlé".
--   - Le dépôt d'un devoir (multipart) ET le téléchargement restent des Edge
--     Functions (upload de fichier + emails de notification), mais la
--     LECTURE (liste, détail, suivi élève) et la GESTION (créer/modifier/
--     supprimer un devoir, corriger une soumission) sont de simples appels
--     PostgREST protégés par RLS — pas besoin d'Edge Function pour ça.
--   - order_index (progression_items) : plus besoin de calculer MAX+1 côté
--     PHP avant l'insert — un trigger BEFORE INSERT le fait nativement si le
--     client ne le fournit pas.
--   - classSummary() (badge "Taux de progression") n'imposait aucune
--     vérification de rôle dans le PHP d'origine (juste l'appartenance à
--     l'établissement) — reproduit tel quel via une fonction SECURITY
--     DEFINER dédiée, plutôt que d'élargir la RLS de progression_items à
--     tout le monde.
-- ============================================================================

insert into public.permissions (code, label_fr, label_en, category) values
    ('progression.manage', 'Gérer la progression pédagogique', 'Manage teaching progress', 'academics'),
    ('progression.view',   'Consulter la progression pédagogique', 'View teaching progress', 'academics'),
    ('homework.manage',    'Gérer les devoirs à domicile', 'Manage homework assignments', 'academics'),
    ('homework.view',      'Consulter les devoirs à domicile', 'View homework assignments', 'academics')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('proviseur','principal','directeur','enseignant','professeur_principal')
  and p.code in ('progression.manage','progression.view','homework.manage','homework.view')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('censeur','surveillant_general') and p.code = 'progression.view'
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- 1. Cahier de progression pédagogique
-- ----------------------------------------------------------------------------
create table public.progression_items (
    id                     uuid primary key default gen_random_uuid(),
    class_subject_id       uuid not null references public.class_subjects(id) on delete cascade,
    title                  varchar(255) not null,
    order_index            integer,
    completed              boolean not null default false,
    completed_by_profile_id uuid references public.profiles(id),
    completed_at           timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);
create index idx_progression_items_class_subject on public.progression_items(class_subject_id, order_index);

create trigger trg_progression_items_updated_at
before update on public.progression_items
for each row execute function public.set_updated_at();

create trigger trg_progression_items_audit
after insert or update or delete on public.progression_items
for each row execute function public.log_audit_event();

create or replace function public.progression_item_default_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.order_index is null then
        select coalesce(max(order_index), 0) + 1 into new.order_index
        from public.progression_items where class_subject_id = new.class_subject_id;
    end if;
    return new;
end;
$$;

create trigger trg_progression_items_default_order
before insert on public.progression_items
for each row execute function public.progression_item_default_order();

-- Empêche de re-marquer "terminé" un item déjà terminé (409 dans le PHP) et
-- fige qui/quand côté serveur.
create or replace function public.progression_item_guard_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.completed and old.completed then
        raise exception 'progression_already_completed';
    end if;
    if new.completed and not old.completed then
        new.completed_by_profile_id := auth.uid();
        new.completed_at := now();
    end if;
    if not new.completed then
        new.completed_by_profile_id := null;
        new.completed_at := null;
    end if;
    return new;
end;
$$;

create trigger trg_progression_items_guard_complete
before update on public.progression_items
for each row execute function public.progression_item_guard_complete();

alter table public.progression_items enable row level security;

create policy progression_items_select on public.progression_items for select to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = progression_items.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  );

create policy progression_items_manage on public.progression_items for all to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = progression_items.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = progression_items.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- progression_class_summary() — remplace ProgressionController::classSummary().
-- Volontairement SANS contrôle de rôle au-delà de l'établissement, à
-- l'identique du PHP d'origine (badge non sensible).
-- ----------------------------------------------------------------------------
create or replace function public.progression_class_summary(p_class_id uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
    select jsonb_build_object(
        'by_subject', coalesce(jsonb_agg(jsonb_build_object(
            'subject_name', subject_name, 'total', total, 'done', done
        ) order by subject_name), '[]'::jsonb),
        'overall_rate', case when sum(total) > 0 then round(sum(done)::numeric / sum(total) * 100) else 0 end
    )
    from (
        select s.name as subject_name, count(pi.id) as total,
               count(pi.id) filter (where pi.completed) as done
        from public.class_subjects cs
        join public.subjects s on s.id = cs.subject_id
        left join public.progression_items pi on pi.class_subject_id = cs.id
        where cs.class_id = p_class_id
          and exists (select 1 from public.classes c where c.id = p_class_id and c.establishment_id = public.my_establishment_id())
        group by s.name
    ) rows;
$$;
grant execute on function public.progression_class_summary(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Devoirs à domicile
-- ----------------------------------------------------------------------------
-- Bucket de stockage privé pour les fichiers déposés (jamais d'URL publique —
-- accès exclusivement via une URL signée à durée limitée, voir
-- homework-download). Équivalent Supabase du dossier hors racine web utilisé
-- par FileStorage.php.
insert into storage.buckets (id, name, public)
values ('homework', 'homework', false)
on conflict (id) do nothing;

create table public.homework_assignments (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    class_subject_id      uuid not null references public.class_subjects(id) on delete cascade,
    title                 varchar(255) not null,
    description           varchar(2000),
    due_date              date not null,
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now()
);
create index idx_homework_assignments_class_subject on public.homework_assignments(class_subject_id, due_date desc);
create index idx_homework_assignments_establishment on public.homework_assignments(establishment_id, due_date desc);

create trigger trg_homework_assignments_updated_at
before update on public.homework_assignments
for each row execute function public.set_updated_at();

create trigger trg_homework_assignments_audit
after insert or update or delete on public.homework_assignments
for each row execute function public.log_audit_event();

-- Chemin Supabase Storage (bucket privé "homework"), plus de file_path
-- disque local. mime_type/file_size_bytes restent renseignés à titre
-- informatif (affichés dans le tableau de suivi).
create table public.homework_submissions (
    id                      uuid primary key default gen_random_uuid(),
    homework_id             uuid not null references public.homework_assignments(id) on delete cascade,
    student_id              uuid not null references public.students(id) on delete cascade,
    storage_path            text not null,
    original_filename       varchar(255) not null,
    mime_type               varchar(100),
    file_size_bytes         integer,
    submitted_by_profile_id uuid references public.profiles(id),
    submitted_at            timestamptz not null default now(),
    reviewed                boolean not null default false,
    review_note             varchar(500),
    reviewed_at             timestamptz,
    unique (homework_id, student_id)
);
create index idx_homework_submissions_homework on public.homework_submissions(homework_id);
create index idx_homework_submissions_student on public.homework_submissions(student_id);

create trigger trg_homework_submissions_audit
after insert or update on public.homework_submissions
for each row execute function public.log_audit_event();

alter table public.homework_assignments enable row level security;
alter table public.homework_submissions enable row level security;

-- Lecture : réunit assertManageAccess (direction/enseignant/PP) et
-- assertSubmitAccess (parent d'un élève de la classe, élève lui-même).
create policy homework_assignments_select on public.homework_assignments for select to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = homework_assignments.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
          or exists (select 1 from public.students st where st.class_id = c.id and st.profile_id = auth.uid())
          or exists (
               select 1 from public.students st join public.student_parents sp on sp.student_id = st.id
               where st.class_id = c.id and sp.parent_id = auth.uid()
             )
        )
    )
  );

-- Gestion (créer/modifier/supprimer) : direction/enseignant/PP uniquement —
-- pas les parents/élèves.
create policy homework_assignments_manage on public.homework_assignments for all to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = homework_assignments.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid() or c.homeroom_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = homework_assignments.class_subject_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid() or c.homeroom_teacher_id = auth.uid())
    )
  );

-- Soumissions : lecture réunissant direction/enseignant/PP, le parent
-- concerné, et l'élève lui-même (assertSubmitAccess). Écriture (insert du
-- dépôt initial, et review()) réservée au groupe de gestion — le dépôt par
-- un PARENT passe par l'Edge Function homework-submit (service_role),
-- volontairement PAS par un insert PostgREST direct (upload de fichier requis).
create policy homework_submissions_select on public.homework_submissions for select to authenticated
  using (
    exists (
      select 1 from public.homework_assignments ha
      join public.class_subjects cs on cs.id = ha.class_subject_id
      join public.classes c on c.id = cs.class_id
      join public.students st on st.id = homework_submissions.student_id
      where ha.id = homework_submissions.homework_id and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
          or st.profile_id = auth.uid()
          or exists (select 1 from public.student_parents sp where sp.student_id = st.id and sp.parent_id = auth.uid())
        )
    )
  );

create policy homework_submissions_manage on public.homework_submissions for all to authenticated
  using (
    exists (
      select 1 from public.homework_assignments ha
      join public.class_subjects cs on cs.id = ha.class_subject_id
      join public.classes c on c.id = cs.class_id
      where ha.id = homework_submissions.homework_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid() or c.homeroom_teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.homework_assignments ha
      join public.class_subjects cs on cs.id = ha.class_subject_id
      join public.classes c on c.id = cs.class_id
      where ha.id = homework_submissions.homework_id and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur') or cs.teacher_id = auth.uid() or c.homeroom_teacher_id = auth.uid())
    )
  );
