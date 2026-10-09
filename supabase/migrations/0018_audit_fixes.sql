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
