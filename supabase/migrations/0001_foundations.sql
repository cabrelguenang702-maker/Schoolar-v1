-- ============================================================================
-- SCHOOLAR — Plateforme web nationale de gestion scolaire du Cameroun
-- Schéma PostgreSQL 100% Supabase — ÉTAPE 1 / N — Fondations
-- Rôles, établissements, profils (liés à Supabase Auth), audit
-- ============================================================================
-- CHOIX D'ARCHITECTURE (par rapport à la version PHP + MySQL fournie) :
--   - L'authentification (mot de passe, sessions, MFA/TOTP, réinitialisation
--     de mot de passe) est entièrement déléguée à Supabase Auth (auth.users).
--     Les tables "users" (avec password_hash, two_factor_secret),
--     "auth_tokens" et "password_reset_tokens" du schéma MySQL n'existent
--     donc plus : Supabase Auth les remplace nativement.
--   - La table "profiles" ci-dessous est le PROLONGEMENT métier de
--     auth.users : profiles.id = auth.users.id (1-1), et porte tout ce qui
--     est spécifique à SCHOOLAR (établissement, rôle, statut, langue...).
--   - Les permissions par rôle/établissement sont appliquées directement en
--     base via Row Level Security (RLS), à la place des Middleware PHP
--     (AuthMiddleware, RoleMiddleware, PermissionMiddleware).
--   - UUID natifs (gen_random_uuid()), TIMESTAMPTZ, trigger générique
--     set_updated_at() réutilisable sur toutes les tables futures.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Fonction générique de mise à jour de updated_at (réutilisée à chaque étape)
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 1. RÔLES ET PERMISSIONS
-- ----------------------------------------------------------------------------
create table public.roles (
    id          smallint generated always as identity primary key,
    code        varchar(40)  not null unique,
    label_fr    varchar(100) not null,
    label_en    varchar(100) not null,
    scope       varchar(20)  not null default 'establishment'
                  check (scope in ('national','establishment','family')),
    is_staff    boolean not null default false,
    created_at  timestamptz not null default now()
);

create table public.permissions (
    id          integer generated always as identity primary key,
    code        varchar(80) not null unique,
    label_fr    varchar(150) not null,
    label_en    varchar(150) not null,
    category    varchar(60) not null
);

create table public.role_permissions (
    role_id       smallint not null references public.roles(id) on delete cascade,
    permission_id integer  not null references public.permissions(id) on delete cascade,
    primary key (role_id, permission_id)
);

insert into public.roles (code, label_fr, label_en, scope, is_staff) values
 ('admin_national',      'Administrateur national SCHOOLAR', 'SCHOOLAR National Admin', 'national', true),
 ('proviseur',           'Proviseur',              'Principal (Lycée)',        'establishment', true),
 ('principal',           'Principal',               'Principal (Collège)',      'establishment', true),
 ('censeur',             'Censeur',                 'Vice-Principal (Studies)', 'establishment', true),
 ('surveillant_general', 'Surveillant Général',     'Discipline Master',        'establishment', true),
 ('surveillant_secteur', 'Surveillant de secteur',  'Sector Supervisor',        'establishment', true),
 ('econome',             'Économe',                 'Bursar',                   'establishment', true),
 ('comptable',           'Comptable',               'Accountant',               'establishment', true),
 ('secretaire',          'Secrétaire',               'Secretary',                'establishment', true),
 ('enseignant',          'Enseignant',              'Teacher',                   'establishment', true),
 ('professeur_principal','Professeur Principal',    'Form/Class Master',         'establishment', true),
 ('eleve',               'Élève',                   'Student',                   'establishment', false),
 ('parent',              'Parent d''élève',          'Parent',                    'family', false);

-- ----------------------------------------------------------------------------
-- 2. ÉTABLISSEMENTS
-- ----------------------------------------------------------------------------
create table public.establishments (
    id                  uuid primary key default gen_random_uuid(),
    code                varchar(20) not null unique,
    name                varchar(180) not null,
    establishment_type  varchar(20) not null check (establishment_type in ('college','lycee')),
    teaching_type       varchar(20) not null check (teaching_type in ('general','technique')),
    linguistic_system   varchar(20) not null default 'francophone'
                          check (linguistic_system in ('francophone','anglophone','bilingue')),
    region              varchar(100) not null,
    department          varchar(100) not null,
    arrondissement      varchar(100) not null,
    quartier            varchar(100),
    address             varchar(255),
    phone               varchar(30) not null,
    email               varchar(150) not null,
    logo_url            text,
    photo_url           text,
    default_language    varchar(2) not null default 'fr' check (default_language in ('fr','en')),
    status              varchar(20) not null default 'pending'
                          check (status in ('pending','active','suspended','archived')),
    latitude            double precision check (latitude between -90 and 90),
    longitude           double precision check (longitude between -180 and 180),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index idx_establishments_region on public.establishments(region, department);
create index idx_establishments_status on public.establishments(status);

create trigger trg_establishments_updated_at
before update on public.establishments
for each row execute function public.set_updated_at();

create table public.school_years (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    label             varchar(20) not null,
    start_date        date not null,
    end_date          date not null,
    is_current        boolean not null default false,
    created_at        timestamptz not null default now(),
    unique (establishment_id, label)
);

-- ----------------------------------------------------------------------------
-- 3. PROFILS — prolongement métier de auth.users (Supabase Auth)
-- ----------------------------------------------------------------------------
create table public.profiles (
    id                 uuid primary key references auth.users(id) on delete cascade,
    establishment_id   uuid references public.establishments(id) on delete cascade, -- NULL pour admin_national
    role_id            smallint not null references public.roles(id),
    first_name         varchar(100) not null,
    last_name          varchar(100) not null,
    email              varchar(150) not null,
    phone              varchar(30),
    photo_url          text,
    language_pref      varchar(2) not null default 'fr' check (language_pref in ('fr','en')),
    status             varchar(20) not null default 'active'
                         check (status in ('active','inactive','archived','pending_validation')),
    must_change_password boolean not null default false,
    last_login_at      timestamptz,
    archived_at        timestamptz,
    archived_reason    varchar(255),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    unique (establishment_id, email)
);

create index idx_profiles_establishment_role on public.profiles(establishment_id, role_id);
create index idx_profiles_status on public.profiles(status);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- Fonctions utilitaires pour les policies RLS (SECURITY DEFINER pour éviter
-- toute récursion RLS quand une policy sur "profiles" doit lire "profiles")
-- ----------------------------------------------------------------------------
create or replace function public.my_establishment_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select establishment_id from public.profiles where id = auth.uid();
$$;

create or replace function public.my_role_code()
returns text
language sql stable security definer set search_path = public
as $$
  select r.code from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid();
$$;

create or replace function public.is_national_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.my_role_code() = 'admin_national';
$$;

create or replace function public.has_permission(perm_code text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.id = auth.uid() and perm.code = perm_code
  );
$$;

-- ----------------------------------------------------------------------------
-- 4. CHANGEMENT D'ADMINISTRATEUR D'ÉTABLISSEMENT
-- ----------------------------------------------------------------------------
create table public.admin_change_requests (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    old_admin_profile_id   uuid references public.profiles(id),
    new_admin_first_name   varchar(100) not null,
    new_admin_last_name    varchar(100) not null,
    new_admin_email        varchar(150) not null,
    new_admin_phone        varchar(30),
    justification_doc_url  text,
    status                 varchar(30) not null default 'pending'
      check (status in ('pending','email_confirmed','validated_by_national_admin','rejected','completed')),
    validation_token       varchar(100) unique,
    requested_by_profile_id uuid references public.profiles(id),
    validated_by_profile_id uuid references public.profiles(id),
    created_at             timestamptz not null default now(),
    validated_at           timestamptz
);

-- ----------------------------------------------------------------------------
-- 5. JOURNAL D'AUDIT
-- ----------------------------------------------------------------------------
create table public.audit_log (
    id                bigint generated always as identity primary key,
    establishment_id  uuid references public.establishments(id) on delete set null,
    profile_id        uuid references public.profiles(id) on delete set null,
    action            varchar(80) not null,
    entity_type       varchar(60),
    entity_id         varchar(60),
    details           jsonb,
    ip_address        varchar(45),
    created_at        timestamptz not null default now()
);

create index idx_audit_log_establishment on public.audit_log(establishment_id, created_at desc);
create index idx_audit_log_profile on public.audit_log(profile_id, created_at desc);
create index idx_audit_log_action on public.audit_log(action);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.establishments enable row level security;
alter table public.school_years enable row level security;
alter table public.profiles enable row level security;
alter table public.admin_change_requests enable row level security;
alter table public.audit_log enable row level security;

-- Rôles/permissions : lecture libre à tout utilisateur authentifié (référentiel)
create policy roles_read_all on public.roles for select to authenticated using (true);
create policy permissions_read_all on public.permissions for select to authenticated using (true);
create policy role_permissions_read_all on public.role_permissions for select to authenticated using (true);

-- Établissements : national voit tout ; un utilisateur voit le sien
create policy establishments_select on public.establishments for select to authenticated
  using (public.is_national_admin() or id = public.my_establishment_id());
create policy establishments_update on public.establishments for update to authenticated
  using (public.is_national_admin() or (id = public.my_establishment_id() and public.has_permission('establishment.manage')));
create policy establishments_insert_national on public.establishments for insert to authenticated
  with check (public.is_national_admin());

-- Années scolaires : scoping par établissement
create policy school_years_select on public.school_years for select to authenticated
  using (public.is_national_admin() or establishment_id = public.my_establishment_id());
create policy school_years_write on public.school_years for all to authenticated
  using (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('school_years.manage')))
  with check (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('school_years.manage')));

-- Profils : chacun voit son propre profil ; le national voit tout ;
-- un utilisateur du même établissement voit les profils de son établissement
-- (le détail plus fin — ex: un parent ne voit que le personnel, pas les autres
-- parents — sera affiné à l'étape "Élèves/Parents" avec des policies dédiées).
create policy profiles_select_self on public.profiles for select to authenticated
  using (id = auth.uid());
create policy profiles_select_national on public.profiles for select to authenticated
  using (public.is_national_admin());
create policy profiles_select_same_establishment on public.profiles for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
create policy profiles_manage_staff on public.profiles for all to authenticated
  using (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('staff.manage')))
  with check (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('staff.manage')));

-- Demandes de changement d'admin : établissement concerné + national admin
create policy acr_select on public.admin_change_requests for select to authenticated
  using (public.is_national_admin() or establishment_id = public.my_establishment_id());
create policy acr_write on public.admin_change_requests for all to authenticated
  using (public.is_national_admin() or establishment_id = public.my_establishment_id())
  with check (public.is_national_admin() or establishment_id = public.my_establishment_id());

-- Audit : lecture réservée au national admin et aux responsables d'établissement
create policy audit_log_select on public.audit_log for select to authenticated
  using (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('audit.view')));
-- Les écritures dans audit_log se font uniquement via des fonctions
-- SECURITY DEFINER appelées par les Edge Functions (jamais en direct côté client).
