-- ============================================================================
-- SCHOOLAR — ÉTAPE 12 / N — Gestion documentaire (section 8) & Bibliothèque numérique (section 9)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Fichiers : deux buckets Supabase Storage PRIVÉS ("documents",
--     "library"), même principe qu'à l'étape 9 (homework) — jamais d'URL
--     publique, accès uniquement via une URL signée à durée limitée après
--     vérification d'accès.
--   - list()/studentDocuments() (lecture) et trash()/restore() (bascule
--     simple d'un champ) sont de simples select/update PostgREST protégés
--     par RLS — pas besoin d'Edge Function. Seuls l'upload (multipart) et la
--     suppression définitive (doit aussi supprimer l'objet Storage) restent
--     des Edge Functions.
--   - Corrections reproduites à l'identique du PHP d'origine à cette même
--     étape : permission `documents.manage` créée et attribuée à
--     proviseur/principal (+ directeur, cohérent avec le reste de la
--     conversion) et secrétaire ; `students.view` ajoutée à la secrétaire
--     (elle avait déjà `students.manage` mais pas la permission qui protège
--     la recherche GET /students, nécessaire pour rattacher un document) ;
--     `library.manage` étendue aux enseignants/PP.
-- ============================================================================

insert into public.permissions (code, label_fr, label_en, category) values
    ('documents.manage', 'Gérer les documents administratifs', 'Manage administrative documents', 'resources')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('proviseur','principal','directeur','secretaire') and p.code = 'documents.manage'
on conflict do nothing;

-- Correction reproduite du PHP : la secrétaire avait students.manage mais
-- pas students.view (nécessaire pour retrouver un élève auquel rattacher un document).
insert into public.role_permissions (role_id, permission_id)
select (select id from public.roles where code = 'secretaire'), (select id from public.permissions where code = 'students.view')
on conflict do nothing;

insert into public.role_permissions (role_id, permission_id)
select r.id, p.id from public.roles r cross join public.permissions p
where r.code in ('enseignant','professeur_principal') and p.code = 'library.manage'
on conflict do nothing;

-- Buckets privés — jamais d'URL publique.
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('library', 'library', false) on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- 1. Documents administratifs
-- ----------------------------------------------------------------------------
create table public.documents (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    student_id            uuid references public.students(id) on delete cascade,
    category              varchar(30) not null check (category in (
        'bulletin','birth_certificate','medical_certificate','photo','diploma',
        'timetable','circular','administrative_note'
    )),
    title                 varchar(180) not null,
    storage_path          text not null,
    original_filename     varchar(255) not null,
    mime_type             varchar(100) not null,
    file_size_bytes       integer not null,
    uploaded_by_profile_id uuid references public.profiles(id),
    deleted_at            timestamptz,
    created_at            timestamptz not null default now()
);
create index idx_documents_establishment on public.documents(establishment_id, deleted_at, category);
create index idx_documents_student on public.documents(student_id, deleted_at);

create trigger trg_documents_audit
after insert or update on public.documents
for each row execute function public.log_audit_event();

alter table public.documents enable row level security;

-- Lecture : personnel documents.manage (voit tout, y compris la corbeille),
-- ou parent d'un élève précis (documents généraux student_id NULL exclus,
-- corbeille masquée) — reproduit assertDocumentAccess().
create policy documents_select on public.documents for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.has_permission('documents.manage')
      or (
        deleted_at is null and student_id is not null
        and exists (select 1 from public.student_parents sp where sp.student_id = documents.student_id and sp.parent_id = auth.uid())
      )
    )
  );

create policy documents_insert on public.documents for insert to authenticated
  with check (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage'));
create policy documents_update on public.documents for update to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage'));
-- Suppression définitive réservée aux documents déjà en corbeille (comme le PHP).
create policy documents_delete on public.documents for delete to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('documents.manage') and deleted_at is not null);

-- ----------------------------------------------------------------------------
-- 2. Bibliothèque numérique
-- ----------------------------------------------------------------------------
create table public.library_resources (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    category              varchar(30) not null check (category in (
        'book','pdf','exercise','past_exam','answer_key','video','podcast','interactive_course'
    )),
    title                 varchar(180) not null,
    description           varchar(500),
    level                 varchar(40),
    subject_id            uuid references public.subjects(id) on delete set null,
    storage_path          text not null,
    original_filename     varchar(255) not null,
    mime_type             varchar(100) not null,
    file_size_bytes       integer not null,
    uploaded_by_profile_id uuid references public.profiles(id),
    deleted_at            timestamptz,
    created_at            timestamptz not null default now()
);
create index idx_library_establishment on public.library_resources(establishment_id, deleted_at, category);
create index idx_library_subject on public.library_resources(subject_id);
create index idx_library_level on public.library_resources(establishment_id, level);

create trigger trg_library_resources_audit
after insert or update on public.library_resources
for each row execute function public.log_audit_event();

alter table public.library_resources enable row level security;

-- Lecture : ouverte à tout membre authentifié de l'établissement (élèves,
-- parents, personnel) comme une bibliothèque d'école — corbeille masquée
-- sauf pour library.manage.
create policy library_select on public.library_resources for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (deleted_at is null or public.has_permission('library.manage'))
  );

create policy library_insert on public.library_resources for insert to authenticated
  with check (establishment_id = public.my_establishment_id() and public.has_permission('library.manage'));
create policy library_update on public.library_resources for update to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('library.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('library.manage'));
create policy library_delete on public.library_resources for delete to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('library.manage') and deleted_at is not null);
