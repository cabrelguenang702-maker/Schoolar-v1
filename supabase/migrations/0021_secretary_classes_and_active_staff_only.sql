-- ============================================================================
-- 0021 — Secrétaire : voir les classes ; parents/élèves : voir seulement le personnel actif
-- ============================================================================
-- Constats (tests réels) :
--  * la secrétaire (permission classes.view, création d'élèves) ne voyait aucune classe ;
--  * un parent/élève voyait encore un enseignant archivé dans la liste du personnel.
drop policy classes_select on public.classes;
create policy classes_select on public.classes for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire')
      or homeroom_teacher_id = auth.uid()
      or public.is_teacher_of_class(classes.id)
    )
  );

drop policy profiles_select_same_establishment on public.profiles;
create policy profiles_select_same_establishment on public.profiles for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_is_staff()
      or (profiles.status = 'active' and exists (select 1 from public.roles r where r.id = profiles.role_id and r.is_staff))
      or public.shares_conversation_with(profiles.id)
    )
  );
