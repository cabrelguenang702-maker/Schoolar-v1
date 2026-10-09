-- ============================================================================
-- SCHOOLAR — ÉTAPE 7 / N — Présences (section 18 + "Gestion des présences")
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - getSession() (ouvre/crée la feuille d'appel + auto-provisionne un
--     enregistrement 'present' par élève) devient get_or_create_attendance_session(),
--     une fonction SQL SECURITY INVOKER : elle s'appuie sur la RLS
--     existante (pas de contournement) — si l'appelant n'a pas les droits
--     de saisie (assertMarkAccess), l'INSERT échoue nativement avec une
--     violation RLS, sans code de vérification supplémentaire à écrire.
--   - saveSession() (écritures + alertes automatiques après plusieurs
--     absences non justifiées) reste une Edge Function
--     (attendance-save-session) : contrairement aux notes, les emails
--     partent IMMÉDIATEMENT à la sauvegarde ici (pas seulement à une
--     validation explicite), donc l'aller-retour Edge Function est
--     nécessaire dès cette étape — pas de RPC pur possible.
--   - studentHistory() n'a besoin d'AUCUNE fonction dédiée : c'est un simple
--     select PostgREST avec embedding, déjà protégé par la policy de
--     lecture ci-dessous (qui réunit assertMarkAccess + assertClassStaffAccess
--     + assertStudentAccess — direction/vie scolaire, enseignant/PP de la
--     classe, élève lui-même, son parent).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Séances d'appel
-- ----------------------------------------------------------------------------
create table public.attendance_sessions (
    id                    uuid primary key default gen_random_uuid(),
    class_subject_id      uuid not null references public.class_subjects(id) on delete cascade,
    session_date          date not null,
    period_label          varchar(40) not null default '',
    taken_by_profile_id   uuid references public.profiles(id),
    taken_at              timestamptz,
    created_at            timestamptz not null default now(),
    unique (class_subject_id, session_date, period_label)
);
create index idx_attendance_sessions_date on public.attendance_sessions(session_date);

-- ----------------------------------------------------------------------------
-- 2. Présences individuelles
-- ----------------------------------------------------------------------------
create table public.attendance_records (
    id                          uuid primary key default gen_random_uuid(),
    session_id                  uuid not null references public.attendance_sessions(id) on delete cascade,
    student_id                  uuid not null references public.students(id) on delete cascade,
    status                      varchar(20) not null default 'present' check (status in ('present','absent','late')),
    justified                   boolean not null default false,
    justification_note          varchar(255),
    justification_document_url  text,
    alerted_at                  timestamptz,
    updated_at                  timestamptz not null default now(),
    unique (session_id, student_id)
);
create index idx_attendance_records_student on public.attendance_records(student_id, status);
create index idx_attendance_records_session on public.attendance_records(session_id);

create trigger trg_attendance_records_updated_at
before update on public.attendance_records
for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;

-- Lecture : réunion d'assertMarkAccess + assertClassStaffAccess (direction/vie
-- scolaire, enseignant de la matière, PP de la classe) — les séances n'ont
-- pas de notion de parent/élève individuel, contrairement aux enregistrements.
create policy attendance_sessions_select on public.attendance_sessions for select to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = attendance_sessions.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','surveillant_secteur','secretaire','econome','comptable')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
        )
    )
  );

-- Écriture (création/mise à jour de la séance) : assertMarkAccess strict
-- (pas surveillant_secteur/secretaire/etc. — seulement direction, vie
-- scolaire "générale", et l'enseignant de CETTE matière).
create policy attendance_sessions_mark on public.attendance_sessions for all to authenticated
  using (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = attendance_sessions.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.class_subjects cs join public.classes c on c.id = cs.class_id
      where cs.id = attendance_sessions.class_subject_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  );

-- Présences individuelles : lecture réunissant TOUTES les vues d'origine
-- (feuille d'appel, badge de classe, historique élève/parent).
create policy attendance_records_select on public.attendance_records for select to authenticated
  using (
    exists (
      select 1 from public.attendance_sessions ases
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.classes c on c.id = cs.class_id
      join public.students st on st.id = attendance_records.student_id
      where ases.id = attendance_records.session_id
        and c.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','surveillant_secteur','secretaire','econome','comptable')
          or cs.teacher_id = auth.uid()
          or c.homeroom_teacher_id = auth.uid()
          or st.profile_id = auth.uid()
          or exists (select 1 from public.student_parents sp where sp.student_id = st.id and sp.parent_id = auth.uid())
        )
    )
  );

create policy attendance_records_mark on public.attendance_records for all to authenticated
  using (
    exists (
      select 1 from public.attendance_sessions ases
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.classes c on c.id = cs.class_id
      where ases.id = attendance_records.session_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.attendance_sessions ases
      join public.class_subjects cs on cs.id = ases.class_subject_id
      join public.classes c on c.id = cs.class_id
      where ases.id = attendance_records.session_id
        and c.establishment_id = public.my_establishment_id()
        and (public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general') or cs.teacher_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- 3. get_or_create_attendance_session() — remplace
--    AttendanceController::getSession()/getOrCreateSession()
-- ----------------------------------------------------------------------------
create or replace function public.get_or_create_attendance_session(
    p_class_subject_id uuid,
    p_session_date date,
    p_period_label text default ''
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_class_id uuid;
    v_subject_name text;
    v_session_id uuid;
    v_period text := coalesce(p_period_label, '');
begin
    select cs.class_id, s.name into v_class_id, v_subject_name
      from public.class_subjects cs join public.subjects s on s.id = cs.subject_id
      where cs.id = p_class_subject_id;
    if v_class_id is null then
        raise exception 'class_subject_not_found';
    end if;

    insert into public.attendance_sessions (class_subject_id, session_date, period_label)
    values (p_class_subject_id, p_session_date, v_period)
    on conflict (class_subject_id, session_date, period_label) do nothing;

    select id into v_session_id from public.attendance_sessions
      where class_subject_id = p_class_subject_id and session_date = p_session_date and period_label = v_period;

    insert into public.attendance_records (session_id, student_id, status)
    select v_session_id, st.id, 'present'
    from public.students st
    where st.class_id = v_class_id and st.status = 'active'
    on conflict (session_id, student_id) do nothing;

    return jsonb_build_object(
        'session', (select to_jsonb(s) from public.attendance_sessions s where s.id = v_session_id),
        'subject_name', v_subject_name,
        'students', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'student_id', st.id, 'matricule', st.matricule, 'first_name', st.first_name, 'last_name', st.last_name,
                'record_id', ar.id, 'status', ar.status, 'justified', ar.justified,
                'justification_note', ar.justification_note, 'justification_document_url', ar.justification_document_url,
                'alerted_at', ar.alerted_at
            ) order by st.last_name, st.first_name), '[]'::jsonb)
            from public.students st
            left join public.attendance_records ar on ar.student_id = st.id and ar.session_id = v_session_id
            where st.class_id = v_class_id and st.status = 'active'
        ),
        'stats', (
            select jsonb_build_object(
                'total', count(*),
                'present', count(*) filter (where ar.status = 'present'),
                'absent', count(*) filter (where ar.status = 'absent'),
                'late', count(*) filter (where ar.status = 'late')
            )
            from public.students st
            left join public.attendance_records ar on ar.student_id = st.id and ar.session_id = v_session_id
            where st.class_id = v_class_id and st.status = 'active'
        )
    );
end;
$$;
grant execute on function public.get_or_create_attendance_session(uuid, date, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. attendance_class_summary_today() — remplace
--    AttendanceController::classSummary() (badge "Absents aujourd'hui")
-- ----------------------------------------------------------------------------
create or replace function public.attendance_class_summary_today(p_class_id uuid, p_date date default current_date)
returns jsonb
language sql stable security invoker set search_path = public
as $$
    select jsonb_build_object(
        'date', p_date,
        'absent_count', count(distinct ar.student_id) filter (where ar.status = 'absent'),
        'late_count', count(distinct ar.student_id) filter (where ar.status = 'late')
    )
    from public.attendance_records ar
    join public.attendance_sessions ases on ases.id = ar.session_id
    join public.class_subjects cs on cs.id = ases.class_subject_id
    where cs.class_id = p_class_id and ases.session_date = p_date;
$$;
grant execute on function public.attendance_class_summary_today(uuid, date) to authenticated;
