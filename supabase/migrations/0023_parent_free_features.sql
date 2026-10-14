-- ============================================================================
-- 0023 — Espace parents (partie gratuite) : emploi du temps, comportement,
--         vie scolaire, notifications automatiques, messagerie, bulletin gratuit
-- ============================================================================
-- 1) Emploi du temps : visible par les familles (parents et élèves de la classe)
create policy timetable_entries_select_family on public.timetable_entries for select to authenticated
  using (establishment_id = public.my_establishment_id() and public.is_family_of_class(class_id));

-- 2) Discipline : le personnel décide si une observation est partagée avec les parents
alter table public.discipline_reports add column visible_to_parents boolean not null default true;
drop policy discipline_reports_select on public.discipline_reports;
create policy discipline_reports_select on public.discipline_reports for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','surveillant_secteur','secretaire')
      or public.is_homeroom_of_class(discipline_reports.class_id)
      or (discipline_reports.visible_to_parents and public.is_parent_of_student(discipline_reports.student_id))
    )
  );

-- 3) Notifications internes
create or replace function public._notify_users(p_user_ids uuid[], p_establishment_id uuid, p_type text, p_title text, p_body text, p_link text)
returns void language sql security definer set search_path = public as $$
  insert into public.notifications (user_id, establishment_id, type, title, body, link)
  select p.id, p_establishment_id, left(p_type, 40), left(p_title, 255), left(p_body, 500), p_link
  from public.profiles p where p.id = any(p_user_ids) and p.status = 'active';
$$;

create or replace function public._family_user_ids_of_class(p_class_id uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u), '{}'::uuid[]) from (
    select sp.parent_id as u from public.students s join public.student_parents sp on sp.student_id = s.id
      where s.class_id = p_class_id and s.status = 'active'
    union
    select s.profile_id from public.students s where s.class_id = p_class_id and s.status = 'active' and s.profile_id is not null
  ) x;
$$;

create or replace function public.trg_notify_results_validated() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_est uuid; v_label text;
begin
  if new.status = 'validated' and (tg_op = 'INSERT' or old.status is distinct from 'validated') then
    select establishment_id into v_est from public.classes where id = new.class_id;
    select label into v_label from public.sequences where id = new.sequence_id;
    perform public._notify_users(public._family_user_ids_of_class(new.class_id), v_est, 'results_validated',
      'Résultats disponibles', 'Les résultats de la ' || coalesce(v_label, 'séquence') || ' sont disponibles.', '#/my-children');
  end if;
  return new;
end $$;
create trigger trg_class_sequence_validations_notify after insert or update of status on public.class_sequence_validations
for each row execute function public.trg_notify_results_validated();

create or replace function public.trg_notify_homework_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_class uuid; v_est uuid;
begin
  select cs.class_id, c.establishment_id into v_class, v_est
    from public.class_subjects cs join public.classes c on c.id = cs.class_id where cs.id = new.class_subject_id;
  perform public._notify_users(public._family_user_ids_of_class(v_class), v_est, 'homework_new',
    'Nouveau devoir', new.title || ' — à rendre pour le ' || to_char(new.due_date, 'DD/MM/YYYY'), '#/my-children');
  return new;
end $$;
create trigger trg_homework_assignments_notify after insert on public.homework_assignments
for each row execute function public.trg_notify_homework_created();

create or replace function public.trg_notify_discipline_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.visible_to_parents then
    perform public._notify_users(
      coalesce((select array_agg(sp.parent_id) from public.student_parents sp where sp.student_id = new.student_id), '{}'::uuid[]),
      new.establishment_id, 'discipline_new', 'Observation scolaire',
      'Une observation (' || new.category || ') a été enregistrée pour votre enfant.', '#/my-children');
  end if;
  return new;
end $$;
create trigger trg_discipline_reports_notify after insert on public.discipline_reports
for each row execute function public.trg_notify_discipline_created();

-- 4) Vie scolaire : réunions et événements
create table public.school_events (
  id                    uuid primary key default gen_random_uuid(),
  establishment_id      uuid not null references public.establishments(id) on delete cascade,
  title                 varchar(200) not null,
  description           varchar(2000),
  event_type            varchar(20) not null default 'evenement' check (event_type in ('reunion','evenement','examen','conge')),
  starts_at             timestamptz not null,
  ends_at               timestamptz,
  location              varchar(200),
  audience              varchar(20) not null default 'all' check (audience in ('all','parents','staff','class')),
  class_id              uuid references public.classes(id) on delete cascade,
  created_by_profile_id uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  constraint school_events_class_audience check ((audience = 'class') = (class_id is not null)),
  constraint school_events_dates check (ends_at is null or ends_at >= starts_at)
);
create index idx_school_events_establishment on public.school_events(establishment_id, starts_at);
alter table public.school_events enable row level security;
revoke all on public.school_events from anon;

create policy school_events_select on public.school_events for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_is_staff()
      or audience = 'all'
      or (audience = 'parents' and public.my_role_scope() = 'family')
      or (audience = 'class' and public.is_family_of_class(class_id))
    )
  );

create policy school_events_insert on public.school_events for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and created_by_profile_id = auth.uid()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire')
      or (public.my_role_code() in ('enseignant','professeur_principal') and audience = 'class'
          and (public.is_homeroom_of_class(class_id) or public.is_teacher_of_class(class_id)))
    )
  );

create policy school_events_update on public.school_events for update to authenticated
  using (establishment_id = public.my_establishment_id()
         and (created_by_profile_id = auth.uid() or public.my_role_code() in ('proviseur','principal','directeur','censeur')))
  with check (establishment_id = public.my_establishment_id());

create policy school_events_delete on public.school_events for delete to authenticated
  using (establishment_id = public.my_establishment_id()
         and (created_by_profile_id = auth.uid() or public.my_role_code() in ('proviseur','principal','directeur','censeur')));

create or replace function public.trg_notify_event_created() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[];
begin
  if new.audience = 'class' then
    v_ids := public._family_user_ids_of_class(new.class_id);
  elsif new.audience = 'parents' then
    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_ids from public.profiles p join public.roles r on r.id = p.role_id
      where p.establishment_id = new.establishment_id and r.scope = 'family';
  elsif new.audience = 'staff' then
    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_ids from public.profiles p join public.roles r on r.id = p.role_id
      where p.establishment_id = new.establishment_id and r.is_staff;
  else
    select coalesce(array_agg(p.id), '{}'::uuid[]) into v_ids from public.profiles p where p.establishment_id = new.establishment_id;
  end if;
  perform public._notify_users(
    array(select x from unnest(v_ids) x where x is distinct from new.created_by_profile_id),
    new.establishment_id, 'event_new', new.title,
    to_char(new.starts_at at time zone 'Africa/Douala', 'DD/MM/YYYY HH24:MI') || coalesce(' — ' || new.location, ''), '#/events');
  return new;
end $$;
create trigger trg_school_events_notify after insert on public.school_events
for each row execute function public.trg_notify_event_created();

-- 5) Messagerie : un parent ou un élève ne peut écrire qu'au personnel de l'établissement
create or replace function public.start_or_get_conversation(p_recipient_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_me uuid := auth.uid();
    v_existing_id uuid;
    v_new_id uuid;
begin
    if p_recipient_id = v_me then
        raise exception 'messaging_cannot_message_self';
    end if;
    if not exists (select 1 from public.profiles where id = p_recipient_id and establishment_id = v_establishment_id and status = 'active') then
        raise exception 'messaging_recipient_not_found';
    end if;
    if not public.my_role_is_staff() and not exists (
        select 1 from public.profiles p join public.roles r on r.id = p.role_id where p.id = p_recipient_id and r.is_staff
    ) then
        raise exception 'messaging_recipient_not_allowed';
    end if;

    select c.id into v_existing_id
    from public.conversations c
    where c.type = 'direct' and c.establishment_id = v_establishment_id
      and exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = v_me)
      and exists (select 1 from public.conversation_participants where conversation_id = c.id and user_id = p_recipient_id)
      and (select count(*) from public.conversation_participants where conversation_id = c.id) = 2
    limit 1;

    if v_existing_id is not null then
        return jsonb_build_object('conversation_id', v_existing_id, 'created', false);
    end if;

    insert into public.conversations (establishment_id, type, created_by_profile_id)
    values (v_establishment_id, 'direct', v_me) returning id into v_new_id;
    insert into public.conversation_participants (conversation_id, user_id) values (v_new_id, v_me), (v_new_id, p_recipient_id);
    return jsonb_build_object('conversation_id', v_new_id, 'created', true);
end;
$$;

-- 6) Bulletin officiel : plus d'abonnement payant
drop function if exists public.bulletin_subscribe(uuid, text, text);

-- 7) Droits d'exécution : fonctions internes non appelables depuis l'API
revoke execute on function
  public._notify_users(uuid[], uuid, text, text, text, text), public._family_user_ids_of_class(uuid),
  public.trg_notify_results_validated(), public.trg_notify_homework_created(),
  public.trg_notify_discipline_created(), public.trg_notify_event_created()
from public, anon, authenticated;
