-- ============================================================================
-- 0020 — Un profil non actif (archivé, inactif…) n'a plus aucun accès via la RLS
-- ============================================================================
-- Constat (test réel) : après archivage d'un enseignant, son JWT encore valide
-- continuait de lire les données de l'établissement jusqu'à expiration (~1 h).
create or replace function public.my_establishment_id() returns uuid
language sql stable security definer set search_path = public as $$
  select establishment_id from public.profiles where id = auth.uid() and status = 'active';
$$;

create or replace function public.my_role_code() returns text
language sql stable security definer set search_path = public as $$
  select r.code from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.status = 'active';
$$;

create or replace function public.my_role_scope() returns text
language sql stable security definer set search_path = public as $$
  select r.scope from public.profiles p join public.roles r on r.id = p.role_id
  where p.id = auth.uid() and p.status = 'active';
$$;

create or replace function public.my_role_is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select r.is_staff from public.profiles p join public.roles r on r.id = p.role_id
                   where p.id = auth.uid() and p.status = 'active'), false);
$$;

create or replace function public.has_permission(perm_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.role_permissions rp on rp.role_id = p.role_id
    join public.permissions perm on perm.id = rp.permission_id
    where p.id = auth.uid() and p.status = 'active' and perm.code = perm_code
  );
$$;
