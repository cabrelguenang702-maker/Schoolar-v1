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
