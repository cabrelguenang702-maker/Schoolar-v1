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
