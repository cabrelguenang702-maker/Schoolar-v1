-- ============================================================================
-- 0024 — Annonces : l'auteur voit ce qu'il publie ; élèves exclus des annonces « personnel »
-- ============================================================================
-- Constat (test réel) : le proviseur recevait un 403 en publiant une annonce « parents »
-- (INSERT … RETURNING exige de pouvoir relire la ligne, or seuls les parents la voyaient) ;
-- les élèves voyaient les annonces réservées au personnel.
drop policy announcements_select on public.announcements;
create policy announcements_select on public.announcements for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      created_by_profile_id = auth.uid()
      or public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general')
      or audience = 'all_establishment'
      or (audience = 'all_parents' and public.my_role_scope() = 'family')
      or (audience = 'all_staff' and public.my_role_is_staff())
      or (audience = 'class' and (
            public.is_family_of_class(class_id)
            or public.is_homeroom_of_class(class_id)
            or public.is_teacher_of_class(class_id)
          ))
    )
  );
