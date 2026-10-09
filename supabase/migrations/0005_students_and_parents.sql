-- ============================================================================
-- SCHOOLAR — ÉTAPE 5 / N — Élèves & Parents
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Pas de table `users` séparée : un élève ou un parent qui a un compte
--     de connexion est un `profiles` comme les autres (id = auth.users.id).
--     `students.profile_id` remplace `students.user_id` (migration 019 du
--     PHP) ; `student_parents.parent_id` référence directement `profiles`.
--   - Génération du matricule : trigger BEFORE INSERT (remplace
--     StudentController::generateMatricule(), même format "EL" + année + 4
--     chiffres, même boucle anti-collision).
--   - assertStudentManageAccess()/assertClassManageAccess() sont reproduits
--     en RLS avec USING (contrôle sur l'état AVANT modification — classe
--     actuelle de l'élève) ET WITH CHECK (contrôle sur l'état APRÈS —
--     nouvelle classe visée) : PostgreSQL sépare nativement ces deux
--     moments, ce que le PHP devait faire "à la main" avec deux fonctions.
--   - L'invitation d'un parent et la création d'un compte de connexion élève
--     restent des Edge Functions (auth.users à créer, emails à envoyer) —
--     voir student-invite-parent, parent-confirm-invitation,
--     student-create-login.
--   - La détection de doublon (nom+prénom+date de naissance) et l'alerte
--     "numéro identique élève/parent" étaient de simples avertissements non
--     bloquants : le frontend peut les recalculer lui-même avec un select
--     PostgREST direct sur `students` (déjà protégé par la RLS ci-dessous),
--     sans fonction dédiée.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Élèves
-- ----------------------------------------------------------------------------
create table public.students (
    id                  uuid primary key default gen_random_uuid(),
    establishment_id    uuid not null references public.establishments(id) on delete cascade,
    class_id            uuid references public.classes(id) on delete set null,
    profile_id          uuid references public.profiles(id) on delete set null,
    matricule           varchar(30) not null,
    first_name          varchar(100) not null,
    last_name           varchar(100) not null,
    sex                 varchar(1) check (sex in ('M','F')),
    birth_date          date,
    birth_place         varchar(150),
    photo_url           text,
    father_name         varchar(150),
    mother_name         varchar(150),
    parent_phone_1      varchar(30),
    parent_phone_2      varchar(30),
    student_phone       varchar(30),
    address             varchar(255),
    status              varchar(20) not null default 'active' check (status in ('active','archived','transferred')),
    created_by_profile_id uuid references public.profiles(id),
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now(),
    unique (establishment_id, matricule),
    unique (profile_id)
);
create index idx_students_establishment on public.students(establishment_id, status);
create index idx_students_class on public.students(class_id);
create index idx_students_alpha on public.students(establishment_id, last_name, first_name);
create index idx_students_duplicate_check on public.students(establishment_id, last_name, first_name, birth_date);

create trigger trg_students_updated_at
before update on public.students
for each row execute function public.set_updated_at();

create trigger trg_students_audit
after insert or update on public.students
for each row execute function public.log_audit_event();

-- Génération automatique du matricule si non fourni (identique au PHP :
-- préfixe "EL" + 2 derniers chiffres de l'année + 4 chiffres aléatoires).
create or replace function public.generate_student_matricule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    candidate varchar(30);
begin
    if new.matricule is not null and new.matricule <> '' then
        return new;
    end if;

    loop
        candidate := 'EL' || to_char(now(), 'YY') || lpad(floor(random() * 9000 + 1000)::text, 4, '0');
        exit when not exists (
            select 1 from public.students
            where establishment_id = new.establishment_id and matricule = candidate
        );
    end loop;

    new.matricule := candidate;
    return new;
end;
$$;

create trigger trg_students_generate_matricule
before insert on public.students
for each row execute function public.generate_student_matricule();

-- ----------------------------------------------------------------------------
-- 2. Liaison élèves ↔ parents
-- ----------------------------------------------------------------------------
create table public.student_parents (
    id            uuid primary key default gen_random_uuid(),
    student_id    uuid not null references public.students(id) on delete cascade,
    parent_id     uuid not null references public.profiles(id) on delete cascade,
    relationship  varchar(30),
    created_at    timestamptz not null default now(),
    unique (student_id, parent_id)
);
create index idx_student_parents_parent on public.student_parents(parent_id);
create index idx_student_parents_student on public.student_parents(student_id);

-- ----------------------------------------------------------------------------
-- 3. Invitations parents — accès exclusivement via les Edge Functions
--    (service_role) : contient un token qui fait office de secret.
-- ----------------------------------------------------------------------------
create table public.parent_invitations (
    id                        uuid primary key default gen_random_uuid(),
    establishment_id          uuid not null references public.establishments(id) on delete cascade,
    student_id                uuid not null references public.students(id) on delete cascade,
    invited_first_name        varchar(100) not null,
    invited_last_name         varchar(100) not null,
    invited_email             varchar(150) not null,
    invited_phone             varchar(30),
    relationship              varchar(30),
    validation_token          varchar(100) not null unique,
    status                    varchar(20) not null default 'pending' check (status in ('pending','completed','cancelled')),
    invited_by_profile_id     uuid references public.profiles(id),
    created_parent_profile_id uuid references public.profiles(id),
    created_at                timestamptz not null default now(),
    completed_at              timestamptz
);
create index idx_parent_invitations_student on public.parent_invitations(student_id);
create index idx_parent_invitations_status on public.parent_invitations(establishment_id, status);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.students enable row level security;
alter table public.student_parents enable row level security;
alter table public.parent_invitations enable row level security;

-- Élèves : reproduit StudentController::assertStudentAccess() (rôles à accès
-- complet, ou enseignant/PP limité à ses classes), + l'élève lui-même et ses
-- parents (utile pour les portails élève/parent, ajouté par cohérence avec
-- le reste de l'application même si ce contrôleur ne montrait que le côté
-- "personnel").
create policy students_select on public.students for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
      or profile_id = auth.uid()
      or exists (select 1 from public.student_parents sp where sp.student_id = students.id and sp.parent_id = auth.uid())
      or exists (select 1 from public.classes c where c.id = students.class_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.class_subjects cs where cs.class_id = students.class_id and cs.teacher_id = auth.uid())
    )
  );

-- Création : reproduit la garde conditionnelle sur assertClassManageAccess()
-- (seulement si une classe est fournie à la création).
create policy students_insert on public.students for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','secretaire')
      or (
        public.my_role_code() = 'professeur_principal'
        and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.homeroom_teacher_id = auth.uid()))
      )
    )
  );

-- Modification/archivage : USING = classe ACTUELLE (assertStudentManageAccess),
-- WITH CHECK = classe VISÉE si changée (assertClassManageAccess) — les deux
-- clauses RLS distinctes reproduisent exactement le double contrôle du PHP.
create policy students_update on public.students for update to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','secretaire')
      or (
        public.my_role_code() = 'professeur_principal'
        and exists (select 1 from public.classes c where c.id = students.class_id and c.homeroom_teacher_id = auth.uid())
      )
    )
  )
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','secretaire')
      or (
        public.my_role_code() = 'professeur_principal'
        and (class_id is null or exists (select 1 from public.classes c where c.id = class_id and c.homeroom_teacher_id = auth.uid()))
      )
    )
  );

-- student_parents : lecture par le parent concerné, le personnel à accès
-- complet, et l'enseignant/PP de la classe de l'élève. Toute écriture passe
-- par les Edge Functions (service_role) — invite-parent / confirm-invitation.
create policy student_parents_select on public.student_parents for select to authenticated
  using (
    parent_id = auth.uid()
    or exists (
      select 1 from public.students s
      where s.id = student_parents.student_id
        and s.establishment_id = public.my_establishment_id()
        and (
          public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire','econome','comptable')
          or exists (select 1 from public.classes c where c.id = s.class_id and c.homeroom_teacher_id = auth.uid())
          or exists (select 1 from public.class_subjects cs where cs.class_id = s.class_id and cs.teacher_id = auth.uid())
        )
    )
  );

-- parent_invitations : aucune policy — accès exclusivement via service_role
-- (Edge Functions) et via la fonction publique ci-dessous pour la
-- consultation du statut par token.

-- ----------------------------------------------------------------------------
-- Consultation publique du statut d'une invitation par token (page de
-- confirmation, avant authentification) — remplace
-- ParentController::invitationStatus(). Le token fait office de secret,
-- comme dans la version PHP (pas d'authentification supplémentaire requise).
-- ----------------------------------------------------------------------------
create or replace function public.get_parent_invitation_status(p_token text)
returns table (
    invited_first_name varchar, invited_last_name varchar, invited_email varchar,
    relationship varchar, status varchar,
    student_first_name varchar, student_last_name varchar, establishment_name varchar
)
language sql stable security definer set search_path = public
as $$
    select pi.invited_first_name, pi.invited_last_name, pi.invited_email, pi.relationship, pi.status,
           s.first_name, s.last_name, e.name
    from public.parent_invitations pi
    join public.students s on s.id = pi.student_id
    join public.establishments e on e.id = pi.establishment_id
    where pi.validation_token = p_token;
$$;
grant execute on function public.get_parent_invitation_status(text) to anon, authenticated;
