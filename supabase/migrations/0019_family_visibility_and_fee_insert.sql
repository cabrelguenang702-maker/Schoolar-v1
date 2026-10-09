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
