-- ============================================================================
-- SCHOOLAR — ÉTAPE 4 / N — Classes & matières (cœur pédagogique)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - L'auto-attribution des matières à la création d'une classe
--     (ClassController::create(), transaction PHP) devient un TRIGGER
--     PostgreSQL. Conséquence concrète : le frontend peut créer une classe
--     par un simple insert PostgREST (`supabase.from('classes').insert(...)`)
--     SANS Edge Function — la base garantit elle-même l'atomicité (un trigger
--     s'exécute dans la même transaction que l'insert qui l'a déclenché).
--   - Le "<=>"  (null-safe equal, contournement MySQL) redevient l'opérateur
--     natif PostgreSQL "IS NOT DISTINCT FROM" — la note de conversion
--     inverse de la version MySQL n'a donc plus lieu d'être.
--   - Un trigger d'audit générique (log_audit_event) remplace les appels
--     Auth::log() épars dans chaque contrôleur. Contrepartie assumée : les
--     noms d'action deviennent génériques ("classes.insert" au lieu de
--     "class.created"), mais restent filtrables par entity_type/entity_id.
--   - Les erreurs de doublon (UNIQUE) n'ont plus besoin d'un bloc try/catch
--     PHP dédié : PostgREST traduit nativement une violation unique_violation
--     (23505) en HTTP 409.
--   - assertManageAccess() (ClassController) autorisait proviseur/principal/
--     directeur, OU le professeur principal titulaire de SA classe — cette
--     règle précise est reproduite telle quelle dans classes_modify, plutôt
--     que de s'appuyer uniquement sur has_permission('classes.manage')
--     (que professeur_principal possède aussi, mais qui servait dans le PHP
--     d'origine surtout à la création, pas à autoriser la modification de
--     n'importe quelle classe).
-- ============================================================================

-- Correction de permission repérée à cette étape dans le PHP d'origine
-- (le surveillant général doit pouvoir consulter les classes).
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'surveillant_general'),
       (select id from public.permissions where code = 'classes.view')
on conflict do nothing;

insert into public.permissions (code, label_fr, label_en, category) values
    ('subjects.manage', 'Gérer le catalogue de matières', 'Manage subject catalog', 'academics')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('proviseur','principal','directeur') and p.code = 'subjects.manage'
on conflict do nothing;

-- ----------------------------------------------------------------------------
-- Trigger d'audit générique — réutilisé pour toutes les tables métier
-- ----------------------------------------------------------------------------
create or replace function public.log_audit_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid;
    v_row jsonb := to_jsonb(coalesce(new, old));
begin
    begin
        v_establishment_id := (v_row->>'establishment_id')::uuid;
    exception when others then
        v_establishment_id := null;
    end;

    insert into public.audit_log (establishment_id, profile_id, action, entity_type, entity_id)
    values (
        v_establishment_id,
        auth.uid(),
        TG_TABLE_NAME || '.' || lower(TG_OP),
        TG_TABLE_NAME,
        v_row->>'id'
    );

    return coalesce(new, old);
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. Catalogue des matières
-- ----------------------------------------------------------------------------
create table public.subjects (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    name              varchar(100) not null,
    code              varchar(20),
    status            varchar(20) not null default 'active' check (status in ('active','archived')),
    created_at        timestamptz not null default now(),
    unique (establishment_id, name)
);
create index idx_subjects_establishment on public.subjects(establishment_id, status);

create trigger trg_subjects_audit
after insert or update on public.subjects
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 2. Modèles de matières par niveau/filière (auto-attribution à la création
--    d'une classe)
-- ----------------------------------------------------------------------------
create table public.level_subject_templates (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    level             varchar(40) not null,
    series            varchar(40),
    subject_id        uuid not null references public.subjects(id) on delete cascade,
    coefficient       numeric(4,2) not null default 1,
    created_at        timestamptz not null default now(),
    unique (establishment_id, level, series, subject_id)
);
create index idx_level_templates_lookup on public.level_subject_templates(establishment_id, level, series);

create trigger trg_level_templates_audit
after insert or update on public.level_subject_templates
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 3. Classes
-- ----------------------------------------------------------------------------
create table public.classes (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    school_year_id        uuid not null references public.school_years(id) on delete cascade,
    level                 varchar(40) not null,
    series                varchar(40),
    section               varchar(20),
    room                  varchar(60),
    homeroom_teacher_id   uuid references public.profiles(id),
    capacity              integer,
    status                varchar(20) not null default 'active' check (status in ('active','archived')),
    created_at            timestamptz not null default now(),
    updated_at            timestamptz not null default now(),
    unique (establishment_id, school_year_id, level, series, section)
);
create index idx_classes_establishment_year on public.classes(establishment_id, school_year_id, status);
create index idx_classes_homeroom_teacher on public.classes(homeroom_teacher_id);

create trigger trg_classes_updated_at
before update on public.classes
for each row execute function public.set_updated_at();

create trigger trg_classes_audit
after insert or update on public.classes
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 4. Matières attribuées à une classe précise
-- ----------------------------------------------------------------------------
create table public.class_subjects (
    id            uuid primary key default gen_random_uuid(),
    class_id      uuid not null references public.classes(id) on delete cascade,
    subject_id    uuid not null references public.subjects(id) on delete cascade,
    teacher_id    uuid references public.profiles(id),
    coefficient   numeric(4,2) not null default 1,
    created_at    timestamptz not null default now(),
    unique (class_id, subject_id)
);
create index idx_class_subjects_class on public.class_subjects(class_id);
create index idx_class_subjects_teacher on public.class_subjects(teacher_id);

create trigger trg_class_subjects_audit
after insert or update or delete on public.class_subjects
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 5. Auto-attribution des matières depuis le modèle du niveau/filière
--    (remplace la transaction PHP de ClassController::create())
-- ----------------------------------------------------------------------------
create or replace function public.auto_attribute_class_subjects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.class_subjects (class_id, subject_id, coefficient)
    select new.id, t.subject_id, t.coefficient
    from public.level_subject_templates t
    where t.establishment_id = new.establishment_id
      and t.level = new.level
      and t.series is not distinct from new.series;
    return new;
end;
$$;

create trigger trg_classes_auto_attribute_subjects
after insert on public.classes
for each row execute function public.auto_attribute_class_subjects();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.subjects enable row level security;
alter table public.level_subject_templates enable row level security;
alter table public.classes enable row level security;
alter table public.class_subjects enable row level security;

-- Matières : lecture par tout le personnel de l'établissement, gestion
-- réservée à qui a subjects.manage (proviseur/principal/directeur).
create policy subjects_select on public.subjects for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy subjects_manage on public.subjects for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('subjects.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('subjects.manage'));

create policy level_templates_select on public.level_subject_templates for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy level_templates_manage on public.level_subject_templates for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('subjects.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('subjects.manage'));

-- Classes : accès complet pour les rôles de direction/suivi ; un enseignant
-- ou professeur principal ne voit que SES classes (reproduit
-- ClassController::assertClassAccess() exactement).
create policy classes_select on public.classes for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or homeroom_teacher_id = auth.uid()
      or exists (select 1 from public.class_subjects cs where cs.class_id = classes.id and cs.teacher_id = auth.uid())
    )
  );

-- Création : gardée par la permission générale (comme le routage PHP d'origine).
create policy classes_insert on public.classes for insert to authenticated
  with check (establishment_id = public.my_establishment_id() and public.has_permission('classes.manage'));

-- Modification/archivage : reproduit assertManageAccess() (plus strict que
-- has_permission seul, pour les professeurs principaux).
create policy classes_modify on public.classes for update to authenticated
  using (
    establishment_id = public.my_establishment_id() and (
      public.my_role_code() in ('proviseur','principal','directeur')
      or (public.my_role_code() = 'professeur_principal' and homeroom_teacher_id = auth.uid())
    )
  )
  with check (
    establishment_id = public.my_establishment_id() and (
      public.my_role_code() in ('proviseur','principal','directeur')
      or (public.my_role_code() = 'professeur_principal' and homeroom_teacher_id = auth.uid())
    )
  );

-- class_subjects : lecture alignée sur la visibilité de la classe parente ;
-- gestion alignée sur assertManageAccess() de la classe parente.
create policy class_subjects_select on public.class_subjects for select to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_subjects.class_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
          or c.homeroom_teacher_id = auth.uid()
          or class_subjects.teacher_id = auth.uid()
        )
    )
  );

create policy class_subjects_manage on public.class_subjects for all to authenticated
  using (
    exists (
      select 1 from public.classes c
      where c.id = class_subjects.class_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur')
          or (public.my_role_code() = 'professeur_principal' and c.homeroom_teacher_id = auth.uid())
        )
    )
  )
  with check (
    exists (
      select 1 from public.classes c
      where c.id = class_subjects.class_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur')
          or (public.my_role_code() = 'professeur_principal' and c.homeroom_teacher_id = auth.uid())
        )
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Vue "tableau de bord des classes" — remplace les 5 sous-requêtes
--    corrélées de ClassController::list()/show() (effectif, absences du
--    jour, notes saisies, taux de progression). RLS des tables sources
--    (classes, class_subjects) s'applique déjà à travers la vue.
--    NOTE : students/attendance_records/attendance_sessions/grades/
--    progression_items n'existent pas encore (étapes suivantes) — cette vue
--    sera complétée quand ces tables seront créées. Pour l'instant, la
--    liste/le détail des classes peuvent déjà être obtenus en PostgREST
--    direct : `select=*,class_subjects(count),subjects(name)`.
-- ----------------------------------------------------------------------------
