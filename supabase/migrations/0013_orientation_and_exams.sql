-- ============================================================================
-- SCHOOLAR — ÉTAPE 13 / N — Orientation (IA Claude), Préparation aux concours
-- & Bulletins pilotés par IA (IA GPT)
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Élargit payments_exactly_one_target (étape 11) à 4 cibles et étend le
--     trigger payments_apply_effects existant (CREATE OR REPLACE, pas de
--     nouveau trigger) pour activer concours_subscriptions/bulletin_subscriptions
--     à la confirmation — même mécanique que Premium Parents.
--   - Accès élève à sa propre orientation/ses épreuves/bulletins : le PHP
--     d'origine documentait explicitement cette restriction comme une
--     limitation temporaire ("les comptes élèves ne sont pas encore créés
--     par la plateforme") — or les comptes élèves EXISTENT dans cette
--     conversion depuis l'étape 5 (student-create-login). L'accès est donc
--     étendu au profil de l'élève lui-même, dans l'esprit explicite du PHP
--     plutôt qu'en contradiction avec lui.
--   - Les appels aux API Anthropic (orientation) et OpenAI (épreuves,
--     correction, bulletins) restent des Edge Functions — ce sont des appels
--     sortants vers un fournisseur tiers, impossibles à faire depuis
--     PostgreSQL seul. Chaque fonction reproduit le system prompt exact du
--     PHP d'origine.
--   - concours_subscribe()/bulletin_subscribe() (RPC) suivent exactement le
--     même schéma que premium_subscribe() (étape 11) : pas d'appel externe à
--     l'initiation, donc pas besoin d'Edge Function pour ÇA — seule la
--     confirmation (payments-confirm-dev, étendue ici) envoie un email.
--   - PDF du bulletin : HORS PÉRIMÈTRE (comme à l'étape 11) — la version
--     imprimable navigateur (déjà gérée côté frontend) reste le repli, comme
--     dans le PHP d'origine lorsque mPDF n'est pas installé.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Paiements : élargissement à 4 cibles
-- ----------------------------------------------------------------------------
alter table public.payments add column concours_subscription_id uuid;
alter table public.payments add column bulletin_subscription_id uuid;

alter table public.payments drop constraint payments_exactly_one_target;

-- ----------------------------------------------------------------------------
-- 1. Orientation scolaire — historique des analyses IA
-- ----------------------------------------------------------------------------
create table public.career_assessments (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    student_id             uuid not null references public.students(id) on delete cascade,
    requested_by_profile_id uuid references public.profiles(id),
    content                jsonb not null,
    ai_model               varchar(60) not null,
    created_at             timestamptz not null default now()
);
create index idx_career_assessments_student on public.career_assessments(student_id, created_at desc);

alter table public.career_assessments enable row level security;

-- Reproduit assertAccess() d'OrientationController, étendu au profil élève
-- lui-même (voir note en tête de fichier).
create policy career_assessments_select on public.career_assessments for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = career_assessments.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = career_assessments.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = career_assessments.student_id and s.profile_id = auth.uid())
    )
  );
-- Pas de policy INSERT cliente : uniquement via l'Edge Function orientation-generate.

-- ----------------------------------------------------------------------------
-- 2. Préparation aux concours — abonnement, épreuves, tentatives
-- ----------------------------------------------------------------------------
create table public.concours_subscriptions (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    school_year_id    uuid not null references public.school_years(id) on delete cascade,
    tier              varchar(20) not null check (tier in ('limited','unlimited')),
    amount            numeric(12,2) not null,
    status            varchar(20) not null default 'pending' check (status in ('pending','active','cancelled')),
    created_at        timestamptz not null default now(),
    unique (student_id, school_year_id)
);

alter table public.payments add constraint fk_pay_concours_sub
    foreign key (concours_subscription_id) references public.concours_subscriptions(id) on delete cascade;

alter table public.concours_subscriptions enable row level security;

-- Lecture large (comme ExamController::assertAccess — PAS parent-only,
-- contrairement à Premium Parents) ; écriture uniquement via concours_subscribe().
create policy concours_subscriptions_select on public.concours_subscriptions for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = concours_subscriptions.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = concours_subscriptions.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = concours_subscriptions.student_id and s.profile_id = auth.uid())
    )
  );

create table public.exam_papers (
    id                       uuid primary key default gen_random_uuid(),
    establishment_id         uuid not null references public.establishments(id) on delete cascade,
    requested_by_student_id  uuid not null references public.students(id) on delete cascade,
    subject_id               uuid references public.subjects(id) on delete set null,
    subject_label            varchar(120) not null,
    level                    varchar(40) not null,
    difficulty               varchar(20) not null default 'medium' check (difficulty in ('easy','medium','hard')),
    time_limit_minutes       smallint not null default 30,
    questions                jsonb not null,
    ai_model                 varchar(60) not null,
    created_at               timestamptz not null default now()
);
create index idx_exam_papers_student on public.exam_papers(requested_by_student_id, created_at desc);
create index idx_exam_papers_establishment_subject on public.exam_papers(establishment_id, subject_id, level);

create table public.exam_attempts (
    id             uuid primary key default gen_random_uuid(),
    exam_paper_id  uuid not null references public.exam_papers(id) on delete cascade,
    student_id     uuid not null references public.students(id) on delete cascade,
    started_at     timestamptz not null default now(),
    submitted_at   timestamptz,
    answers        jsonb,
    score          numeric(6,2),
    max_score      numeric(6,2),
    feedback       jsonb,
    status         varchar(20) not null default 'in_progress' check (status in ('in_progress','submitted','graded')),
    created_at     timestamptz not null default now(),
    unique (exam_paper_id, student_id)
);
create index idx_exam_attempts_student on public.exam_attempts(student_id, status);

alter table public.exam_papers enable row level security;
alter table public.exam_attempts enable row level security;

create policy exam_papers_select on public.exam_papers for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = exam_papers.requested_by_student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = exam_papers.requested_by_student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = exam_papers.requested_by_student_id and s.profile_id = auth.uid())
    )
  );
-- Pas de policy INSERT : uniquement via exam-generate (vérifie l'abonnement
-- + le quota, ce qu'une policy seule ne pourrait pas exprimer proprement).

create policy exam_attempts_select on public.exam_attempts for select to authenticated
  using (
    exists (
      select 1 from public.exam_papers ep where ep.id = exam_attempts.exam_paper_id
      and (
        public.my_role_code() in ('proviseur','principal','directeur','censeur')
        or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = ep.requested_by_student_id and c.homeroom_teacher_id = auth.uid())
        or exists (select 1 from public.student_parents sp where sp.student_id = ep.requested_by_student_id and sp.parent_id = auth.uid())
        or exists (select 1 from public.students s where s.id = ep.requested_by_student_id and s.profile_id = auth.uid())
      )
    )
  );
-- start() (insert) est un simple enregistrement d'horodatage, sans appel IA :
-- une policy RLS suffit ici (pas besoin d'Edge Function).
create policy exam_attempts_start on public.exam_attempts for insert to authenticated
  with check (
    exists (
      select 1 from public.exam_papers ep join public.students s on s.id = ep.requested_by_student_id
      where ep.id = exam_attempts.exam_paper_id and s.profile_id = auth.uid()
    )
  );

-- ----------------------------------------------------------------------------
-- concours_subscribe() — remplace ExamController::subscribe() + initiatePayment()
-- ----------------------------------------------------------------------------
create or replace function public.concours_subscribe(p_student_id uuid, p_tier text, p_method text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_school_year_id uuid;
    v_sub_id uuid;
    v_amount numeric;
    v_payment_id uuid;
begin
    if public.my_role_code() <> 'parent' then
        raise exception 'premium_parent_only';
    end if;
    if not exists (select 1 from public.student_parents where student_id = p_student_id and parent_id = auth.uid()) then
        raise exception 'student_manage_denied';
    end if;
    if p_tier not in ('limited', 'unlimited') then
        raise exception 'concours_tier_invalid';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;

    select id into v_school_year_id from public.school_years where establishment_id = v_establishment_id and is_current limit 1;
    if v_school_year_id is null then
        raise exception 'no_current_school_year';
    end if;

    if exists (select 1 from public.concours_subscriptions where student_id = p_student_id and school_year_id = v_school_year_id and status = 'active') then
        raise exception 'concours_already_active';
    end if;

    v_amount := case when p_tier = 'unlimited' then 1000 else 500 end;

    insert into public.concours_subscriptions (establishment_id, student_id, school_year_id, tier, amount, status)
    values (v_establishment_id, p_student_id, v_school_year_id, p_tier, v_amount, 'pending')
    on conflict (student_id, school_year_id) do update set tier = excluded.tier, amount = excluded.amount, status = 'pending'
    returning id into v_sub_id;

    insert into public.payments (establishment_id, concours_subscription_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_establishment_id, v_sub_id, v_amount, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', v_amount, 'status', 'pending');
end;
$$;
grant execute on function public.concours_subscribe(uuid, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Bulletins pilotés par IA
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('bulletin-templates', 'bulletin-templates', false) on conflict (id) do nothing;

create table public.bulletin_templates (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    class_id               uuid not null references public.classes(id) on delete cascade,
    storage_path           text not null,
    original_filename      varchar(255) not null,
    mime_type              varchar(100) not null,
    uploaded_by_profile_id uuid references public.profiles(id),
    created_at             timestamptz not null default now(),
    unique (class_id)
);

create table public.bulletin_subscriptions (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    school_year_id    uuid not null references public.school_years(id) on delete cascade,
    amount            numeric(12,2) not null default 500,
    status            varchar(20) not null default 'pending' check (status in ('pending','active','cancelled')),
    created_at        timestamptz not null default now(),
    unique (student_id, school_year_id)
);

alter table public.payments add constraint fk_pay_bulletin_sub
    foreign key (bulletin_subscription_id) references public.bulletin_subscriptions(id) on delete cascade;

-- Contrainte "exactement une cible" à 4 colonnes (remplace celle de l'étape 11).
alter table public.payments add constraint payments_exactly_one_target check (
    (student_fee_id is not null)::int + (premium_subscription_id is not null)::int +
    (concours_subscription_id is not null)::int + (bulletin_subscription_id is not null)::int = 1
);

create table public.bulletins (
    id                     uuid primary key default gen_random_uuid(),
    establishment_id       uuid not null references public.establishments(id) on delete cascade,
    student_id             uuid not null references public.students(id) on delete cascade,
    sequence_id            uuid not null references public.sequences(id) on delete cascade,
    content                jsonb not null,
    ai_model               varchar(60) not null,
    generated_by_profile_id uuid references public.profiles(id),
    verification_code      varchar(30) unique,
    created_at             timestamptz not null default now(),
    unique (student_id, sequence_id)
);

alter table public.bulletin_templates enable row level security;
alter table public.bulletin_subscriptions enable row level security;
alter table public.bulletins enable row level security;

-- Exemple de bulletin : lecture large (nécessaire pour bulletin-generate et
-- pour l'indicateur "template_available"), gestion = TEMPLATE_MANAGE_ROLES.
create policy bulletin_templates_select on public.bulletin_templates for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy bulletin_templates_manage on public.bulletin_templates for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire'))
  with check (establishment_id = public.my_establishment_id() and public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire'));

-- Abonnement Bulletins : lecture large (assertReadAccess), comme concours —
-- pas parent-only, contrairement à Premium Parents.
create policy bulletin_subscriptions_select on public.bulletin_subscriptions for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = bulletin_subscriptions.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = bulletin_subscriptions.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = bulletin_subscriptions.student_id and s.profile_id = auth.uid())
    )
  );

-- Bulletins générés : même groupe de lecture qu'assertReadAccess (personnel/
-- PP/parent/élève) ; écriture uniquement via bulletin-generate (Edge Function,
-- appel OpenAI vision).
create policy bulletins_select on public.bulletins for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','secretaire')
      or exists (select 1 from public.classes c join public.students s on s.class_id = c.id where s.id = bulletins.student_id and c.homeroom_teacher_id = auth.uid())
      or exists (select 1 from public.student_parents sp where sp.student_id = bulletins.student_id and sp.parent_id = auth.uid())
      or exists (select 1 from public.students s where s.id = bulletins.student_id and s.profile_id = auth.uid())
    )
  );

-- ----------------------------------------------------------------------------
-- bulletin_subscribe() — remplace BulletinController::subscribe()
-- ----------------------------------------------------------------------------
create or replace function public.bulletin_subscribe(p_student_id uuid, p_method text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
    v_school_year_id uuid;
    v_sub_id uuid;
    v_payment_id uuid;
begin
    if public.my_role_code() <> 'parent' then
        raise exception 'premium_parent_only';
    end if;
    if not exists (select 1 from public.student_parents where student_id = p_student_id and parent_id = auth.uid()) then
        raise exception 'student_manage_denied';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;

    select id into v_school_year_id from public.school_years where establishment_id = v_establishment_id and is_current limit 1;
    if v_school_year_id is null then
        raise exception 'no_current_school_year';
    end if;

    if exists (select 1 from public.bulletin_subscriptions where student_id = p_student_id and school_year_id = v_school_year_id and status = 'active') then
        raise exception 'bulletin_subscription_already_active';
    end if;

    insert into public.bulletin_subscriptions (establishment_id, student_id, school_year_id, amount, status)
    values (v_establishment_id, p_student_id, v_school_year_id, 500, 'pending')
    on conflict (student_id, school_year_id) do update set status = 'pending'
    returning id into v_sub_id;

    insert into public.payments (establishment_id, bulletin_subscription_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_establishment_id, v_sub_id, 500, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', 500, 'status', 'pending');
end;
$$;
grant execute on function public.bulletin_subscribe(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 4. Extension du trigger de paiement (étape 11) aux 2 nouvelles cibles
-- ----------------------------------------------------------------------------
create or replace function public.payments_apply_effects()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if TG_OP = 'UPDATE' and old.status = new.status then
        return new;
    end if;

    if new.status = 'completed' then
        new.receipt_number := public.generate_receipt_number();
        new.paid_at := now();

        if new.student_fee_id is not null then
            if new.amount > (
                select (amount_due - amount_paid) + 0.01 from public.student_fees where id = new.student_fee_id
            ) then
                raise exception 'payment_exceeds_balance';
            end if;

            update public.student_fees
              set amount_paid = amount_paid + new.amount,
                  status = case
                    when amount_paid + new.amount >= amount_due - 0.01 then 'paid'
                    when amount_paid + new.amount > 0 then 'partial'
                    else 'unpaid'
                  end
              where id = new.student_fee_id;
        elsif new.premium_subscription_id is not null then
            update public.premium_subscriptions
              set status = 'active', period_start = current_date, period_end = current_date + interval '1 month'
              where id = new.premium_subscription_id;
        elsif new.concours_subscription_id is not null then
            update public.concours_subscriptions set status = 'active' where id = new.concours_subscription_id;
        elsif new.bulletin_subscription_id is not null then
            update public.bulletin_subscriptions set status = 'active' where id = new.bulletin_subscription_id;
        end if;
    elsif new.status = 'failed' then
        if new.premium_subscription_id is not null then
            update public.premium_subscriptions set status = 'cancelled' where id = new.premium_subscription_id;
        elsif new.concours_subscription_id is not null then
            update public.concours_subscriptions set status = 'cancelled' where id = new.concours_subscription_id;
        elsif new.bulletin_subscription_id is not null then
            update public.bulletin_subscriptions set status = 'cancelled' where id = new.bulletin_subscription_id;
        end if;
    end if;

    return new;
end;
$$;
-- Le trigger trg_payments_apply_effects (étape 11) pointe déjà vers cette
-- fonction : CREATE OR REPLACE suffit, pas besoin de le recréer.
