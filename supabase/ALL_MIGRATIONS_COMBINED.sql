-- ============================================================================
-- SCHOOLAR — MIGRATION COMBINÉE (0001 à 0019), DANS L'ORDRE
-- À utiliser si vous collez le SQL manuellement dans l'éditeur Supabase
-- (Dashboard → SQL Editor) plutôt que via 'supabase db push'.
-- Exécutez CE FICHIER UNIQUE EN UNE SEULE FOIS, du début à la fin, dans un
-- SEUL onglet — ne JAMAIS exécuter les fichiers 000X_*.sql individuellement
-- dans un ordre autre que celui-ci : chaque étape dépend des précédentes
-- (ex: 'establishments' est créée en tout premier, à l'étape 1 ; toute
-- table qui la référence AVANT qu'elle existe échoue avec l'erreur
-- 'relation "establishments" does not exist').
-- ============================================================================


-- ############################################################################
-- FICHIER SOURCE : 0001_foundations.sql
-- ############################################################################
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


-- ############################################################################
-- FICHIER SOURCE : 0002_establishment_validation_and_staff_permissions.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 2 / N — Validation établissement, catalogue de
-- permissions, vérification de compte administrateur, rate limiting
-- ============================================================================
-- CHOIX D'ARCHITECTURE (vs. PHP + MySQL) :
--   - Le rôle 'directeur' (écoles primaires) est ajouté ici (regroupé avec
--     la validation établissement, plutôt qu'en toute fin comme dans la
--     version MySQL, car il est nécessaire dès l'inscription).
--   - La 2FA/TOTP n'a PAS de table dédiée ici : elle est gérée nativement
--     par Supabase Auth (auth.mfa_factors, auth.mfa_challenges), invisible
--     depuis le schéma public. Idem pour password_reset_tokens (remplacé
--     par supabase.auth.resetPasswordForEmail()/updateUser(), natifs).
--   - "account_verifications" (code à 6 chiffres) RESTE une table custom :
--     c'est une règle métier propre à SCHOOLAR (bloquer la connexion d'un
--     compte proviseur/principal/directeur tant qu'un code reçu par
--     email+SMS n'est pas confirmé), sans équivalent natif Supabase.
--     Accès : UNIQUEMENT via les Edge Functions (clé service_role) — RLS
--     activé sans aucune policy pour les rôles anon/authenticated.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Rôle "directeur" (écoles primaires)
-- ----------------------------------------------------------------------------
insert into public.roles (code, label_fr, label_en, scope, is_staff)
values ('directeur', 'Directeur / Directrice', 'Head Teacher', 'establishment', true)
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 2. Établissements : niveau d'enseignement, secteur, validation nationale
-- ----------------------------------------------------------------------------
alter table public.establishments
    add column education_level varchar(20) not null default 'secondaire'
        check (education_level in ('primaire','secondaire')),
    add column sector varchar(10) not null default 'public'
        check (sector in ('public','prive')),
    add column rejection_reason varchar(255),
    add column suspended_reason varchar(255),
    add column validated_by_profile_id uuid references public.profiles(id),
    add column validated_at timestamptz;

alter table public.establishments drop constraint establishments_status_check;
alter table public.establishments add constraint establishments_status_check
    check (status in ('pending','active','suspended','rejected','archived'));

alter table public.establishments drop constraint establishments_establishment_type_check;
alter table public.establishments add constraint establishments_establishment_type_check
    check (establishment_type in ('college','lycee','ecole_primaire'));

create index idx_establishments_status_created on public.establishments(status, created_at desc);
create index idx_establishments_education_level on public.establishments(education_level, status);

-- ----------------------------------------------------------------------------
-- 3. Demandes de changement d'administrateur : complément
-- ----------------------------------------------------------------------------
alter table public.admin_change_requests
    add column rejection_reason varchar(255);
-- NOTE : pas de "new_admin_password_hash" ici — le nouvel administrateur
-- définira son mot de passe via le flux natif Supabase Auth (lien
-- d'invitation / resetPasswordForEmail) au moment de la confirmation,
-- au lieu de le transmettre en clair puis le hacher côté serveur.

create index idx_acr_status on public.admin_change_requests(status, created_at desc);
create index idx_acr_establishment on public.admin_change_requests(establishment_id);

-- ----------------------------------------------------------------------------
-- 4. Profils : verrouillage anti-brute-force + vérification admin par code
--    (le hash de mot de passe et le secret TOTP n'existent plus ici : gérés
--    par auth.users / auth.mfa_factors via Supabase Auth)
-- ----------------------------------------------------------------------------
alter table public.profiles
    add column failed_login_attempts smallint not null default 0,
    add column locked_until timestamptz,
    -- NULL = vérification par code requise et non encore faite (uniquement
    -- pertinent pour les rôles proviseur/principal/directeur créés via
    -- l'inscription d'établissement). Les Edge Functions renseignent cette
    -- colonne à now() à la création pour tous les autres rôles.
    add column admin_verified_at timestamptz;

-- ----------------------------------------------------------------------------
-- 5. Catalogue des permissions
-- ----------------------------------------------------------------------------
insert into public.permissions (code, label_fr, label_en, category) values
    ('establishment.manage', 'Gérer les informations de l''établissement', 'Manage school information', 'establishment'),
    ('staff.manage',         'Gérer le personnel',                        'Manage staff',                'staff'),
    ('staff.view',           'Consulter le personnel',                    'View staff',                  'staff'),
    ('classes.manage',       'Gérer les classes',                         'Manage classes',              'academics'),
    ('classes.view',         'Consulter les classes',                     'View classes',                'academics'),
    ('subjects.manage',      'Gérer les matières',                        'Manage subjects',             'academics'),
    ('students.manage',      'Gérer les élèves',                          'Manage students',             'academics'),
    ('students.view',        'Consulter les élèves',                      'View students',               'academics'),
    ('grades.enter',         'Saisir les notes',                          'Enter grades',                'academics'),
    ('grades.validate',      'Valider les notes / bulletins',             'Validate grades / report cards','academics'),
    ('attendance.mark',      'Faire l''appel',                            'Mark attendance',             'academics'),
    ('attendance.view',      'Consulter les présences',                   'View attendance',             'academics'),
    ('discipline.manage',    'Gérer la discipline',                       'Manage discipline',           'academics'),
    ('discipline.view',      'Consulter la discipline',                   'View discipline',             'academics'),
    ('communication.send',   'Envoyer des communications',                'Send communications',         'communication'),
    ('payments.manage',      'Gérer les paiements / frais de scolarité',  'Manage payments / fees',      'finance'),
    ('library.manage',       'Gérer la bibliothèque numérique',           'Manage digital library',      'resources'),
    ('school_years.manage',  'Gérer les années scolaires',                'Manage school years',         'establishment'),
    ('audit.view',           'Consulter le journal d''audit',             'View audit log',              'security')
on conflict (code) do nothing;

-- ----------------------------------------------------------------------------
-- 6. Matrice rôle → permissions
-- ----------------------------------------------------------------------------
-- Proviseur, Principal, Directeur : accès complet à l'échelle de l'établissement
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('proviseur', 'principal', 'directeur')
on conflict do nothing;

-- Censeur : suivi pédagogique + discipline + validation des notes
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'censeur'), id from public.permissions
where code in ('classes.view','students.view','grades.validate','discipline.manage','attendance.view','communication.send')
on conflict do nothing;

-- Surveillant Général : discipline + présences
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'surveillant_general'), id from public.permissions
where code in ('discipline.manage','attendance.mark','attendance.view','communication.send','students.view')
on conflict do nothing;

-- Surveillant de secteur : présences + discipline (lecture)
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'surveillant_secteur'), id from public.permissions
where code in ('attendance.mark','discipline.view','students.view')
on conflict do nothing;

-- Économe & Comptable : paiements + frais de scolarité
insert into public.role_permissions (role_id, permission_id)
select rl.id, p.id from public.roles rl cross join public.permissions p
where rl.code in ('econome', 'comptable') and p.code in ('payments.manage','students.view')
on conflict do nothing;

-- Secrétaire : élèves + personnel (lecture) + communication
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'secretaire'), id from public.permissions
where code in ('students.manage','students.view','staff.view','communication.send','classes.view')
on conflict do nothing;

-- Enseignant : notes + présences + communication sur ses classes
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'enseignant'), id from public.permissions
where code in ('grades.enter','attendance.mark','classes.view','communication.send','students.view')
on conflict do nothing;

-- Professeur principal : droits enseignant + gestion de sa classe
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'professeur_principal'), id from public.permissions
where code in ('grades.enter','grades.validate','attendance.mark','attendance.view','classes.manage',
                'classes.view','students.manage','students.view','communication.send')
on conflict do nothing;

-- Administrateur national : aucune permission d'établissement (ses actions
-- passent par des Edge Functions dédiées, protégées par is_national_admin()).

-- ----------------------------------------------------------------------------
-- 7. Vérification du compte administrateur par code à 6 chiffres
-- ----------------------------------------------------------------------------
create table public.account_verifications (
    id           uuid primary key default gen_random_uuid(),
    profile_id   uuid not null references public.profiles(id) on delete cascade,
    code_hash    varchar(64) not null,
    channel      varchar(10) not null default 'email' check (channel in ('email','sms','both')),
    expires_at   timestamptz not null,
    consumed_at  timestamptz,
    created_at   timestamptz not null default now()
);
create index idx_account_verifications_profile on public.account_verifications(profile_id, consumed_at, expires_at);

alter table public.account_verifications enable row level security;
-- Aucune policy : accessible uniquement via une Edge Function (clé service_role),
-- jamais directement depuis le client anon/authenticated.

-- ----------------------------------------------------------------------------
-- 8. Rate limiting par IP (protection anti brute-force / anti-spam sur les
--    Edge Functions publiques sensibles : login, inscription, mot de passe)
-- ----------------------------------------------------------------------------
create table public.rate_limit_hits (
    id          bigint generated always as identity primary key,
    bucket_key  varchar(150) not null, -- ex: "login:41.202.xxx.xxx"
    created_at  timestamptz not null default now()
);
create index idx_rate_limit_bucket_time on public.rate_limit_hits(bucket_key, created_at);

alter table public.rate_limit_hits enable row level security;
-- Aucune policy : écriture/lecture réservées aux Edge Functions (service_role).


-- ############################################################################
-- FICHIER SOURCE : 0003_establishment_directory.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 3 / N — Annuaire public des établissements & validation
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - EstablishmentController::search()/show() (PHP, accès public non
--     authentifié) ne peuvent PAS devenir une simple policy RLS "anon" sur
--     la table establishments : ça exposerait aussi email/phone/motifs de
--     rejet à n'importe qui. On utilise donc des fonctions SECURITY DEFINER
--     ne renvoyant QUE les colonnes publiques (mêmes colonnes que le PHP
--     d'origine), appelables directement en RPC PostgREST par le frontend
--     (supabase.rpc('search_establishments', {...})), sans Edge Function.
--   - Les transitions de statut (approve/reject/suspend/reactivate) restent
--     une Edge Function dédiée (voir establishments-transition) : elles
--     déclenchent des emails et doivent garder la garde "from status X".
-- ============================================================================

create or replace function public.search_establishments(
    q text default null,
    p_education_level text default null
)
returns table (
    id uuid, code varchar, name varchar, region varchar,
    logo_url text, education_level varchar
)
language sql stable security definer set search_path = public
as $$
    select id, code, name, region, logo_url, education_level
    from public.establishments
    where status = 'active'
      and (p_education_level is null or education_level = p_education_level)
      and (q is null or q = '' or name ilike '%' || q || '%' or code ilike '%' || q || '%')
    order by name asc
    limit 20;
$$;
grant execute on function public.search_establishments(text, text) to anon, authenticated;

create or replace function public.get_establishment_public(p_id uuid)
returns table (
    id uuid, code varchar, name varchar, establishment_type varchar,
    teaching_type varchar, linguistic_system varchar, region varchar,
    logo_url text, photo_url text
)
language sql stable security definer set search_path = public
as $$
    select id, code, name, establishment_type, teaching_type, linguistic_system, region, logo_url, photo_url
    from public.establishments
    where id = p_id and status = 'active';
$$;
grant execute on function public.get_establishment_public(uuid) to anon, authenticated;

-- Compteur par statut pour le tableau de bord de l'admin national
-- (AdminController::listEstablishments -> "counts_by_status"). La liste
-- elle-même (jusqu'à 100 lignes filtrables) est directement accessible en
-- PostgREST via `establishments_select` (policy déjà en place, étape 1) —
-- pas besoin de fonction dédiée pour ça.
create or replace function public.establishment_counts_by_status()
returns table (status varchar, n bigint)
language sql stable security definer set search_path = public
as $$
    select status, count(*) as n
    from public.establishments
    where public.is_national_admin()
    group by status;
$$;
grant execute on function public.establishment_counts_by_status() to authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0004_classes_and_subjects.sql
-- ############################################################################
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


-- ############################################################################
-- FICHIER SOURCE : 0005_students_and_parents.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 5 / N — Élèves & Parents
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Pas de table `users` séparée : un élève ou un parent qui a un compte
--     de connexion est un `profiles` comme les autres (id = auth.users.id).
--     `students.profile_id` remplace `students.user_id` (migration 019 du
--     PHP) ; `student_parents.parent_id` référence directement `profiles`.
--   - Génération du matricule : trigger BEFORE INSERT (remplace
--     StudentController::generateMatricule(), même format "EL" + année + 4
--     chiffres, même boucle anti-collision).
--   - assertStudentManageAccess()/assertClassManageAccess() sont reproduits
--     en RLS avec USING (contrôle sur l'état AVANT modification — classe
--     actuelle de l'élève) ET WITH CHECK (contrôle sur l'état APRÈS —
--     nouvelle classe visée) : PostgreSQL sépare nativement ces deux
--     moments, ce que le PHP devait faire "à la main" avec deux fonctions.
--   - L'invitation d'un parent et la création d'un compte de connexion élève
--     restent des Edge Functions (auth.users à créer, emails à envoyer) —
--     voir student-invite-parent, parent-confirm-invitation,
--     student-create-login.
--   - La détection de doublon (nom+prénom+date de naissance) et l'alerte
--     "numéro identique élève/parent" étaient de simples avertissements non
--     bloquants : le frontend peut les recalculer lui-même avec un select
--     PostgREST direct sur `students` (déjà protégé par la RLS ci-dessous),
--     sans fonction dédiée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Élèves
-- ----------------------------------------------------------------------------
create table public.students (
    id                  uuid primary key default gen_random_uuid(),
    establishment_id    uuid not null references public.establishments(id) on delete cascade,
    class_id            uuid references public.classes(id) on delete set null,
    profile_id          uuid references public.profiles(id) on delete set null,
    matricule           varchar(30) not null,
    first_name          varchar(100) not null,
    last_name           varchar(100) not null,
    sex                 varchar(1) check (sex in ('M','F')),
    birth_date          date,
    birth_place         varchar(150),
    photo_url           text,
    father_name         varchar(150),
    mother_name         varchar(150),
    parent_phone_1      varchar(30),
    parent_phone_2      varchar(30),
    student_phone       varchar(30),
    address             varchar(255),
    status              varchar(20) not null default 'active' check (status in ('active','archived','transferred')),
    created_by_profile_id uuid references public.profiles(id),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (establishment_id, matricule),
    unique (profile_id)
);
create index idx_students_establishment on public.students(establishment_id, status);
create index idx_students_class on public.students(class_id);
create index idx_students_alpha on public.students(establishment_id, last_name, first_name);
create index idx_students_duplicate_check on public.students(establishment_id, last_name, first_name, birth_date);

create trigger trg_students_updated_at
before update on public.students
for each row execute function public.set_updated_at();

create trigger trg_students_audit
after insert or update on public.students
for each row execute function public.log_audit_event();

-- Génération automatique du matricule si non fourni (identique au PHP :
-- préfixe "EL" + 2 derniers chiffres de l'année + 4 chiffres aléatoires).
create or replace function public.generate_student_matricule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    candidate varchar(30);
begin
    if new.matricule is not null and new.matricule <> '' then
        return new;
    end if;

    loop
        candidate := 'EL' || to_char(now(), 'YY') || lpad(floor(random() * 9000 + 1000)::text, 4, '0');
        exit when not exists (
            select 1 from public.students
            where establishment_id = new.establishment_id and matricule = candidate
        );
    end loop;

    new.matricule := candidate;
    return new;
end;
$$;

create trigger trg_students_generate_matricule
before insert on public.students
for each row execute function public.generate_student_matricule();

-- ----------------------------------------------------------------------------
-- 2. Liaison élèves ↔ parents
-- ----------------------------------------------------------------------------
create table public.student_parents (
    id            uuid primary key default gen_random_uuid(),
    student_id    uuid not null references public.students(id) on delete cascade,
    parent_id     uuid not null references public.profiles(id) on delete cascade,
    relationship  varchar(30),
    created_at    timestamptz not null default now(),
    unique (student_id, parent_id)
);
create index idx_student_parents_parent on public.student_parents(parent_id);
create index idx_student_parents_student on public.student_parents(student_id);

-- ----------------------------------------------------------------------------
-- 3. Invitations parents — accès exclusivement via les Edge Functions
--    (service_role) : contient un token qui fait office de secret.
-- ----------------------------------------------------------------------------
create table public.parent_invitations (
    id                        uuid primary key default gen_random_uuid(),
    establishment_id          uuid not null references public.establishments(id) on delete cascade,
    student_id                uuid not null references public.students(id) on delete cascade,
    invited_first_name        varchar(100) not null,
    invited_last_name         varchar(100) not null,
    invited_email             varchar(150) not null,
    invited_phone             varchar(30),
    relationship              varchar(30),
    validation_token          varchar(100) not null unique,
    status                    varchar(20) not null default 'pending' check (status in ('pending','completed','cancelled')),
    invited_by_profile_id     uuid references public.profiles(id),
    created_parent_profile_id uuid references public.profiles(id),
    created_at                timestamptz not null default now(),
    completed_at              timestamptz
);
create index idx_parent_invitations_student on public.parent_invitations(student_id);
create index idx_parent_invitations_status on public.parent_invitations(establishment_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.students enable row level security;
alter table public.student_parents enable row level security;
alter table public.parent_invitations enable row level security;

-- Élèves : reproduit StudentController::assertStudentAccess() (rôles à accès
-- complet, ou enseignant/PP limité à ses classes), + l'élève lui-même et ses
-- parents (utile pour les portails élève/parent, ajouté par cohérence avec
-- le reste de l'application même si ce contrôleur ne montrait que le côté
-- "personnel").
create policy students_select on public.students for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
      or profile_id = auth.uid()
      or exists (select 1 from public.student_parents sp where sp.student_id = students.id and sp.parent_id = auth.uid())
      or exists (select 1 from public.classes c where c.id = students.class_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.class_subjects cs where cs.class_id = students.class_id and cs.teacher_id = auth.uid())
    )
  );

-- Création : reproduit la garde conditionnelle sur assertClassManageAccess()
-- (seulement si une classe est fournie à la création).
create policy students_insert on public.students for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','secretaire')
      or (
        public.my_role_code() = 'professeur_principal'
        and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.homeroom_teacher_id = auth.uid()))
      )
    )
  );

-- Modification/archivage : USING = classe ACTUELLE (assertStudentManageAccess),
-- WITH CHECK = classe VISÉE si changée (assertClassManageAccess) — les deux
-- clauses RLS distinctes reproduisent exactement le double contrôle du PHP.
create policy students_update on public.students for update to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','secretaire')
      or (
        public.my_role_code() = 'professeur_principal'
        and exists (select 1 from public.classes c where c.id = students.class_id and c.homeroom_teacher_id = auth.uid())
      )
    )
  )
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','secretaire')
      or (
        public.my_role_code() = 'professeur_principal'
        and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.homeroom_teacher_id = auth.uid()))
      )
    )
  );

-- student_parents : lecture par le parent concerné, le personnel à accès
-- complet, et l'enseignant/PP de la classe de l'élève. Toute écriture passe
-- par les Edge Functions (service_role) — invite-parent / confirm-invitation.
create policy student_parents_select on public.student_parents for select to authenticated
  using (
    parent_id = auth.uid()
    or exists (
      select 1 from public.students s
      where s.id = student_parents.student_id
        and s.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
          or exists (select 1 from public.classes c where c.id = s.class_id and c.homeroom_teacher_id = auth.uid())
          or exists (select 1 from public.class_subjects cs where cs.class_id = s.class_id and cs.teacher_id = auth.uid())
        )
    )
  );

-- parent_invitations : aucune policy — accès exclusivement via service_role
-- (Edge Functions) et via la fonction publique ci-dessous pour la
-- consultation du statut par token.

-- ----------------------------------------------------------------------------
-- Consultation publique du statut d'une invitation par token (page de
-- confirmation, avant authentification) — remplace
-- ParentController::invitationStatus(). Le token fait office de secret,
-- comme dans la version PHP (pas d'authentification supplémentaire requise).
-- ----------------------------------------------------------------------------
create or replace function public.get_parent_invitation_status(p_token text)
returns table (
    invited_first_name varchar, invited_last_name varchar, invited_email varchar,
    relationship varchar, status varchar,
    student_first_name varchar, student_last_name varchar, establishment_name varchar
)
language sql stable security definer set search_path = public
as $$
    select pi.invited_first_name, pi.invited_last_name, pi.invited_email, pi.relationship, pi.status,
           s.first_name, s.last_name, e.name
    from public.parent_invitations pi
    join public.students s on s.id = pi.student_id
    join public.establishments e on e.id = pi.establishment_id
    where pi.validation_token = p_token;
$$;
grant execute on function public.get_parent_invitation_status(text) to anon, authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0006_grades.sql
-- ############################################################################
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


-- ############################################################################
-- FICHIER SOURCE : 0007_attendance.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 7 / N — Présences (section 18 + "Gestion des présences")
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - getSession() (ouvre/crée la feuille d'appel + auto-provisionne un
--     enregistrement 'present' par élève) devient get_or_create_attendance_session(),
--     une fonction SQL SECURITY INVOKER : elle s'appuie sur la RLS
--     existante (pas de contournement) — si l'appelant n'a pas les droits
--     de saisie (assertMarkAccess), l'INSERT échoue nativement avec une
--     violation RLS, sans code de vérification supplémentaire à écrire.
--   - saveSession() (écritures + alertes automatiques après plusieurs
--     absences non justifiées) reste une Edge Function
--     (attendance-save-session) : contrairement aux notes, les emails
--     partent IMMÉDIATEMENT à la sauvegarde ici (pas seulement à une
--     validation explicite), donc l'aller-retour Edge Function est
--     nécessaire dès cette étape — pas de RPC pur possible.
--   - studentHistory() n'a besoin d'AUCUNE fonction dédiée : c'est un simple
--     select PostgREST avec embedding, déjà protégé par la policy de
--     lecture ci-dessous (qui réunit assertMarkAccess + assertClassStaffAccess
--     + assertStudentAccess — direction/vie scolaire, enseignant/PP de la
--     classe, élève lui-même, son parent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Séances d'appel
-- ----------------------------------------------------------------------------
create table public.attendance_sessions (
    id                    uuid primary key default gen_random_uuid(),
    class_subject_id      uuid not null references public.class_subjects(id) on delete cascade,
    session_date          date not null,
    period_label          varchar(40) not null default '',
    taken_by_profile_id   uuid references public.profiles(id),
    taken_at              timestamptz,
    created_at            timestamptz not null default now(),
    unique (class_subject_id, session_date, period_label)
);
create index idx_attendance_sessions_date on public.attendance_sessions(session_date);

-- ----------------------------------------------------------------------------
-- 2. Présences individuelles
-- ----------------------------------------------------------------------------
create table public.attendance_records (
    id                          uuid primary key default gen_random_uuid(),
    session_id                  uuid not null references public.attendance_sessions(id) on delete cascade,
    student_id                  uuid not null references public.students(id) on delete cascade,
    status                      varchar(20) not null default 'present' check (status in ('present','absent','late')),
    justified                   boolean not null default false,
    justification_note          varchar(255),
    justification_document_url  text,
    alerted_at                  timestamptz,
    updated_at                  timestamptz not null default now(),
    unique (session_id, student_id)
);
create index idx_attendance_records_student on public.attendance_records(student_id, status);
create index idx_attendance_records_session on public.attendance_records(session_id);

create trigger trg_attendance_records_updated_at
before update on public.attendance_records
for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

-- Lecture : réunion d'assertMarkAccess + assertClassStaffAccess (direction/vie
-- scolaire, enseignant de la matière, PP de la classe) — les séances n'ont
-- pas de notion de parent/élève individuel, contrairement aux enregistrements.
create policy attendance_sessions_select on public.attendance_sessions for select to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = attendance_sessions.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','surveillant_secteur','secretaire','econome','comptable')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
        )
    )
  );

-- Écriture (création/mise à jour de la séance) : assertMarkAccess strict
-- (pas surveillant_secteur/secretaire/etc. — seulement direction, vie
-- scolaire "générale", et l'enseignant de CETTE matière).
create policy attendance_sessions_mark on public.attendance_sessions for all to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = attendance_sessions.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = attendance_sessions.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  );

-- Présences individuelles : lecture réunissant TOUTES les vues d'origine
-- (feuille d'appel, badge de classe, historique élève/parent).
create policy attendance_records_select on public.attendance_records for select to authenticated
  using (
    exists (
      select 1 from public.attendance_sessions ases
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.classes c on c.id = cs.class_id
      join public.students st on st.id = attendance_records.student_id
      where ases.id = attendance_records.session_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','surveillant_secteur','secretaire','econome','comptable')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
          or st.profile_id = auth.uid()
          or exists (select 1 from public.student_parents sp where sp.student_id = st.id and sp.parent_id = auth.uid())
        )
    )
  );

create policy attendance_records_mark on public.attendance_records for all to authenticated
  using (
    exists (
      select 1 from public.attendance_sessions ases
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.classes c on c.id = cs.class_id
      where ases.id = attendance_records.session_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.attendance_sessions ases
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.classes c on c.id = cs.class_id
      where ases.id = attendance_records.session_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 3. get_or_create_attendance_session() — remplace
--    AttendanceController::getSession()/getOrCreateSession()
-- ----------------------------------------------------------------------------
create or replace function public.get_or_create_attendance_session(
    p_class_subject_id uuid,
    p_session_date date,
    p_period_label text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_class_id uuid;
    v_subject_name text;
    v_session_id uuid;
    v_period text := coalesce(p_period_label, '');
begin
    select cs.class_id, s.name into v_class_id, v_subject_name
      from public.class_subjects cs join public.subjects s on s.id = cs.subject_id
      where cs.id = p_class_subject_id;
    if v_class_id is null then
        raise exception 'class_subject_not_found';
    end if;

    insert into public.attendance_sessions (class_subject_id, session_date, period_label)
    values (p_class_subject_id, p_session_date, v_period)
    on conflict (class_subject_id, session_date, period_label) do nothing;

    select id into v_session_id from public.attendance_sessions
      where class_subject_id = p_class_subject_id and session_date = p_session_date and period_label = v_period;

    insert into public.attendance_records (session_id, student_id, status)
    select v_session_id, st.id, 'present'
    from public.students st
    where st.class_id = v_class_id and st.status = 'active'
    on conflict (session_id, student_id) do nothing;

    return jsonb_build_object(
        'session', (select to_jsonb(s) from public.attendance_sessions s where s.id = v_session_id),
        'subject_name', v_subject_name,
        'students', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'student_id', st.id, 'matricule', st.matricule, 'first_name', st.first_name, 'last_name', st.last_name,
                'record_id', ar.id, 'status', ar.status, 'justified', ar.justified,
                'justification_note', ar.justification_note, 'justification_document_url', ar.justification_document_url,
                'alerted_at', ar.alerted_at
            ) order by st.last_name, st.first_name), '[]'::jsonb)
            from public.students st
            left join public.attendance_records ar on ar.student_id = st.id and ar.session_id = v_session_id
            where st.class_id = v_class_id and st.status = 'active'
        ),
        'stats', (
            select jsonb_build_object(
                'total', count(*),
                'present', count(*) filter (where ar.status = 'present'),
                'absent', count(*) filter (where ar.status = 'absent'),
                'late', count(*) filter (where ar.status = 'late')
            )
            from public.students st
            left join public.attendance_records ar on ar.student_id = st.id and ar.session_id = v_session_id
            where st.class_id = v_class_id and st.status = 'active'
        )
    );
end;
$$;
grant execute on function public.get_or_create_attendance_session(uuid, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. attendance_class_summary_today() — remplace
--    AttendanceController::classSummary() (badge "Absents aujourd'hui")
-- ----------------------------------------------------------------------------
create or replace function public.attendance_class_summary_today(p_class_id uuid, p_date date default current_date)
returns jsonb
language sql stable security invoker set search_path = public
as $$
    select jsonb_build_object(
        'date', p_date,
        'absent_count', count(distinct ar.student_id) filter (where ar.status = 'absent'),
        'late_count', count(distinct ar.student_id) filter (where ar.status = 'late')
    )
    from public.attendance_records ar
    join public.attendance_sessions ases on ases.id = ar.session_id
    join public.class_subjects cs on cs.id = ases.class_subject_id
    where cs.class_id = p_class_id and ases.session_date = p_date;
$$;
grant execute on function public.attendance_class_summary_today(uuid, date) to authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0008_discipline_and_timetable.sql
-- ############################################################################
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


-- ############################################################################
-- FICHIER SOURCE : 0009_progression_and_homework.sql
-- ############################################################################
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


-- ############################################################################
-- FICHIER SOURCE : 0010_communication.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 10 / N — Communication : messagerie, annonces, notifications
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Le "centre de notifications in-app" (section 24) était déjà, dans le
--     PHP d'origine, une alternative maison au push/SMS faute de fournisseur
--     tiers disponible. Sur Supabase, on obtient l'équivalent d'un vrai push
--     GRATUITEMENT via Realtime : il suffit d'ajouter `messages` et
--     `notifications` à la publication `supabase_realtime` (fait en fin de
--     migration) pour que le frontend reçoive les nouveaux messages/
--     notifications instantanément par abonnement, sans purchase ni service
--     tiers, sans code serveur supplémentaire.
--   - list()/messages() (MessagingController) utilisaient des sous-requêtes
--     scalaires corrélées PARCE QUE le LATERAL de MySQL 8 n'est pas supporté
--     par MariaDB — cette contrainte n'existe plus : list_my_conversations()
--     utilise LATERAL nativement, comme l'aurait fait la version PostgreSQL
--     originale avant sa conversion vers MySQL.
--   - startOrGet() (recherche-ou-création transactionnelle d'une conversation
--     directe) devient start_or_get_conversation(), SECURITY DEFINER : elle
--     doit pouvoir insérer une ligne conversation_participants pour LE
--     DESTINATAIRE (pas seulement l'appelant), ce qu'aucune policy RLS
--     raisonnable n'autoriserait pour un simple insert direct.
--   - L'envoi d'un message reste une Edge Function (messaging-send) : email +
--     ligne de notification pour l'autre participant à chaque message,
--     comme le PHP d'origine — mais rien n'empêche d'alléger ça plus tard en
--     s'appuyant davantage sur Realtime plutôt que sur l'email systématique.
-- ============================================================================

-- Helper manquant jusqu'ici : le "scope" du rôle (family vs establishment vs
-- national), utilisé pour distinguer vue parent / vue personnel des annonces.
create or replace function public.my_role_scope()
returns text
language sql stable security definer set search_path = public
as $$
  select r.scope from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 1. Messagerie interne
-- ----------------------------------------------------------------------------
create table public.conversations (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    type                  varchar(20) not null default 'direct' check (type in ('direct','group')),
    title                 varchar(150),
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now()
);
create index idx_conversations_establishment on public.conversations(establishment_id);

create table public.conversation_participants (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references public.conversations(id) on delete cascade,
    user_id          uuid not null references public.profiles(id) on delete cascade,
    last_read_at     timestamptz,
    joined_at        timestamptz not null default now(),
    unique (conversation_id, user_id)
);
create index idx_conversation_participants_user on public.conversation_participants(user_id);

create table public.messages (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references public.conversations(id) on delete cascade,
    sender_id        uuid not null references public.profiles(id),
    body             varchar(2000) not null,
    created_at       timestamptz not null default now()
);
create index idx_messages_conversation on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = conversations.id and cp.user_id = auth.uid()));

-- Pas de policy INSERT directe : la création passe exclusivement par
-- start_or_get_conversation() (SECURITY DEFINER, ci-dessous).

create policy conversation_participants_select on public.conversation_participants for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.conversation_participants cp2 where cp2.conversation_id = conversation_participants.conversation_id and cp2.user_id = auth.uid())
  );

create policy conversation_participants_update_self on public.conversation_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()));

create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversation_participants cp where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid())
  );
-- Pas d'update/delete sur les messages (comme dans le PHP d'origine).

-- ----------------------------------------------------------------------------
-- start_or_get_conversation() — remplace MessagingController::startOrGet()
-- ----------------------------------------------------------------------------
create or replace function public.start_or_get_conversation(p_recipient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_me uuid := auth.uid();
    v_existing_id uuid;
    v_new_id uuid;
begin
    if p_recipient_id = v_me then
        raise exception 'messaging_cannot_message_self';
    end if;
    if not exists (select 1 from public.profiles where id = p_recipient_id and establishment_id = v_establishment_id and status = 'active') then
        raise exception 'messaging_recipient_not_found';
    end if;

    select c.id into v_existing_id
    from public.conversations c
    where c.type = 'direct' and c.establishment_id = v_establishment_id
      and exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = v_me)
      and exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = p_recipient_id)
      and (select count(*) from public.conversation_participants where conversation_id = c.id) = 2
    limit 1;

    if v_existing_id is not null then
        return jsonb_build_object('conversation_id', v_existing_id, 'created', false);
    end if;

    insert into public.conversations (establishment_id, type, created_by_profile_id)
    values (v_establishment_id, 'direct', v_me)
    returning id into v_new_id;

    insert into public.conversation_participants (conversation_id, user_id) values (v_new_id, v_me), (v_new_id, p_recipient_id);

    return jsonb_build_object('conversation_id', v_new_id, 'created', true);
end;
$$;
grant execute on function public.start_or_get_conversation(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- list_my_conversations() — remplace MessagingController::list(). LATERAL
-- natif (plus de sous-requêtes corrélées répétées trois fois).
-- ----------------------------------------------------------------------------
create or replace function public.list_my_conversations()
returns jsonb
language sql stable security invoker set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'created_at', c.created_at,
        'other_user_id', other.id, 'other_first_name', other.first_name, 'other_last_name', other.last_name,
        'other_role_code', r.code, 'other_role_label_fr', r.label_fr, 'other_role_label_en', r.label_en,
        'last_message_body', lm.body, 'last_message_at', lm.created_at, 'last_message_sender_id', lm.sender_id,
        'unread_count', (
            select count(*) from public.messages m
            where m.conversation_id = c.id and m.sender_id <> auth.uid()
              and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
        )
    ) order by coalesce(lm.created_at, c.created_at) desc), '[]'::jsonb)
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    join public.conversation_participants other_cp on other_cp.conversation_id = c.id and other_cp.user_id <> auth.uid()
    join public.profiles other on other.id = other_cp.user_id
    join public.roles r on r.id = other.role_id
    left join lateral (
        select body, created_at, sender_id from public.messages where conversation_id = c.id order by created_at desc limit 1
    ) lm on true
    where cp.user_id = auth.uid();
$$;
grant execute on function public.list_my_conversations() to authenticated;

-- ----------------------------------------------------------------------------
-- open_conversation() — remplace MessagingController::messages() (lecture +
-- marquage "lu" en un seul aller-retour)
-- ----------------------------------------------------------------------------
create or replace function public.open_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_messages jsonb;
begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'body', m.body, 'created_at', m.created_at, 'sender_id', m.sender_id,
        'sender_first_name', p.first_name, 'sender_last_name', p.last_name
    ) order by m.created_at asc), '[]'::jsonb)
    into v_messages
    from public.messages m join public.profiles p on p.id = m.sender_id
    where m.conversation_id = p_conversation_id;

    update public.conversation_participants set last_read_at = now()
      where conversation_id = p_conversation_id and user_id = auth.uid();

    return jsonb_build_object('messages', v_messages);
end;
$$;
grant execute on function public.open_conversation(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Annonces
-- ----------------------------------------------------------------------------
create table public.announcements (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    title                 varchar(255) not null,
    body                  varchar(2000) not null,
    audience              varchar(30) not null check (audience in ('all_establishment','all_staff','all_parents','class')),
    class_id              uuid references public.classes(id) on delete cascade,
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now()
);
create index idx_announcements_establishment on public.announcements(establishment_id, created_at desc);

alter table public.announcements enable row level security;

-- Lecture : reproduit la vue parent / vue personnel d'AnnouncementController::list().
create policy announcements_select on public.announcements for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      audience = 'all_establishment'
      or (public.my_role_scope() = 'family' and audience = 'all_parents')
      or (public.my_role_scope() <> 'family' and audience = 'all_staff')
      or (audience = 'class' and (
            (public.my_role_scope() = 'family' and class_id in (
                select s.class_id from public.student_parents sp join public.students s on s.id = sp.student_id
                where sp.parent_id = auth.uid()
            ))
            or (public.my_role_scope() <> 'family' and class_id in (
                select id from public.classes where homeroom_teacher_id = auth.uid()
                union
                select class_id from public.class_subjects where teacher_id = auth.uid()
            ))
          ))
    )
  );

-- Création : administration = toute audience ; le reste = seulement 'class',
-- et seulement leur propre classe.
create policy announcements_insert on public.announcements for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire')
      or (
        audience = 'class'
        and class_id in (
          select id from public.classes where homeroom_teacher_id = auth.uid()
          union
          select class_id from public.class_subjects where teacher_id = auth.uid()
        )
      )
    )
  );

-- Suppression : l'auteur, ou la direction.
create policy announcements_delete on public.announcements for delete to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (created_by_profile_id = auth.uid() or public.my_role_code() in ('proviseur','principal','directeur'))
  );

-- ----------------------------------------------------------------------------
-- 3. Centre de notifications in-app
-- ----------------------------------------------------------------------------
create table public.notifications (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references public.profiles(id) on delete cascade,
    establishment_id  uuid references public.establishments(id) on delete cascade,
    type              varchar(40) not null,
    title             varchar(255) not null,
    body              varchar(500),
    link              varchar(255),
    read_at           timestamptz,
    created_at        timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Pas de policy INSERT : uniquement créées par les Edge Functions (service_role).

-- ----------------------------------------------------------------------------
-- 4. Realtime — messages et notifications instantanés côté frontend, sans
--    fournisseur tiers ni Edge Function de polling.
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.conversation_participants;


-- ############################################################################
-- FICHIER SOURCE : 0011_payments.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 11 / N — Paiements (frais de scolarité, Mobile Money,
-- Premium Parents)
-- ============================================================================
-- ⚠️ IMPORTANT : comme dans le PHP d'origine, l'intégration Mobile Money
-- fournie ici est un STUB DE DÉVELOPPEMENT (MobileMoneyGateway simulait déjà
-- le webhook faute d'identifiants Orange/MTN réels). payments_confirm_dev()
-- et la référence "DEV-xxxxx" ci-dessous ne sont PAS un paiement réel — avant
-- toute mise en production, il faut les remplacer par l'intégration officielle
-- Orange Money / MTN MoMo (webhook signé, vérification de signature, etc.).
-- Rien dans cette étape ne doit être considéré comme prêt pour de l'argent réel.
--
-- CHOIX D'ARCHITECTURE :
--   - applyPaymentToInvoice() (SELECT ... FOR UPDATE puis recalcul manuel du
--     statut de la facture) devient un TRIGGER sur `payments` : dès qu'un
--     paiement passe à 'completed' (à l'insert direct — encaissement manuel —
--     ou à la mise à jour — confirmation Mobile Money), la facture ou
--     l'abonnement Premium concerné est mis à jour automatiquement, avec le
--     verrouillage de ligne implicite d'un UPDATE Postgres (plus besoin de
--     FOR UPDATE explicite). Un seul trigger couvre les deux cibles
--     (student_fee_id / premium_subscription_id) — les colonnes
--     concours_subscription_id / bulletin_subscription_id du PHP (étape 13)
--     seront ajoutées à ce même trigger le moment venu.
--   - Le numéro de reçu (attribué uniquement quand un paiement devient
--     'completed') est généré par le même trigger, plus besoin d'appeler
--     MobileMoneyGateway::generateReceiptNumber() avant l'insert.
--   - "Un seul abonnement actif à la fois" : la version MySQL contournait
--     l'absence d'index unique partiel avec une colonne générée
--     "active_flag". PostgreSQL supporte nativement les index uniques
--     partiels (`WHERE status = 'active'`) — le contournement disparaît.
--   - generate_fee_invoices() (RPC) remplace FeeController::generateInvoices() —
--     idempotent via ON CONFLICT DO NOTHING, comme en PHP.
--   - invoice_pay_mobile_money() / premium_subscribe() (RPC, SECURITY
--     DEFINER) remplacent payInvoiceMobileMoney()/subscribe() : ils créent
--     le paiement 'pending' ET la ligne cible (abonnement) de façon atomique,
--     et appliquent eux-mêmes assertFeeAccess/assertParentOfStudent.
--   - payments-confirm-dev reste une Edge Function : c'est la SEULE étape
--     encore utile une fois le trigger en place, car l'email d'activation
--     Premium (activatePremiumSubscription) nécessite un envoi externe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Frais de scolarité
-- ----------------------------------------------------------------------------
create table public.fee_structures (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    school_year_id        uuid not null references public.school_years(id) on delete cascade,
    label                 varchar(150) not null,
    level                 varchar(40),
    series                varchar(40),
    amount                numeric(12,2) not null check (amount > 0),
    due_date              date,
    status                varchar(20) not null default 'active' check (status in ('active','archived')),
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now()
);
create index idx_fee_structures_establishment on public.fee_structures(establishment_id, school_year_id, status);

create trigger trg_fee_structures_audit
after insert or update on public.fee_structures
for each row execute function public.log_audit_event();

create table public.student_fees (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    fee_structure_id  uuid not null references public.fee_structures(id) on delete cascade,
    amount_due        numeric(12,2) not null,
    amount_paid       numeric(12,2) not null default 0,
    status            varchar(20) not null default 'unpaid' check (status in ('unpaid','partial','paid')),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (student_id, fee_structure_id)
);
create index idx_student_fees_establishment on public.student_fees(establishment_id, status);
create index idx_student_fees_student on public.student_fees(student_id);

create trigger trg_student_fees_updated_at
before update on public.student_fees
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Abonnements Premium Parents (500 FCFA/mois)
-- ----------------------------------------------------------------------------
create table public.premium_subscriptions (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    parent_id         uuid not null references public.profiles(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    amount            numeric(12,2) not null default 500,
    status            varchar(20) not null default 'pending' check (status in ('pending','active','expired','cancelled')),
    period_start      date,
    period_end        date,
    created_at        timestamptz not null default now()
);
create index idx_premium_subscriptions_parent on public.premium_subscriptions(parent_id, student_id);
-- Un seul abonnement actif à la fois par couple parent/élève — index unique
-- partiel natif (remplace le contournement "active_flag" du MySQL).
create unique index idx_premium_subscriptions_one_active on public.premium_subscriptions(parent_id, student_id)
  where status = 'active';

-- ----------------------------------------------------------------------------
-- 3. Paiements
-- ----------------------------------------------------------------------------
create table public.payments (
    id                      uuid primary key default gen_random_uuid(),
    establishment_id        uuid not null references public.establishments(id) on delete cascade,
    student_fee_id          uuid references public.student_fees(id) on delete cascade,
    premium_subscription_id uuid references public.premium_subscriptions(id) on delete cascade,
    amount                  numeric(12,2) not null check (amount > 0),
    method                  varchar(20) not null check (method in ('cash','orange_money','mtn_momo','bank_card')),
    provider_reference      varchar(100),
    payer_phone             varchar(30),
    status                  varchar(20) not null default 'pending' check (status in ('pending','completed','failed','cancelled')),
    initiated_by_profile_id uuid references public.profiles(id),
    receipt_number          varchar(30) unique,
    paid_at                 timestamptz,
    created_at              timestamptz not null default now(),
    constraint payments_exactly_one_target check (
        (student_fee_id is not null)::int + (premium_subscription_id is not null)::int = 1
    )
);
create index idx_payments_establishment on public.payments(establishment_id, status, created_at desc);
create index idx_payments_student_fee on public.payments(student_fee_id);
create index idx_payments_premium_subscription on public.payments(premium_subscription_id);

create trigger trg_payments_audit
after insert or update on public.payments
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 4. Suivi renforcé Premium — ajout additif à attendance_records (étape 7)
-- ----------------------------------------------------------------------------
alter table public.attendance_records add column checkout_at timestamptz;

-- Confidentialité de COLONNE (pas seulement de ligne) : la RLS de l'étape 7
-- autorise déjà TOUT parent à lire les présences de son enfant — une policy
-- de ligne ne suffit donc pas à réserver checkout_at aux abonnés Premium.
-- PostgreSQL permet un GRANT/REVOKE par colonne ; combiné à
-- premium_checkout_history() (SECURITY DEFINER, qui s'exécute avec les
-- droits du propriétaire de la fonction et n'est donc pas concerné par ce
-- REVOKE), on obtient une vraie confidentialité de colonne.
revoke select (checkout_at) on public.attendance_records from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. Trigger central : effets d'un paiement qui devient 'completed'/'failed'
-- ----------------------------------------------------------------------------
create or replace function public.generate_receipt_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    candidate text;
begin
    loop
        candidate := 'RC' || to_char(now(), 'YYMMDD') || lpad(floor(random() * 100000)::text, 5, '0');
        exit when not exists (select 1 from public.payments where receipt_number = candidate);
    end loop;
    return candidate;
end;
$$;

create or replace function public.payments_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if TG_OP = 'UPDATE' and old.status = new.status then
        return new;
    end if;

    if new.status = 'completed' then
        -- Toujours réattribués par le serveur à la transition — jamais dictés
        -- par le payload client (même si status='completed' était déjà
        -- accompagné d'un receipt_number/paid_at dans la requête).
        new.receipt_number := public.generate_receipt_number();
        new.paid_at := now();

        if new.student_fee_id is not null then
            -- Garde-fou absent d'un simple insert direct (encaissement manuel) :
            -- reproduit la vérification "amount > remaining" de recordManualPayment().
            if new.amount > (
                select (amount_due - amount_paid) + 0.01 from public.student_fees where id = new.student_fee_id
            ) then
                raise exception 'payment_exceeds_balance';
            end if;

            update public.student_fees
              set amount_paid = amount_paid + new.amount,
                  status = case
                    when amount_paid + new.amount >= amount_due - 0.01 then 'paid'
                    when amount_paid + new.amount > 0 then 'partial'
                    else 'unpaid'
                  end
              where id = new.student_fee_id;
        elsif new.premium_subscription_id is not null then
            update public.premium_subscriptions
              set status = 'active', period_start = current_date, period_end = current_date + interval '1 month'
              where id = new.premium_subscription_id;
        end if;
    elsif new.status = 'failed' and new.premium_subscription_id is not null then
        update public.premium_subscriptions set status = 'cancelled' where id = new.premium_subscription_id;
    end if;

    return new;
end;
$$;

create trigger trg_payments_apply_effects
before insert or update on public.payments
for each row execute function public.payments_apply_effects();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.fee_structures enable row level security;
alter table public.student_fees enable row level security;
alter table public.premium_subscriptions enable row level security;
alter table public.payments enable row level security;

-- Catalogue des frais : lecture large (nécessaire pour l'affichage des
-- factures d'un parent, cf. embedding PostgREST fee_structures(label,due_date)) ;
-- gestion réservée à payments.manage.
create policy fee_structures_select on public.fee_structures for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy fee_structures_manage on public.fee_structures for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('payments.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('payments.manage'));

-- Factures élève : personnel payments.manage, ou le(s) parent(s) de l'élève.
create policy student_fees_select on public.student_fees for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.has_permission('payments.manage')
      or exists (select 1 from public.student_parents sp where sp.student_id = student_fees.student_id and sp.parent_id = auth.uid())
    )
  );
-- Pas de policy INSERT/UPDATE cliente : généré par generate_fee_invoices()
-- et mis à jour par le trigger payments_apply_effects (tous deux SECURITY DEFINER).

-- Abonnements Premium : strictement réservé au parent concerné (comme le
-- PHP : "premium_parent_only", aucune visibilité staff exposée par ces routes).
create policy premium_subscriptions_select on public.premium_subscriptions for select to authenticated
  using (parent_id = auth.uid());
create policy premium_subscriptions_cancel on public.premium_subscriptions for update to authenticated
  using (parent_id = auth.uid() and status = 'active')
  with check (parent_id = auth.uid() and status = 'cancelled');
-- Pas de policy INSERT : uniquement via premium_subscribe() (SECURITY DEFINER).

-- Paiements : personnel payments.manage, ou l'auteur du paiement (assertPaymentOwnership).
create policy payments_select on public.payments for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (public.has_permission('payments.manage') or initiated_by_profile_id = auth.uid())
  );

-- Encaissement manuel (espèces/carte) par le personnel — Mobile Money passe
-- exclusivement par les RPC dédiées (SECURITY DEFINER), jamais par un insert direct.
create policy payments_insert_manual on public.payments for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and public.has_permission('payments.manage')
    and method in ('cash','bank_card')
  );

-- Confirmation (dev uniquement, via payments-confirm-dev) : le propriétaire
-- ou le personnel payments.manage, seulement depuis 'pending'.
create policy payments_update_confirm on public.payments for update to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and status = 'pending'
    and (public.has_permission('payments.manage') or initiated_by_profile_id = auth.uid())
  )
  with check (establishment_id = public.my_establishment_id());

-- ----------------------------------------------------------------------------
-- 6. generate_fee_invoices() — remplace FeeController::generateInvoices()
-- ----------------------------------------------------------------------------
create or replace function public.generate_fee_invoices(p_fee_structure_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_fee record;
    v_created integer := 0;
    v_candidates integer;
begin
    select * into v_fee from public.fee_structures where id = p_fee_structure_id;
    if v_fee is null or v_fee.establishment_id is distinct from public.my_establishment_id() then
        raise exception 'fee_structure_not_found';
    end if;

    with candidates as (
        select s.id from public.students s left join public.classes c on c.id = s.class_id
        where s.establishment_id = v_fee.establishment_id and s.status = 'active'
          and (v_fee.level is null or c.level = v_fee.level)
          and (v_fee.series is null or c.series = v_fee.series)
    ),
    inserted as (
        insert into public.student_fees (establishment_id, student_id, fee_structure_id, amount_due)
        select v_fee.establishment_id, id, v_fee.id, v_fee.amount from candidates
        on conflict (student_id, fee_structure_id) do nothing
        returning 1
    )
    select count(*) from candidates into v_candidates;
    select count(*) from inserted into v_created;

    return jsonb_build_object('created', v_created, 'candidates', v_candidates);
end;
$$;
grant execute on function public.generate_fee_invoices(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. invoice_pay_mobile_money() / premium_subscribe() — remplacent
--    PaymentController::payInvoiceMobileMoney()/subscribe() +
--    PaymentController::initiatePayment() (STUB — voir avertissement en tête
--    de fichier : provider_reference est une référence de développement).
-- ----------------------------------------------------------------------------
create or replace function public.invoice_pay_mobile_money(p_invoice_id uuid, p_method text, p_phone text, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invoice record;
    v_remaining numeric;
    v_amount numeric;
    v_payment_id uuid;
    v_authorized boolean;
begin
    select * into v_invoice from public.student_fees where id = p_invoice_id;
    if v_invoice is null or v_invoice.establishment_id is distinct from public.my_establishment_id() then
        raise exception 'invoice_not_found';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;

    select public.has_permission('payments.manage')
        or exists (select 1 from public.student_parents sp where sp.student_id = v_invoice.student_id and sp.parent_id = auth.uid())
    into v_authorized;
    if not v_authorized then
        raise exception 'student_manage_denied';
    end if;

    v_remaining := v_invoice.amount_due - v_invoice.amount_paid;
    v_amount := coalesce(p_amount, v_remaining);
    if v_amount <= 0 or v_amount > v_remaining + 0.01 then
        raise exception 'payment_exceeds_balance';
    end if;

    insert into public.payments (establishment_id, student_fee_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_invoice.establishment_id, v_invoice.id, v_amount, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', v_amount, 'status', 'pending');
end;
$$;
grant execute on function public.invoice_pay_mobile_money(uuid, text, text, numeric) to authenticated;

create or replace function public.premium_subscribe(p_student_id uuid, p_method text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_sub_id uuid;
    v_payment_id uuid;
begin
    if public.my_role_code() <> 'parent' then
        raise exception 'premium_parent_only';
    end if;
    if not exists (select 1 from public.student_parents where student_id = p_student_id and parent_id = auth.uid()) then
        raise exception 'student_manage_denied';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;
    if exists (select 1 from public.premium_subscriptions where parent_id = auth.uid() and student_id = p_student_id and status = 'active') then
        raise exception 'premium_already_active';
    end if;

    insert into public.premium_subscriptions (establishment_id, parent_id, student_id, amount, status)
    values (v_establishment_id, auth.uid(), p_student_id, 500, 'pending')
    returning id into v_sub_id;

    insert into public.payments (establishment_id, premium_subscription_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_establishment_id, v_sub_id, 500, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', 500, 'status', 'pending');
end;
$$;
grant execute on function public.premium_subscribe(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. payment_receipt() / premium_checkout_history() — lecture enrichie,
--    remplacent PaymentController::receipt()/checkoutTimes().
-- ----------------------------------------------------------------------------
create or replace function public.payment_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_payment public.payments;
    v_subject jsonb;
    v_label text;
begin
    select * into v_payment from public.payments where id = p_payment_id;
    if v_payment is null then
        raise exception 'payment_not_found';
    end if;
    if v_payment.status <> 'completed' then
        raise exception 'receipt_not_available';
    end if;

    if v_payment.student_fee_id is not null then
        select jsonb_build_object('first_name', s.first_name, 'last_name', s.last_name, 'matricule', s.matricule, 'student_id', s.id), fs.label
          into v_subject, v_label
          from public.student_fees sf join public.students s on s.id = sf.student_id join public.fee_structures fs on fs.id = sf.fee_structure_id
          where sf.id = v_payment.student_fee_id;
    else
        select jsonb_build_object('first_name', s.first_name, 'last_name', s.last_name, 'matricule', s.matricule, 'student_id', s.id), 'Abonnement Premium Parents'
          into v_subject, v_label
          from public.premium_subscriptions ps join public.students s on s.id = ps.student_id
          where ps.id = v_payment.premium_subscription_id;
    end if;

    if v_subject is null then
        raise exception 'receipt_not_available';
    end if;

    return jsonb_build_object(
        'payment', to_jsonb(v_payment),
        'establishment', (select jsonb_build_object('name', name, 'code', code, 'address', address) from public.establishments where id = v_payment.establishment_id),
        'student', v_subject,
        'label', v_label
    );
end;
$$;
grant execute on function public.payment_receipt(uuid) to authenticated;

create or replace function public.premium_checkout_history(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.premium_subscriptions
        where parent_id = auth.uid() and student_id = p_student_id and status = 'active'
    ) then
        raise exception 'premium_required';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'session_date', ases.session_date, 'period_label', ases.period_label,
            'subject_name', sub.name, 'status', ar.status, 'checkout_at', ar.checkout_at
        ) order by ases.session_date desc), '[]'::jsonb)
        from public.attendance_records ar
        join public.attendance_sessions ases on ases.id = ar.session_id
        join public.class_subjects cs on cs.id = ases.class_subject_id
        join public.subjects sub on sub.id = cs.subject_id
        where ar.student_id = p_student_id and ar.checkout_at is not null
        limit 30
    );
end;
$$;
grant execute on function public.premium_checkout_history(uuid) to authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0012_documents_and_library.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 12 / N — Gestion documentaire (section 8) & Bibliothèque numérique (section 9)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Fichiers : deux buckets Supabase Storage PRIVÉS ("documents",
--     "library"), même principe qu'à l'étape 9 (homework) — jamais d'URL
--     publique, accès uniquement via une URL signée à durée limitée après
--     vérification d'accès.
--   - list()/studentDocuments() (lecture) et trash()/restore() (bascule
--     simple d'un champ) sont de simples select/update PostgREST protégés
--     par RLS — pas besoin d'Edge Function. Seuls l'upload (multipart) et la
--     suppression définitive (doit aussi supprimer l'objet Storage) restent
--     des Edge Functions.
--   - Corrections reproduites à l'identique du PHP d'origine à cette même
--     étape : permission `documents.manage` créée et attribuée à
--     proviseur/principal (+ directeur, cohérent avec le reste de la
--     conversion) et secrétaire ; `students.view` ajoutée à la secrétaire
--     (elle avait déjà `students.manage` mais pas la permission qui protège
--     la recherche GET /students, nécessaire pour rattacher un document) ;
--     `library.manage` étendue aux enseignants/PP.
-- ============================================================================

insert into public.permissions (code, label_fr, label_en, category) values
    ('documents.manage', 'Gérer les documents administratifs', 'Manage administrative documents', 'resources')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('proviseur','principal','directeur','secretaire') and p.code = 'documents.manage'
on conflict do nothing;

-- Correction reproduite du PHP : la secrétaire avait students.manage mais
-- pas students.view (nécessaire pour retrouver un élève auquel rattacher un document).
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'secretaire'), (select id from public.permissions where code = 'students.view')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('enseignant','professeur_principal') and p.code = 'library.manage'
on conflict do nothing;

-- Buckets privés — jamais d'URL publique.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('library', 'library', false) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 1. Documents administratifs
-- ----------------------------------------------------------------------------
create table public.documents (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    student_id            uuid references public.students(id) on delete cascade,
    category              varchar(30) not null check (category in (
        'bulletin','birth_certificate','medical_certificate','photo','diploma',
        'timetable','circular','administrative_note'
    )),
    title                 varchar(180) not null,
    storage_path          text not null,
    original_filename     varchar(255) not null,
    mime_type             varchar(100) not null,
    file_size_bytes       integer not null,
    uploaded_by_profile_id uuid references public.profiles(id),
    deleted_at            timestamptz,
    created_at            timestamptz not null default now()
);
create index idx_documents_establishment on public.documents(establishment_id, deleted_at, category);
create index idx_documents_student on public.documents(student_id, deleted_at);

create trigger trg_documents_audit
after insert or update on public.documents
for each row execute function public.log_audit_event();

alter table public.documents enable row level security;

-- Lecture : personnel documents.manage (voit tout, y compris la corbeille),
-- ou parent d'un élève précis (documents généraux student_id NULL exclus,
-- corbeille masquée) — reproduit assertDocumentAccess().
create policy documents_select on public.documents for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.has_permission('documents.manage')
      or (
        deleted_at is null and student_id is not null
        and exists (select 1 from public.student_parents sp where sp.student_id = documents.student_id and sp.parent_id = auth.uid())
      )
    )
  );

create policy documents_insert on public.documents for insert to authenticated
  with check (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage'));
create policy documents_update on public.documents for update to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage'));
-- Suppression définitive réservée aux documents déjà en corbeille (comme le PHP).
create policy documents_delete on public.documents for delete to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage') and deleted_at is not null);

-- ----------------------------------------------------------------------------
-- 2. Bibliothèque numérique
-- ----------------------------------------------------------------------------
create table public.library_resources (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    category              varchar(30) not null check (category in (
        'book','pdf','exercise','past_exam','answer_key','video','podcast','interactive_course'
    )),
    title                 varchar(180) not null,
    description           varchar(500),
    level                 varchar(40),
    subject_id            uuid references public.subjects(id) on delete set null,
    storage_path          text not null,
    original_filename     varchar(255) not null,
    mime_type             varchar(100) not null,
    file_size_bytes       integer not null,
    uploaded_by_profile_id uuid references public.profiles(id),
    deleted_at            timestamptz,
    created_at            timestamptz not null default now()
);
create index idx_library_establishment on public.library_resources(establishment_id, deleted_at, category);
create index idx_library_subject on public.library_resources(subject_id);
create index idx_library_level on public.library_resources(establishment_id, level);

create trigger trg_library_resources_audit
after insert or update on public.library_resources
for each row execute function public.log_audit_event();

alter table public.library_resources enable row level security;

-- Lecture : ouverte à tout membre authentifié de l'établissement (élèves,
-- parents, personnel) comme une bibliothèque d'école — corbeille masquée
-- sauf pour library.manage.
create policy library_select on public.library_resources for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (deleted_at is null or public.has_permission('library.manage'))
  );

create policy library_insert on public.library_resources for insert to authenticated
  with check (establishment_id = public.my_establishment_id() and public.has_permission('library.manage'));
create policy library_update on public.library_resources for update to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('library.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('library.manage'));
create policy library_delete on public.library_resources for delete to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('library.manage') and deleted_at is not null);


-- ############################################################################
-- FICHIER SOURCE : 0013_orientation_and_exams.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 13 / N — Orientation (IA Claude), Préparation aux concours
-- & Bulletins pilotés par IA (IA GPT)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Élargit payments_exactly_one_target (étape 11) à 4 cibles et étend le
--     trigger payments_apply_effects existant (CREATE OR REPLACE, pas de
--     nouveau trigger) pour activer concours_subscriptions/bulletin_subscriptions
--     à la confirmation — même mécanique que Premium Parents.
--   - Accès élève à sa propre orientation/ses épreuves/bulletins : le PHP
--     d'origine documentait explicitement cette restriction comme une
--     limitation temporaire ("les comptes élèves ne sont pas encore créés
--     par la plateforme") — or les comptes élèves EXISTENT dans cette
--     conversion depuis l'étape 5 (student-create-login). L'accès est donc
--     étendu au profil de l'élève lui-même, dans l'esprit explicite du PHP
--     plutôt qu'en contradiction avec lui.
--   - Les appels aux API Anthropic (orientation) et OpenAI (épreuves,
--     correction, bulletins) restent des Edge Functions — ce sont des appels
--     sortants vers un fournisseur tiers, impossibles à faire depuis
--     PostgreSQL seul. Chaque fonction reproduit le system prompt exact du
--     PHP d'origine.
--   - concours_subscribe()/bulletin_subscribe() (RPC) suivent exactement le
--     même schéma que premium_subscribe() (étape 11) : pas d'appel externe à
--     l'initiation, donc pas besoin d'Edge Function pour ÇA — seule la
--     confirmation (payments-confirm-dev, étendue ici) envoie un email.
--   - PDF du bulletin : HORS PÉRIMÈTRE (comme à l'étape 11) — la version
--     imprimable navigateur (déjà gérée côté frontend) reste le repli, comme
--     dans le PHP d'origine lorsque mPDF n'est pas installé.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Paiements : élargissement à 4 cibles
-- ----------------------------------------------------------------------------
alter table public.payments add column concours_subscription_id uuid;
alter table public.payments add column bulletin_subscription_id uuid;

alter table public.payments drop constraint payments_exactly_one_target;

-- ----------------------------------------------------------------------------
-- 1. Orientation scolaire — historique des analyses IA
-- ----------------------------------------------------------------------------
create table public.career_assessments (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    student_id             uuid not null references public.students(id) on delete cascade,
    requested_by_profile_id uuid references public.profiles(id),
    content                jsonb not null,
    ai_model               varchar(60) not null,
    created_at             timestamptz not null default now()
);
create index idx_career_assessments_student on public.career_assessments(student_id, created_at desc);

alter table public.career_assessments enable row level security;

-- Reproduit assertAccess() d'OrientationController, étendu au profil élève
-- lui-même (voir note en tête de fichier).
create policy career_assessments_select on public.career_assessments for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = career_assessments.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = career_assessments.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = career_assessments.student_id and s.profile_id = auth.uid())
    )
  );
-- Pas de policy INSERT cliente : uniquement via l'Edge Function orientation-generate.

-- ----------------------------------------------------------------------------
-- 2. Préparation aux concours — abonnement, épreuves, tentatives
-- ----------------------------------------------------------------------------
create table public.concours_subscriptions (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    school_year_id    uuid not null references public.school_years(id) on delete cascade,
    tier              varchar(20) not null check (tier in ('limited','unlimited')),
    amount            numeric(12,2) not null,
    status            varchar(20) not null default 'pending' check (status in ('pending','active','cancelled')),
    created_at        timestamptz not null default now(),
    unique (student_id, school_year_id)
);

alter table public.payments add constraint fk_pay_concours_sub
    foreign key (concours_subscription_id) references public.concours_subscriptions(id) on delete cascade;

alter table public.concours_subscriptions enable row level security;

-- Lecture large (comme ExamController::assertAccess — PAS parent-only,
-- contrairement à Premium Parents) ; écriture uniquement via concours_subscribe().
create policy concours_subscriptions_select on public.concours_subscriptions for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = concours_subscriptions.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = concours_subscriptions.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = concours_subscriptions.student_id and s.profile_id = auth.uid())
    )
  );

create table public.exam_papers (
    id                       uuid primary key default gen_random_uuid(),
    establishment_id         uuid not null references public.establishments(id) on delete cascade,
    requested_by_student_id  uuid not null references public.students(id) on delete cascade,
    subject_id               uuid references public.subjects(id) on delete set null,
    subject_label            varchar(120) not null,
    level                    varchar(40) not null,
    difficulty               varchar(20) not null default 'medium' check (difficulty in ('easy','medium','hard')),
    time_limit_minutes       smallint not null default 30,
    questions                jsonb not null,
    ai_model                 varchar(60) not null,
    created_at               timestamptz not null default now()
);
create index idx_exam_papers_student on public.exam_papers(requested_by_student_id, created_at desc);
create index idx_exam_papers_establishment_subject on public.exam_papers(establishment_id, subject_id, level);

create table public.exam_attempts (
    id             uuid primary key default gen_random_uuid(),
    exam_paper_id  uuid not null references public.exam_papers(id) on delete cascade,
    student_id     uuid not null references public.students(id) on delete cascade,
    started_at     timestamptz not null default now(),
    submitted_at   timestamptz,
    answers        jsonb,
    score          numeric(6,2),
    max_score      numeric(6,2),
    feedback       jsonb,
    status         varchar(20) not null default 'in_progress' check (status in ('in_progress','submitted','graded')),
    created_at     timestamptz not null default now(),
    unique (exam_paper_id, student_id)
);
create index idx_exam_attempts_student on public.exam_attempts(student_id, status);

alter table public.exam_papers enable row level security;
alter table public.exam_attempts enable row level security;

create policy exam_papers_select on public.exam_papers for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = exam_papers.requested_by_student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = exam_papers.requested_by_student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = exam_papers.requested_by_student_id and s.profile_id = auth.uid())
    )
  );
-- Pas de policy INSERT : uniquement via exam-generate (vérifie l'abonnement
-- + le quota, ce qu'une policy seule ne pourrait pas exprimer proprement).

create policy exam_attempts_select on public.exam_attempts for select to authenticated
  using (
    exists (
      select 1 from public.exam_papers ep where ep.id = exam_attempts.exam_paper_id
      and (
        public.my_role_code() in ('proviseur','principal','directeur','censeur')
        or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = ep.requested_by_student_id and c.homeroom_teacher_id = auth.uid())
        or exists (select 1 from public.student_parents sp where sp.student_id = ep.requested_by_student_id and sp.parent_id = auth.uid())
        or exists (select 1 from public.students s where s.id = ep.requested_by_student_id and s.profile_id = auth.uid())
      )
    )
  );
-- start() (insert) est un simple enregistrement d'horodatage, sans appel IA :
-- une policy RLS suffit ici (pas besoin d'Edge Function).
create policy exam_attempts_start on public.exam_attempts for insert to authenticated
  with check (
    exists (
      select 1 from public.exam_papers ep join public.students s on s.id = ep.requested_by_student_id
      where ep.id = exam_attempts.exam_paper_id and s.profile_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- concours_subscribe() — remplace ExamController::subscribe() + initiatePayment()
-- ----------------------------------------------------------------------------
create or replace function public.concours_subscribe(p_student_id uuid, p_tier text, p_method text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_school_year_id uuid;
    v_sub_id uuid;
    v_amount numeric;
    v_payment_id uuid;
begin
    if public.my_role_code() <> 'parent' then
        raise exception 'premium_parent_only';
    end if;
    if not exists (select 1 from public.student_parents where student_id = p_student_id and parent_id = auth.uid()) then
        raise exception 'student_manage_denied';
    end if;
    if p_tier not in ('limited', 'unlimited') then
        raise exception 'concours_tier_invalid';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;

    select id into v_school_year_id from public.school_years where establishment_id = v_establishment_id and is_current limit 1;
    if v_school_year_id is null then
        raise exception 'no_current_school_year';
    end if;

    if exists (select 1 from public.concours_subscriptions where student_id = p_student_id and school_year_id = v_school_year_id and status = 'active') then
        raise exception 'concours_already_active';
    end if;

    v_amount := case when p_tier = 'unlimited' then 1000 else 500 end;

    insert into public.concours_subscriptions (establishment_id, student_id, school_year_id, tier, amount, status)
    values (v_establishment_id, p_student_id, v_school_year_id, p_tier, v_amount, 'pending')
    on conflict (student_id, school_year_id) do update set tier = excluded.tier, amount = excluded.amount, status = 'pending'
    returning id into v_sub_id;

    insert into public.payments (establishment_id, concours_subscription_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_establishment_id, v_sub_id, v_amount, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', v_amount, 'status', 'pending');
end;
$$;
grant execute on function public.concours_subscribe(uuid, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Bulletins pilotés par IA
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('bulletin-templates', 'bulletin-templates', false) on conflict (id) do nothing;

create table public.bulletin_templates (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    class_id               uuid not null references public.classes(id) on delete cascade,
    storage_path           text not null,
    original_filename      varchar(255) not null,
    mime_type              varchar(100) not null,
    uploaded_by_profile_id uuid references public.profiles(id),
    created_at             timestamptz not null default now(),
    unique (class_id)
);

create table public.bulletin_subscriptions (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    school_year_id    uuid not null references public.school_years(id) on delete cascade,
    amount            numeric(12,2) not null default 500,
    status            varchar(20) not null default 'pending' check (status in ('pending','active','cancelled')),
    created_at        timestamptz not null default now(),
    unique (student_id, school_year_id)
);

alter table public.payments add constraint fk_pay_bulletin_sub
    foreign key (bulletin_subscription_id) references public.bulletin_subscriptions(id) on delete cascade;

-- Contrainte "exactement une cible" à 4 colonnes (remplace celle de l'étape 11).
alter table public.payments add constraint payments_exactly_one_target check (
    (student_fee_id is not null)::int + (premium_subscription_id is not null)::int +
    (concours_subscription_id is not null)::int + (bulletin_subscription_id is not null)::int = 1
);

create table public.bulletins (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    student_id             uuid not null references public.students(id) on delete cascade,
    sequence_id            uuid not null references public.sequences(id) on delete cascade,
    content                jsonb not null,
    ai_model               varchar(60) not null,
    generated_by_profile_id uuid references public.profiles(id),
    verification_code      varchar(30) unique,
    created_at             timestamptz not null default now(),
    unique (student_id, sequence_id)
);

alter table public.bulletin_templates enable row level security;
alter table public.bulletin_subscriptions enable row level security;
alter table public.bulletins enable row level security;

-- Exemple de bulletin : lecture large (nécessaire pour bulletin-generate et
-- pour l'indicateur "template_available"), gestion = TEMPLATE_MANAGE_ROLES.
create policy bulletin_templates_select on public.bulletin_templates for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy bulletin_templates_manage on public.bulletin_templates for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire'))
  with check (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire'));

-- Abonnement Bulletins : lecture large (assertReadAccess), comme concours —
-- pas parent-only, contrairement à Premium Parents.
create policy bulletin_subscriptions_select on public.bulletin_subscriptions for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = bulletin_subscriptions.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = bulletin_subscriptions.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = bulletin_subscriptions.student_id and s.profile_id = auth.uid())
    )
  );

-- Bulletins générés : même groupe de lecture qu'assertReadAccess (personnel/
-- PP/parent/élève) ; écriture uniquement via bulletin-generate (Edge Function,
-- appel OpenAI vision).
create policy bulletins_select on public.bulletins for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = bulletins.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = bulletins.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = bulletins.student_id and s.profile_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- bulletin_subscribe() — remplace BulletinController::subscribe()
-- ----------------------------------------------------------------------------
create or replace function public.bulletin_subscribe(p_student_id uuid, p_method text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_school_year_id uuid;
    v_sub_id uuid;
    v_payment_id uuid;
begin
    if public.my_role_code() <> 'parent' then
        raise exception 'premium_parent_only';
    end if;
    if not exists (select 1 from public.student_parents where student_id = p_student_id and parent_id = auth.uid()) then
        raise exception 'student_manage_denied';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;

    select id into v_school_year_id from public.school_years where establishment_id = v_establishment_id and is_current limit 1;
    if v_school_year_id is null then
        raise exception 'no_current_school_year';
    end if;

    if exists (select 1 from public.bulletin_subscriptions where student_id = p_student_id and school_year_id = v_school_year_id and status = 'active') then
        raise exception 'bulletin_subscription_already_active';
    end if;

    insert into public.bulletin_subscriptions (establishment_id, student_id, school_year_id, amount, status)
    values (v_establishment_id, p_student_id, v_school_year_id, 500, 'pending')
    on conflict (student_id, school_year_id) do update set status = 'pending'
    returning id into v_sub_id;

    insert into public.payments (establishment_id, bulletin_subscription_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_establishment_id, v_sub_id, 500, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', 500, 'status', 'pending');
end;
$$;
grant execute on function public.bulletin_subscribe(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Extension du trigger de paiement (étape 11) aux 2 nouvelles cibles
-- ----------------------------------------------------------------------------
create or replace function public.payments_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if TG_OP = 'UPDATE' and old.status = new.status then
        return new;
    end if;

    if new.status = 'completed' then
        new.receipt_number := public.generate_receipt_number();
        new.paid_at := now();

        if new.student_fee_id is not null then
            if new.amount > (
                select (amount_due - amount_paid) + 0.01 from public.student_fees where id = new.student_fee_id
            ) then
                raise exception 'payment_exceeds_balance';
            end if;

            update public.student_fees
              set amount_paid = amount_paid + new.amount,
                  status = case
                    when amount_paid + new.amount >= amount_due - 0.01 then 'paid'
                    when amount_paid + new.amount > 0 then 'partial'
                    else 'unpaid'
                  end
              where id = new.student_fee_id;
        elsif new.premium_subscription_id is not null then
            update public.premium_subscriptions
              set status = 'active', period_start = current_date, period_end = current_date + interval '1 month'
              where id = new.premium_subscription_id;
        elsif new.concours_subscription_id is not null then
            update public.concours_subscriptions set status = 'active' where id = new.concours_subscription_id;
        elsif new.bulletin_subscription_id is not null then
            update public.bulletin_subscriptions set status = 'active' where id = new.bulletin_subscription_id;
        end if;
    elsif new.status = 'failed' then
        if new.premium_subscription_id is not null then
            update public.premium_subscriptions set status = 'cancelled' where id = new.premium_subscription_id;
        elsif new.concours_subscription_id is not null then
            update public.concours_subscriptions set status = 'cancelled' where id = new.concours_subscription_id;
        elsif new.bulletin_subscription_id is not null then
            update public.bulletin_subscriptions set status = 'cancelled' where id = new.bulletin_subscription_id;
        end if;
    end if;

    return new;
end;
$$;
-- Le trigger trg_payments_apply_effects (étape 11) pointe déjà vers cette
-- fonction : CREATE OR REPLACE suffit, pas besoin de le recréer.


-- ############################################################################
-- FICHIER SOURCE : 0014_national_dashboard.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 14 / N — Tableau de bord national
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - latitude/longitude existent déjà sur `establishments` depuis l'étape 1
--     (anticipées dès les fondations) — rien à ajouter ici.
--   - Toutes les requêtes de ce contrôleur sont réservées à l'admin national
--     et agrègent des données de TOUS les établissements. Or la RLS de
--     `students`/`grades`/`classes`/etc. (étapes 5-6) filtre sur
--     `establishment_id = my_establishment_id()`, qui vaut NULL pour l'admin
--     national (il n'appartient à aucun établissement) — ces policies
--     l'excluent donc de fait. Plutôt que de retoucher une dizaine de
--     policies déjà en place dans les migrations précédentes, ces
--     statistiques sont exposées via des fonctions SECURITY DEFINER dédiées
--     (même principe qu'à l'étape 8 pour timetable_history) : chacune
--     vérifie elle-même is_national_admin() puis lit sans restriction.
--   - Le CTE VALIDATED_AVERAGES_CTE, dupliqué tel quel dans 3 requêtes PHP
--     (faute de vue réutilisable dans cette architecture), devient une vraie
--     VIEW PostgreSQL (student_validated_averages) — plus de duplication de
--     SQL, une seule définition.
--   - setCoordinates() n'a besoin d'AUCUNE fonction : la policy
--     establishments_update (étape 1) autorise déjà is_national_admin() à
--     modifier n'importe quel établissement, latitude/longitude inclus —
--     un simple update PostgREST suffit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Vue : moyenne pondérée par élève, sur les séquences VALIDÉES de l'année
-- scolaire en cours de son établissement (remplace VALIDATED_AVERAGES_CTE).
-- ----------------------------------------------------------------------------
create or replace view public.student_validated_averages as
select
    g.student_id, s.establishment_id, e.region, e.department,
    sum(g.score * cs.coefficient) / nullif(sum(cs.coefficient), 0) as average
from public.grades g
join public.class_subjects cs on cs.id = g.class_subject_id
join public.sequences seq on seq.id = g.sequence_id
join public.class_sequence_validations csv on csv.class_id = cs.class_id and csv.sequence_id = seq.id and csv.status = 'validated'
join public.students s on s.id = g.student_id and s.status = 'active'
join public.establishments e on e.id = s.establishment_id and e.status = 'active'
join public.school_years sy on sy.id = seq.school_year_id and sy.is_current
where g.score is not null
group by g.student_id, s.establishment_id, e.region, e.department;

-- ----------------------------------------------------------------------------
-- national_stats_overview() — remplace NationalStatsController::overview()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return jsonb_build_object(
        'establishments_by_status', (
            select coalesce(jsonb_agg(jsonb_build_object('status', status, 'n', n)), '[]'::jsonb)
            from (select status, count(*) as n from public.establishments group by status) t
        ),
        'establishments_total', (select count(*) from public.establishments),
        'students_total', (
            select count(*) from public.students s join public.establishments e on e.id = s.establishment_id
            where s.status = 'active' and e.status = 'active'
        ),
        'teachers_total', (
            select count(*) from public.profiles p
            join public.roles r on r.id = p.role_id
            join public.establishments e on e.id = p.establishment_id
            where r.code in ('enseignant', 'professeur_principal') and p.status = 'active' and e.status = 'active'
        ),
        'success_rate', (
            select jsonb_build_object(
                'students_with_grades', count(*),
                'students_passing', sum(case when average >= 10 then 1 else 0 end),
                'success_rate', round(100.0 * sum(case when average >= 10 then 1 else 0 end) / nullif(count(*), 0), 1)
            )
            from public.student_validated_averages
        )
    );
end;
$$;
grant execute on function public.national_stats_overview() to authenticated;

-- ----------------------------------------------------------------------------
-- national_stats_by_region() — remplace NationalStatsController::byRegion()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_by_region()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'region', reg.region, 'establishments', reg.establishments, 'students', reg.students,
            'teachers', reg.teachers, 'success_rate', sr.success_rate
        ) order by reg.region), '[]'::jsonb)
        from (
            select e.region,
                   count(distinct e.id) as establishments,
                   count(distinct s.id) filter (where s.status = 'active') as students,
                   count(distinct p.id) filter (where p.status = 'active') as teachers
            from public.establishments e
            left join public.students s on s.establishment_id = e.id
            left join public.profiles p on p.establishment_id = e.id and p.role_id in (select id from public.roles where code in ('enseignant', 'professeur_principal'))
            where e.status = 'active'
            group by e.region
        ) reg
        left join (
            select region, round(100.0 * sum(case when average >= 10 then 1 else 0 end) / nullif(count(*), 0), 1) as success_rate
            from public.student_validated_averages group by region
        ) sr on sr.region = reg.region
    );
end;
$$;
grant execute on function public.national_stats_by_region() to authenticated;

-- ----------------------------------------------------------------------------
-- national_stats_by_department() — remplace NationalStatsController::byDepartment()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_by_department(p_region text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'region', dep.region, 'department', dep.department, 'establishments', dep.establishments,
            'students', dep.students, 'teachers', dep.teachers, 'success_rate', sr.success_rate
        ) order by dep.region, dep.department), '[]'::jsonb)
        from (
            select e.region, e.department,
                   count(distinct e.id) as establishments,
                   count(distinct s.id) filter (where s.status = 'active') as students,
                   count(distinct p.id) filter (where p.status = 'active') as teachers
            from public.establishments e
            left join public.students s on s.establishment_id = e.id
            left join public.profiles p on p.establishment_id = e.id and p.role_id in (select id from public.roles where code in ('enseignant', 'professeur_principal'))
            where e.status = 'active' and (p_region is null or e.region = p_region)
            group by e.region, e.department
        ) dep
        left join (
            select region, department, round(100.0 * sum(case when average >= 10 then 1 else 0 end) / nullif(count(*), 0), 1) as success_rate
            from public.student_validated_averages
            where p_region is null or region = p_region
            group by region, department
        ) sr on sr.region = dep.region and sr.department = dep.department
    );
end;
$$;
grant execute on function public.national_stats_by_department(text) to authenticated;

-- ----------------------------------------------------------------------------
-- national_stats_map() — remplace NationalStatsController::map()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_map()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'code', e.code, 'name', e.name, 'establishment_type', e.establishment_type,
            'region', e.region, 'department', e.department, 'latitude', e.latitude, 'longitude', e.longitude,
            'student_count', (select count(*) from public.students s where s.establishment_id = e.id and s.status = 'active')
        ) order by e.name), '[]'::jsonb)
        from public.establishments e
        where e.status = 'active' and e.latitude is not null and e.longitude is not null
    );
end;
$$;
grant execute on function public.national_stats_map() to authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0015_security_and_finishing.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 15 / N — API publique (lecture seule) & vérification QR
-- ============================================================================
-- CE QUI N'A RIEN À FAIRE ICI (déjà couvert autrement dans cette conversion) :
--   - 2FA / TOTP : natif via Supabase Auth (auth.mfa), depuis l'étape 2 —
--     totp_secret/totp_backup_codes/two_factor_challenges n'existent plus.
--   - Verrouillage anti-brute-force : profiles.failed_login_attempts/
--     locked_until existent depuis l'étape 2 (auth-login).
--   - security_alerts : créée dès l'étape 6 (anomalies de notes), déjà
--     utilisée aussi par l'étape 7 (présences).
--   - bulletins.verification_code : ajouté directement à la création de la
--     table à l'étape 13, pas besoin d'ALTER TABLE ici.
--
-- CE QUI RESTE À FAIRE (cette étape) :
--   - api_keys : clés d'API en lecture seule pour intégration externe.
--     create_api_key() (RPC, SECURITY DEFINER) génère et hache la clé
--     directement en SQL via pgcrypto (gen_random_bytes/digest, déjà
--     disponible depuis l'étape 1) — pas besoin d'Edge Function pour ça, le
--     hachage cryptographique n'exige pas un environnement Deno.
--   - verify_bulletin() (RPC publique, comme get_parent_invitation_status à
--     l'étape 5) : lecture publique par code, aucune authentification.
--   - Les endpoints /public/v1/* eux-mêmes restent une Edge Function
--     (public-api) : l'authentification par clé d'API (Bearer sch_xxx) est
--     un schéma custom, distinct des JWT Supabase — PostgREST/RLS ne peut
--     pas l'interpréter nativement.
-- ============================================================================

create table public.api_keys (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    label                  varchar(120) not null,
    key_prefix             varchar(12) not null,
    key_hash               varchar(64) not null unique,
    scopes                 jsonb not null default '["students.read"]',
    created_by_profile_id  uuid references public.profiles(id),
    last_used_at           timestamptz,
    revoked_at             timestamptz,
    created_at             timestamptz not null default now()
);
create index idx_api_keys_establishment on public.api_keys(establishment_id, revoked_at);

alter table public.api_keys enable row level security;

create policy api_keys_select on public.api_keys for select to authenticated
  using (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur'));
-- Révocation : simple update PostgREST (pas besoin de fonction dédiée),
-- restreint à une clé pas déjà révoquée (comportement idempotent du PHP :
-- revoke sur une clé déjà révoquée renvoyait 404 "rowCount=0").
create policy api_keys_revoke on public.api_keys for update to authenticated
  using (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur') and revoked_at is null)
  with check (establishment_id = public.my_establishment_id());
-- Pas de policy INSERT cliente : la clé en clair ne doit exister qu'une
-- fois, à l'instant de create_api_key() — jamais reconstructible ensuite.

create or replace function public.create_api_key(p_label text, p_scopes text[] default array['students.read'])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_allowed text[] := array['establishment.read', 'students.read', 'grades.read'];
    v_scopes text[];
    v_plain_key text;
    v_key_id uuid;
begin
    if public.my_role_code() not in ('proviseur','principal','directeur') then
        raise exception 'student_manage_denied';
    end if;
    if p_label is null or trim(p_label) = '' then
        raise exception 'validation_missing_fields';
    end if;

    select coalesce(array_agg(s), array['students.read']) into v_scopes
    from unnest(p_scopes) s where s = any(v_allowed);
    if v_scopes = '{}' then
        v_scopes := array['students.read'];
    end if;

    v_plain_key := 'sch_' || encode(gen_random_bytes(24), 'hex');

    insert into public.api_keys (establishment_id, label, key_prefix, key_hash, scopes, created_by_profile_id)
    values (v_establishment_id, p_label, left(v_plain_key, 10), encode(digest(v_plain_key, 'sha256'), 'hex'), to_jsonb(v_scopes), auth.uid())
    returning id into v_key_id;

    return jsonb_build_object('id', v_key_id, 'key', v_plain_key, 'scopes', to_jsonb(v_scopes));
end;
$$;
grant execute on function public.create_api_key(text, text[]) to authenticated;

-- ----------------------------------------------------------------------------
-- verify_bulletin() — remplace PublicApiController::verifyBulletin(). Lecture
-- publique par code, comme get_parent_invitation_status (étape 5).
-- ----------------------------------------------------------------------------
create or replace function public.verify_bulletin(p_code text)
returns jsonb
language sql stable security definer set search_path = public
as $$
    select case when b.id is null then jsonb_build_object('valid', false) else jsonb_build_object(
        'valid', true,
        'bulletin', jsonb_build_object(
            'created_at', b.created_at, 'first_name', s.first_name, 'last_name', s.last_name, 'matricule', s.matricule,
            'sequence_label', sq.label, 'establishment_name', e.name, 'establishment_code', e.code
        )
    ) end
    from (select 1) dummy
    left join public.bulletins b on b.verification_code = p_code
    left join public.students s on s.id = b.student_id
    left join public.sequences sq on sq.id = b.sequence_id
    left join public.establishments e on e.id = b.establishment_id;
$$;
grant execute on function public.verify_bulletin(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- Vérification d'une clé d'API — utilisée en interne par l'Edge Function
-- public-api (jamais exposée directement en RPC cliente).
-- ----------------------------------------------------------------------------
create or replace function public.verify_api_key(p_key text, p_scope text)
returns uuid  -- establishment_id si valide, NULL sinon
language plpgsql
security definer
set search_path = public
as $$
declare
    v_key_id uuid;
    v_establishment_id uuid;
begin
    select id, establishment_id into v_key_id, v_establishment_id
    from public.api_keys
    where key_hash = encode(digest(p_key, 'sha256'), 'hex')
      and revoked_at is null
      and scopes ? p_scope;

    if v_key_id is null then
        return null;
    end if;

    update public.api_keys set last_used_at = now() where id = v_key_id;
    return v_establishment_id;
end;
$$;
-- Aucun GRANT à authenticated/anon : appelée uniquement par l'Edge Function
-- public-api via le client service_role. PostgreSQL accorde EXECUTE à
-- PUBLIC par défaut sur toute nouvelle fonction — on le retire explicitement.
revoke execute on function public.verify_api_key(text, text) from public, anon, authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0016_admin_change_and_finishing.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 16 / N — Changement d'administrateur d'établissement
-- (flux laissé en suspens à l'étape 3) + classement des épreuves concours
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Le nouveau titulaire définit son mot de passe à la CONFIRMATION par
--     email (avant la validation finale par l'admin national) — le PHP
--     stockait alors un hash de mot de passe "en attente" dans
--     admin_change_requests. Avec Supabase Auth, il n'existe pas
--     d'équivalent "hash en attente" : le compte auth.users est donc créé
--     dès la confirmation (email_confirm ok, mais sans profil applicatif
--     encore), et seul son id est mémorisé (new_admin_auth_user_id). La
--     validation par l'admin national crée alors le PROFIL (établissement +
--     rôle), ce qui active réellement l'accès — équivalent fonctionnel
--     exact du "compte pas encore utilisable tant que non validé".
-- ============================================================================

alter table public.admin_change_requests add column new_admin_auth_user_id uuid;

-- ----------------------------------------------------------------------------
-- admin_change_status() — remplace AdminChangeController::status() (public)
-- ----------------------------------------------------------------------------
create or replace function public.admin_change_status(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
    select case when acr.id is null then jsonb_build_object('error', 'invalid_confirmation_link') else jsonb_build_object(
        'request', jsonb_build_object(
            'new_admin_first_name', acr.new_admin_first_name, 'new_admin_last_name', acr.new_admin_last_name,
            'new_admin_email', acr.new_admin_email, 'status', acr.status, 'establishment_name', e.name
        )
    ) end
    from (select 1) dummy
    left join public.admin_change_requests acr on acr.validation_token = p_token
    left join public.establishments e on e.id = acr.establishment_id;
$$;
grant execute on function public.admin_change_status(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- exam_ranking() — remplace ExamController::ranking()
-- ----------------------------------------------------------------------------
create or replace function public.exam_ranking(p_exam_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_exam record;
begin
    select establishment_id, subject_label, level into v_exam from public.exam_papers where id = p_exam_paper_id;
    if v_exam.establishment_id is null or v_exam.establishment_id is distinct from public.my_establishment_id() then
        raise exception 'exam_not_found';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'first_name', s.first_name, 'last_name', s.last_name, 'score', ea.score, 'max_score', ea.max_score,
            'rank', rank() over (order by ea.score desc)
        ) order by ea.score desc), '[]'::jsonb)
        from public.exam_attempts ea
        join public.exam_papers ep on ep.id = ea.exam_paper_id
        join public.students s on s.id = ea.student_id
        where ep.establishment_id = v_exam.establishment_id and ep.subject_label = v_exam.subject_label
          and ep.level = v_exam.level and ea.status = 'graded'
        limit 50
    );
end;
$$;
grant execute on function public.exam_ranking(uuid) to authenticated;


-- ############################################################################
-- FICHIER SOURCE : 0017_mfa_backup_codes.sql
-- ############################################################################
-- ============================================================================
-- SCHOOLAR — ÉTAPE 17 — Codes de secours pour la double authentification
-- ============================================================================
-- CHOIX D'ARCHITECTURE : les codes de secours (affichés une fois après
-- l'activation du TOTP, permettant de se connecter en cas de perte du
-- téléphone) n'ont pas d'équivalent natif dans Supabase Auth (son "AAL"
-- — Authenticator Assurance Level — est calculé par GoTrue lui-même à
-- partir d'une vérification MFA réelle, sans mécanisme d'échappement pour
-- un code de secours personnalisé). Cette table permet de GÉNÉRER et
-- AFFICHER les codes (ce que fait cette étape), mais la connexion via un
-- code de secours (en remplacement du TOTP) n'est PAS câblée côté
-- auth-login — voir le README pour ce point précis, signalé comme limite
-- connue plutôt que silencieusement laissé de côté.
-- ============================================================================

create table public.mfa_backup_codes (
    id          uuid primary key default gen_random_uuid(),
    profile_id  uuid not null references public.profiles(id) on delete cascade,
    code_hash   varchar(64) not null,
    used_at     timestamptz,
    created_at  timestamptz not null default now()
);
create index idx_mfa_backup_codes_profile on public.mfa_backup_codes(profile_id, used_at);

alter table public.mfa_backup_codes enable row level security;

create policy mfa_backup_codes_own on public.mfa_backup_codes for all to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());


-- ===== 0018_audit_fixes.sql =====
-- ============================================================================
-- 0018 — Correctifs issus de l'audit (tests réels sur Supabase, 2026-10-09)
-- ============================================================================
-- A. Helpers SECURITY DEFINER pour casser les récursions RLS
create or replace function public.is_teacher_of_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_subjects cs where cs.class_id = p_class_id and cs.teacher_id = auth.uid());
$$;
create or replace function public.is_homeroom_of_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.classes c where c.id = p_class_id and c.homeroom_teacher_id = auth.uid());
$$;
create or replace function public.is_parent_of_student(p_student_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.student_parents sp where sp.student_id = p_student_id and sp.parent_id = auth.uid());
$$;
create or replace function public.is_conversation_member(p_conversation_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_participants cp where cp.conversation_id = p_conversation_id and cp.user_id = auth.uid());
$$;
create or replace function public.shares_conversation_with(p_profile_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.conversation_participants a join public.conversation_participants b on a.conversation_id = b.conversation_id
                 where a.user_id = auth.uid() and b.user_id = p_profile_id);
$$;
create or replace function public.my_role_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_staff from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid()), false);
$$;

-- B. Récursion classes <-> class_subjects, students <-> student_parents
drop policy classes_select on public.classes;
create policy classes_select on public.classes for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or homeroom_teacher_id = auth.uid()
      or public.is_teacher_of_class(classes.id)
    )
  );

drop policy students_select on public.students;
create policy students_select on public.students for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
      or profile_id = auth.uid()
      or public.is_parent_of_student(students.id)
      or public.is_homeroom_of_class(students.class_id)
      or public.is_teacher_of_class(students.class_id)
    )
  );

-- C. Récursion messagerie
drop policy conversations_select on public.conversations;
create policy conversations_select on public.conversations for select to authenticated
  using (public.is_conversation_member(conversations.id));
drop policy conversation_participants_select on public.conversation_participants;
create policy conversation_participants_select on public.conversation_participants for select to authenticated
  using (user_id = auth.uid() or public.is_conversation_member(conversation_id));
drop policy messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_conversation_member(messages.conversation_id));
drop policy messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = auth.uid() and public.is_conversation_member(messages.conversation_id));

-- D. Escalade de privilèges sur profiles (un parent pouvait se promouvoir proviseur)
create or replace function public.profiles_guard_sensitive() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_scope text;
begin
  if auth.uid() is null then return new; end if;
  if public.is_national_admin() then return new; end if;
  select scope into v_scope from public.roles where id = new.role_id;
  if v_scope = 'national' then raise exception 'profile_role_forbidden'; end if;
  if tg_op = 'UPDATE' then
    if new.establishment_id is distinct from old.establishment_id then
      raise exception 'profile_establishment_immutable';
    end if;
    if new.id = auth.uid() and (
         new.role_id is distinct from old.role_id or new.status is distinct from old.status
      or new.email is distinct from old.email
      or new.failed_login_attempts is distinct from old.failed_login_attempts
      or new.locked_until is distinct from old.locked_until
      or new.admin_verified_at is distinct from old.admin_verified_at
      or new.archived_at is distinct from old.archived_at
      or new.archived_reason is distinct from old.archived_reason) then
      raise exception 'profile_self_protected_columns';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_profiles_guard_sensitive before insert or update on public.profiles
for each row execute function public.profiles_guard_sensitive();

drop policy profiles_select_same_establishment on public.profiles;
create policy profiles_select_same_establishment on public.profiles for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_is_staff()
      or exists (select 1 from public.roles r where r.id = profiles.role_id and r.is_staff)
      or public.shares_conversation_with(profiles.id)
    )
  );

-- E. Paiements : un client ne peut plus confirmer un paiement mobile money
--    (la confirmation doit venir du webhook opérateur / service role)
revoke update on public.payments from authenticated;
grant update (status) on public.payments to authenticated;
drop policy payments_update_confirm on public.payments;
create policy payments_update_confirm on public.payments for update to authenticated
  using (establishment_id = public.my_establishment_id() and status = 'pending'
         and method in ('cash','bank_card') and public.has_permission('payments.manage'))
  with check (establishment_id = public.my_establishment_id()
         and method in ('cash','bank_card') and public.has_permission('payments.manage'));
create policy payments_cancel_own on public.payments for update to authenticated
  using (establishment_id = public.my_establishment_id() and status = 'pending' and initiated_by_profile_id = auth.uid())
  with check (establishment_id = public.my_establishment_id() and status = 'cancelled' and initiated_by_profile_id = auth.uid());

-- F. Notes : écriture uniquement via save_grade_sheet (verrou + motif + audit)
drop policy grades_manage on public.grades;
revoke insert, update, delete on public.grades from authenticated;

-- G. Examens : l'élève ne peut que démarrer une tentative vierge
drop policy exam_attempts_start on public.exam_attempts;
create policy exam_attempts_start on public.exam_attempts for insert to authenticated
  with check (
    status = 'in_progress' and score is null and max_score is null and answers is null
    and feedback is null and submitted_at is null
    and exists (select 1 from public.exam_papers ep join public.students s on s.id = ep.requested_by_student_id
                where ep.id = exam_attempts.exam_paper_id and s.profile_id = auth.uid())
  );

-- H. Demandes de changement d'admin : le jeton de validation ne doit pas fuiter
drop policy acr_select on public.admin_change_requests;
create policy acr_select on public.admin_change_requests for select to authenticated
  using (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('establishment.manage')));
drop policy acr_write on public.admin_change_requests;
create policy acr_write on public.admin_change_requests for all to authenticated
  using (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('establishment.manage')))
  with check (public.is_national_admin() or (establishment_id = public.my_establishment_id() and public.has_permission('establishment.manage')));

-- I. Alertes : with check (true) laissait déplacer une alerte vers un autre établissement
drop policy security_alerts_acknowledge on public.security_alerts;
create policy security_alerts_acknowledge on public.security_alerts for update to authenticated
  using ((establishment_id is null and public.is_national_admin())
      or (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur')))
  with check ((establishment_id is null and public.is_national_admin())
      or (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur')));

-- J. checkout_at réservé aux abonnés Premium (le revoke par colonne de 0011 était sans effet)
revoke select on public.attendance_records from authenticated, anon;
grant select (id, session_id, student_id, status, justified, justification_note, justification_document_url, alerted_at, updated_at)
  on public.attendance_records to authenticated;

-- K. Vue des moyennes : ne plus contourner la RLS ni être exposée
alter view public.student_validated_averages set (security_invoker = true);
revoke all on public.student_validated_averages from anon, authenticated;

-- L. Fonctions pgcrypto : search_path
alter function public.create_api_key(text, text[]) set search_path = public, extensions;
alter function public.verify_api_key(text, text) set search_path = public, extensions;
alter function public.set_updated_at() set search_path = public;

-- M. generate_fee_invoices : la CTE n'était pas visible dans le 2e SELECT
create or replace function public.generate_fee_invoices(p_fee_structure_id uuid) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare v_fee record; v_created integer := 0; v_candidates integer;
begin
  select * into v_fee from public.fee_structures where id = p_fee_structure_id;
  if v_fee is null or v_fee.establishment_id is distinct from public.my_establishment_id() then
    raise exception 'fee_structure_not_found';
  end if;
  select count(*) into v_candidates from public.students s left join public.classes c on c.id = s.class_id
   where s.establishment_id = v_fee.establishment_id and s.status = 'active'
     and (v_fee.level is null or c.level = v_fee.level) and (v_fee.series is null or c.series = v_fee.series);
  insert into public.student_fees (establishment_id, student_id, fee_structure_id, amount_due)
  select v_fee.establishment_id, s.id, v_fee.id, v_fee.amount
    from public.students s left join public.classes c on c.id = s.class_id
   where s.establishment_id = v_fee.establishment_id and s.status = 'active'
     and (v_fee.level is null or c.level = v_fee.level) and (v_fee.series is null or c.series = v_fee.series)
  on conflict (student_id, fee_structure_id) do nothing;
  get diagnostics v_created = row_count;
  return jsonb_build_object('created', v_created, 'candidates', v_candidates);
end;
$$;

-- N. LIMIT appliqué sur la ligne agrégée (donc sans effet) : déplacé dans une sous-requête
create or replace function public.exam_ranking(p_exam_paper_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_exam record;
begin
  select establishment_id, subject_label, level into v_exam from public.exam_papers where id = p_exam_paper_id;
  if v_exam.establishment_id is null or v_exam.establishment_id is distinct from public.my_establishment_id() then
    raise exception 'exam_not_found';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('first_name', t.first_name, 'last_name', t.last_name,
             'score', t.score, 'max_score', t.max_score, 'rank', t.rnk) order by t.score desc), '[]'::jsonb)
    from (
      select s.first_name, s.last_name, ea.score, ea.max_score, rank() over (order by ea.score desc) as rnk
      from public.exam_attempts ea
      join public.exam_papers ep on ep.id = ea.exam_paper_id
      join public.students s on s.id = ea.student_id
      where ep.establishment_id = v_exam.establishment_id and ep.subject_label = v_exam.subject_label
        and ep.level = v_exam.level and ea.status = 'graded'
      order by ea.score desc limit 50
    ) t
  );
end;
$$;

create or replace function public.premium_checkout_history(p_student_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.premium_subscriptions where parent_id = auth.uid() and student_id = p_student_id and status = 'active') then
    raise exception 'premium_required';
  end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('session_date', t.session_date, 'period_label', t.period_label,
             'subject_name', t.subject_name, 'status', t.status, 'checkout_at', t.checkout_at) order by t.session_date desc), '[]'::jsonb)
    from (
      select ases.session_date, ases.period_label, sub.name as subject_name, ar.status, ar.checkout_at
      from public.attendance_records ar
      join public.attendance_sessions ases on ases.id = ar.session_id
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.subjects sub on sub.id = cs.subject_id
      where ar.student_id = p_student_id and ar.checkout_at is not null
      order by ases.session_date desc limit 30
    ) t
  );
end;
$$;

create or replace function public.timetable_history(p_class_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_establishment_id uuid; v_authorized boolean;
begin
  select establishment_id into v_establishment_id from public.classes where id = p_class_id;
  if v_establishment_id is null or v_establishment_id is distinct from public.my_establishment_id() then
    raise exception 'class_not_found';
  end if;
  select public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or public.is_homeroom_of_class(p_class_id) or public.is_teacher_of_class(p_class_id)
  into v_authorized;
  if not v_authorized then raise exception 'class_access_denied'; end if;
  return (
    select coalesce(jsonb_agg(jsonb_build_object('action', t.action, 'details', t.details, 'created_at', t.created_at,
             'first_name', t.first_name, 'last_name', t.last_name) order by t.created_at desc), '[]'::jsonb)
    from (
      select al.action, al.details, al.created_at, p.first_name, p.last_name
      from public.audit_log al left join public.profiles p on p.id = al.profile_id
      where al.establishment_id = v_establishment_id and al.entity_type = 'timetable_entries'
        and al.details->>'class_id' = p_class_id::text
      order by al.created_at desc limit 100
    ) t
  );
end;
$$;

-- O. Droits d'exécution : fermer l'API aux anonymes et masquer les fonctions internes
do $$
declare r record;
begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke execute on function %s from public, anon', r.sig);
  end loop;
end $$;
grant execute on all functions in schema public to authenticated;
revoke execute on function
  public.set_updated_at(), public.log_audit_event(), public.auto_attribute_class_subjects(),
  public.generate_student_matricule(), public.discipline_report_guard_resolve(), public.timetable_log_audit(),
  public.timetable_enforce_no_conflicts(), public.progression_item_default_order(), public.progression_item_guard_complete(),
  public.payments_apply_effects(), public.profiles_guard_sensitive(), public.generate_receipt_number(),
  public.verify_api_key(text, text)
from authenticated;
grant execute on function
  public.search_establishments(text, text), public.get_establishment_public(uuid),
  public.get_parent_invitation_status(text), public.verify_bulletin(text), public.admin_change_status(text)
to anon;

-- ===== 0019_family_visibility_and_fee_insert.sql =====
-- ============================================================================
-- 0019 — Visibilité famille + politique d'insertion des factures
-- ============================================================================
-- Les politiques grades_select / attendance_records_select / homework_* font des
-- jointures sur classes, class_subjects et attendance_sessions. Ces tables étant
-- fermées aux parents/élèves, la branche "famille" ne renvoyait jamais rien.
create or replace function public.is_family_of_class(p_class_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students st
    where st.class_id = p_class_id
      and (st.profile_id = auth.uid()
           or exists (select 1 from public.student_parents sp where sp.student_id = st.id and sp.parent_id = auth.uid()))
  );
$$;

create or replace function public.is_family_of_class_subject(p_class_subject_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.class_subjects cs where cs.id = p_class_subject_id and public.is_family_of_class(cs.class_id));
$$;

revoke execute on function public.is_family_of_class(uuid), public.is_family_of_class_subject(uuid) from public, anon;
grant execute on function public.is_family_of_class(uuid), public.is_family_of_class_subject(uuid) to authenticated;

create policy classes_select_family on public.classes for select to authenticated
  using (establishment_id = public.my_establishment_id() and public.is_family_of_class(classes.id));
create policy class_subjects_select_family on public.class_subjects for select to authenticated
  using (public.is_family_of_class(class_subjects.class_id));
create policy attendance_sessions_select_family on public.attendance_sessions for select to authenticated
  using (public.is_family_of_class_subject(attendance_sessions.class_subject_id));

-- generate_fee_invoices est SECURITY INVOKER mais student_fees n'avait aucune policy d'insertion
create policy student_fees_insert on public.student_fees for insert to authenticated
  with check (establishment_id = public.my_establishment_id() and public.has_permission('payments.manage'));
