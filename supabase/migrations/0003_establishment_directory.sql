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
