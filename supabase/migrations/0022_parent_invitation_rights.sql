-- ============================================================================
-- 0022 — Qui peut inviter les parents + lecture des invitations en attente
-- ============================================================================
-- Règle métier : l'invitation d'un parent est faite par la hiérarchie de l'établissement
-- (proviseur, principal, directeur, censeur, surveillant général) et le secrétariat ;
-- les enseignants peuvent inviter les parents des élèves de leurs classes (titulaire ou intervenant).
-- Jamais par l'élève ni par un parent.
-- Constat : parent_invitations avait la RLS activée sans aucune policy → la liste des
-- « invitations en attente » était vide pour tout le monde.
-- Le jeton secret du lien (validation_token) reste illisible côté client : sinon un membre du
-- personnel pourrait confirmer l'invitation à la place du parent et choisir son mot de passe.
create or replace function public.can_invite_parent_for_student(p_student_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.students s
    where s.id = p_student_id
      and s.establishment_id = public.my_establishment_id()
      and (
        public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire')
        or (public.my_role_code() in ('enseignant','professeur_principal')
            and (public.is_homeroom_of_class(s.class_id) or public.is_teacher_of_class(s.class_id)))
      )
  );
$$;
revoke execute on function public.can_invite_parent_for_student(uuid) from public, anon;
grant execute on function public.can_invite_parent_for_student(uuid) to authenticated;

revoke select on public.parent_invitations from authenticated, anon;
grant select (id, establishment_id, student_id, invited_first_name, invited_last_name, invited_email,
              invited_phone, relationship, status, invited_by_profile_id, created_at, completed_at)
  on public.parent_invitations to authenticated;

create policy parent_invitations_select on public.parent_invitations for select to authenticated
  using (public.can_invite_parent_for_student(student_id));
