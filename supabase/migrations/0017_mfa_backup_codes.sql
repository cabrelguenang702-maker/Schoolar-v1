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
