-- ============================================================================
-- SCHOOLAR — ÉTAPE 11 / N — Paiements (frais de scolarité, Mobile Money,
-- Premium Parents)
-- ============================================================================
-- ⚠️ IMPORTANT : comme dans le PHP d'origine, l'intégration Mobile Money
-- fournie ici est un STUB DE DÉVELOPPEMENT (MobileMoneyGateway simulait déjà
-- le webhook faute d'identifiants Orange/MTN réels). payments_confirm_dev()
-- et la référence "DEV-xxxxx" ci-dessous ne sont PAS un paiement réel — avant
-- toute mise en production, il faut les remplacer par l'intégration officielle
-- Orange Money / MTN MoMo (webhook signé, vérification de signature, etc.).
-- Rien dans cette étape ne doit être considéré comme prêt pour de l'argent réel.
--
-- CHOIX D'ARCHITECTURE :
--   - applyPaymentToInvoice() (SELECT ... FOR UPDATE puis recalcul manuel du
--     statut de la facture) devient un TRIGGER sur `payments` : dès qu'un
--     paiement passe à 'completed' (à l'insert direct — encaissement manuel —
--     ou à la mise à jour — confirmation Mobile Money), la facture ou
--     l'abonnement Premium concerné est mis à jour automatiquement, avec le
--     verrouillage de ligne implicite d'un UPDATE Postgres (plus besoin de
--     FOR UPDATE explicite). Un seul trigger couvre les deux cibles
--     (student_fee_id / premium_subscription_id) — les colonnes
--     concours_subscription_id / bulletin_subscription_id du PHP (étape 13)
--     seront ajoutées à ce même trigger le moment venu.
--   - Le numéro de reçu (attribué uniquement quand un paiement devient
--     'completed') est généré par le même trigger, plus besoin d'appeler
--     MobileMoneyGateway::generateReceiptNumber() avant l'insert.
--   - "Un seul abonnement actif à la fois" : la version MySQL contournait
--     l'absence d'index unique partiel avec une colonne générée
--     "active_flag". PostgreSQL supporte nativement les index uniques
--     partiels (`WHERE status = 'active'`) — le contournement disparaît.
--   - generate_fee_invoices() (RPC) remplace FeeController::generateInvoices() —
--     idempotent via ON CONFLICT DO NOTHING, comme en PHP.
--   - invoice_pay_mobile_money() / premium_subscribe() (RPC, SECURITY
--     DEFINER) remplacent payInvoiceMobileMoney()/subscribe() : ils créent
--     le paiement 'pending' ET la ligne cible (abonnement) de façon atomique,
--     et appliquent eux-mêmes assertFeeAccess/assertParentOfStudent.
--   - payments-confirm-dev reste une Edge Function : c'est la SEULE étape
--     encore utile une fois le trigger en place, car l'email d'activation
--     Premium (activatePremiumSubscription) nécessite un envoi externe.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Frais de scolarité
-- ----------------------------------------------------------------------------
create table public.fee_structures (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    school_year_id        uuid not null references public.school_years(id) on delete cascade,
    label                 varchar(150) not null,
    level                 varchar(40),
    series                varchar(40),
    amount                numeric(12,2) not null check (amount > 0),
    due_date              date,
    status                varchar(20) not null default 'active' check (status in ('active','archived')),
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now()
);
create index idx_fee_structures_establishment on public.fee_structures(establishment_id, school_year_id, status);

create trigger trg_fee_structures_audit
after insert or update on public.fee_structures
for each row execute function public.log_audit_event();

create table public.student_fees (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    fee_structure_id  uuid not null references public.fee_structures(id) on delete cascade,
    amount_due        numeric(12,2) not null,
    amount_paid       numeric(12,2) not null default 0,
    status            varchar(20) not null default 'unpaid' check (status in ('unpaid','partial','paid')),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now(),
    unique (student_id, fee_structure_id)
);
create index idx_student_fees_establishment on public.student_fees(establishment_id, status);
create index idx_student_fees_student on public.student_fees(student_id);

create trigger trg_student_fees_updated_at
before update on public.student_fees
for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- 2. Abonnements Premium Parents (500 FCFA/mois)
-- ----------------------------------------------------------------------------
create table public.premium_subscriptions (
    id                uuid primary key default gen_random_uuid(),
    establishment_id  uuid not null references public.establishments(id) on delete cascade,
    parent_id         uuid not null references public.profiles(id) on delete cascade,
    student_id        uuid not null references public.students(id) on delete cascade,
    amount            numeric(12,2) not null default 500,
    status            varchar(20) not null default 'pending' check (status in ('pending','active','expired','cancelled')),
    period_start      date,
    period_end        date,
    created_at        timestamptz not null default now()
);
create index idx_premium_subscriptions_parent on public.premium_subscriptions(parent_id, student_id);
-- Un seul abonnement actif à la fois par couple parent/élève — index unique
-- partiel natif (remplace le contournement "active_flag" du MySQL).
create unique index idx_premium_subscriptions_one_active on public.premium_subscriptions(parent_id, student_id)
  where status = 'active';

-- ----------------------------------------------------------------------------
-- 3. Paiements
-- ----------------------------------------------------------------------------
create table public.payments (
    id                      uuid primary key default gen_random_uuid(),
    establishment_id        uuid not null references public.establishments(id) on delete cascade,
    student_fee_id          uuid references public.student_fees(id) on delete cascade,
    premium_subscription_id uuid references public.premium_subscriptions(id) on delete cascade,
    amount                  numeric(12,2) not null check (amount > 0),
    method                  varchar(20) not null check (method in ('cash','orange_money','mtn_momo','bank_card')),
    provider_reference      varchar(100),
    payer_phone             varchar(30),
    status                  varchar(20) not null default 'pending' check (status in ('pending','completed','failed','cancelled')),
    initiated_by_profile_id uuid references public.profiles(id),
    receipt_number          varchar(30) unique,
    paid_at                 timestamptz,
    created_at              timestamptz not null default now(),
    constraint payments_exactly_one_target check (
        (student_fee_id is not null)::int + (premium_subscription_id is not null)::int = 1
    )
);
create index idx_payments_establishment on public.payments(establishment_id, status, created_at desc);
create index idx_payments_student_fee on public.payments(student_fee_id);
create index idx_payments_premium_subscription on public.payments(premium_subscription_id);

create trigger trg_payments_audit
after insert or update on public.payments
for each row execute function public.log_audit_event();

-- ----------------------------------------------------------------------------
-- 4. Suivi renforcé Premium — ajout additif à attendance_records (étape 7)
-- ----------------------------------------------------------------------------
alter table public.attendance_records add column checkout_at timestamptz;

-- Confidentialité de COLONNE (pas seulement de ligne) : la RLS de l'étape 7
-- autorise déjà TOUT parent à lire les présences de son enfant — une policy
-- de ligne ne suffit donc pas à réserver checkout_at aux abonnés Premium.
-- PostgreSQL permet un GRANT/REVOKE par colonne ; combiné à
-- premium_checkout_history() (SECURITY DEFINER, qui s'exécute avec les
-- droits du propriétaire de la fonction et n'est donc pas concerné par ce
-- REVOKE), on obtient une vraie confidentialité de colonne.
revoke select (checkout_at) on public.attendance_records from authenticated, anon;

-- ----------------------------------------------------------------------------
-- 5. Trigger central : effets d'un paiement qui devient 'completed'/'failed'
-- ----------------------------------------------------------------------------
create or replace function public.generate_receipt_number()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    candidate text;
begin
    loop
        candidate := 'RC' || to_char(now(), 'YYMMDD') || lpad(floor(random() * 100000)::text, 5, '0');
        exit when not exists (select 1 from public.payments where receipt_number = candidate);
    end loop;
    return candidate;
end;
$$;

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
        -- Toujours réattribués par le serveur à la transition — jamais dictés
        -- par le payload client (même si status='completed' était déjà
        -- accompagné d'un receipt_number/paid_at dans la requête).
        new.receipt_number := public.generate_receipt_number();
        new.paid_at := now();

        if new.student_fee_id is not null then
            -- Garde-fou absent d'un simple insert direct (encaissement manuel) :
            -- reproduit la vérification "amount > remaining" de recordManualPayment().
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
        end if;
    elsif new.status = 'failed' and new.premium_subscription_id is not null then
        update public.premium_subscriptions set status = 'cancelled' where id = new.premium_subscription_id;
    end if;

    return new;
end;
$$;

create trigger trg_payments_apply_effects
before insert or update on public.payments
for each row execute function public.payments_apply_effects();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.fee_structures enable row level security;
alter table public.student_fees enable row level security;
alter table public.premium_subscriptions enable row level security;
alter table public.payments enable row level security;

-- Catalogue des frais : lecture large (nécessaire pour l'affichage des
-- factures d'un parent, cf. embedding PostgREST fee_structures(label,due_date)) ;
-- gestion réservée à payments.manage.
create policy fee_structures_select on public.fee_structures for select to authenticated
  using (establishment_id = public.my_establishment_id());
create policy fee_structures_manage on public.fee_structures for all to authenticated
  using (establishment_id = public.my_establishment_id() and public.has_permission('payments.manage'))
  with check (establishment_id = public.my_establishment_id() and public.has_permission('payments.manage'));

-- Factures élève : personnel payments.manage, ou le(s) parent(s) de l'élève.
create policy student_fees_select on public.student_fees for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      public.has_permission('payments.manage')
      or exists (select 1 from public.student_parents sp where sp.student_id = student_fees.student_id and sp.parent_id = auth.uid())
    )
  );
-- Pas de policy INSERT/UPDATE cliente : généré par generate_fee_invoices()
-- et mis à jour par le trigger payments_apply_effects (tous deux SECURITY DEFINER).

-- Abonnements Premium : strictement réservé au parent concerné (comme le
-- PHP : "premium_parent_only", aucune visibilité staff exposée par ces routes).
create policy premium_subscriptions_select on public.premium_subscriptions for select to authenticated
  using (parent_id = auth.uid());
create policy premium_subscriptions_cancel on public.premium_subscriptions for update to authenticated
  using (parent_id = auth.uid() and status = 'active')
  with check (parent_id = auth.uid() and status = 'cancelled');
-- Pas de policy INSERT : uniquement via premium_subscribe() (SECURITY DEFINER).

-- Paiements : personnel payments.manage, ou l'auteur du paiement (assertPaymentOwnership).
create policy payments_select on public.payments for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (public.has_permission('payments.manage') or initiated_by_profile_id = auth.uid())
  );

-- Encaissement manuel (espèces/carte) par le personnel — Mobile Money passe
-- exclusivement par les RPC dédiées (SECURITY DEFINER), jamais par un insert direct.
create policy payments_insert_manual on public.payments for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and public.has_permission('payments.manage')
    and method in ('cash','bank_card')
  );

-- Confirmation (dev uniquement, via payments-confirm-dev) : le propriétaire
-- ou le personnel payments.manage, seulement depuis 'pending'.
create policy payments_update_confirm on public.payments for update to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and status = 'pending'
    and (public.has_permission('payments.manage') or initiated_by_profile_id = auth.uid())
  )
  with check (establishment_id = public.my_establishment_id());

-- ----------------------------------------------------------------------------
-- 6. generate_fee_invoices() — remplace FeeController::generateInvoices()
-- ----------------------------------------------------------------------------
create or replace function public.generate_fee_invoices(p_fee_structure_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_fee record;
    v_created integer := 0;
    v_candidates integer;
begin
    select * into v_fee from public.fee_structures where id = p_fee_structure_id;
    if v_fee is null or v_fee.establishment_id is distinct from public.my_establishment_id() then
        raise exception 'fee_structure_not_found';
    end if;

    with candidates as (
        select s.id from public.students s left join public.classes c on c.id = s.class_id
        where s.establishment_id = v_fee.establishment_id and s.status = 'active'
          and (v_fee.level is null or c.level = v_fee.level)
          and (v_fee.series is null or c.series = v_fee.series)
    ),
    inserted as (
        insert into public.student_fees (establishment_id, student_id, fee_structure_id, amount_due)
        select v_fee.establishment_id, id, v_fee.id, v_fee.amount from candidates
        on conflict (student_id, fee_structure_id) do nothing
        returning 1
    )
    select count(*) from candidates into v_candidates;
    select count(*) from inserted into v_created;

    return jsonb_build_object('created', v_created, 'candidates', v_candidates);
end;
$$;
grant execute on function public.generate_fee_invoices(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 7. invoice_pay_mobile_money() / premium_subscribe() — remplacent
--    PaymentController::payInvoiceMobileMoney()/subscribe() +
--    PaymentController::initiatePayment() (STUB — voir avertissement en tête
--    de fichier : provider_reference est une référence de développement).
-- ----------------------------------------------------------------------------
create or replace function public.invoice_pay_mobile_money(p_invoice_id uuid, p_method text, p_phone text, p_amount numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_invoice record;
    v_remaining numeric;
    v_amount numeric;
    v_payment_id uuid;
    v_authorized boolean;
begin
    select * into v_invoice from public.student_fees where id = p_invoice_id;
    if v_invoice is null or v_invoice.establishment_id is distinct from public.my_establishment_id() then
        raise exception 'invoice_not_found';
    end if;
    if p_method not in ('orange_money', 'mtn_momo') then
        raise exception 'payment_method_invalid';
    end if;

    select public.has_permission('payments.manage')
        or exists (select 1 from public.student_parents sp where sp.student_id = v_invoice.student_id and sp.parent_id = auth.uid())
    into v_authorized;
    if not v_authorized then
        raise exception 'student_manage_denied';
    end if;

    v_remaining := v_invoice.amount_due - v_invoice.amount_paid;
    v_amount := coalesce(p_amount, v_remaining);
    if v_amount <= 0 or v_amount > v_remaining + 0.01 then
        raise exception 'payment_exceeds_balance';
    end if;

    insert into public.payments (establishment_id, student_fee_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_invoice.establishment_id, v_invoice.id, v_amount, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', v_amount, 'status', 'pending');
end;
$$;
grant execute on function public.invoice_pay_mobile_money(uuid, text, text, numeric) to authenticated;

create or replace function public.premium_subscribe(p_student_id uuid, p_method text, p_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_establishment_id uuid := public.my_establishment_id();
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
    if exists (select 1 from public.premium_subscriptions where parent_id = auth.uid() and student_id = p_student_id and status = 'active') then
        raise exception 'premium_already_active';
    end if;

    insert into public.premium_subscriptions (establishment_id, parent_id, student_id, amount, status)
    values (v_establishment_id, auth.uid(), p_student_id, 500, 'pending')
    returning id into v_sub_id;

    insert into public.payments (establishment_id, premium_subscription_id, amount, method, payer_phone, status, initiated_by_profile_id, provider_reference)
    values (v_establishment_id, v_sub_id, 500, p_method, p_phone, 'pending', auth.uid(), 'DEV-' || substr(gen_random_uuid()::text, 1, 8))
    returning id into v_payment_id;

    return jsonb_build_object('payment_id', v_payment_id, 'amount', 500, 'status', 'pending');
end;
$$;
grant execute on function public.premium_subscribe(uuid, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 8. payment_receipt() / premium_checkout_history() — lecture enrichie,
--    remplacent PaymentController::receipt()/checkoutTimes().
-- ----------------------------------------------------------------------------
create or replace function public.payment_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_payment public.payments;
    v_subject jsonb;
    v_label text;
begin
    select * into v_payment from public.payments where id = p_payment_id;
    if v_payment is null then
        raise exception 'payment_not_found';
    end if;
    if v_payment.status <> 'completed' then
        raise exception 'receipt_not_available';
    end if;

    if v_payment.student_fee_id is not null then
        select jsonb_build_object('first_name', s.first_name, 'last_name', s.last_name, 'matricule', s.matricule, 'student_id', s.id), fs.label
          into v_subject, v_label
          from public.student_fees sf join public.students s on s.id = sf.student_id join public.fee_structures fs on fs.id = sf.fee_structure_id
          where sf.id = v_payment.student_fee_id;
    else
        select jsonb_build_object('first_name', s.first_name, 'last_name', s.last_name, 'matricule', s.matricule, 'student_id', s.id), 'Abonnement Premium Parents'
          into v_subject, v_label
          from public.premium_subscriptions ps join public.students s on s.id = ps.student_id
          where ps.id = v_payment.premium_subscription_id;
    end if;

    if v_subject is null then
        raise exception 'receipt_not_available';
    end if;

    return jsonb_build_object(
        'payment', to_jsonb(v_payment),
        'establishment', (select jsonb_build_object('name', name, 'code', code, 'address', address) from public.establishments where id = v_payment.establishment_id),
        'student', v_subject,
        'label', v_label
    );
end;
$$;
grant execute on function public.payment_receipt(uuid) to authenticated;

create or replace function public.premium_checkout_history(p_student_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not exists (
        select 1 from public.premium_subscriptions
        where parent_id = auth.uid() and student_id = p_student_id and status = 'active'
    ) then
        raise exception 'premium_required';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'session_date', ases.session_date, 'period_label', ases.period_label,
            'subject_name', sub.name, 'status', ar.status, 'checkout_at', ar.checkout_at
        ) order by ases.session_date desc), '[]'::jsonb)
        from public.attendance_records ar
        join public.attendance_sessions ases on ases.id = ar.session_id
        join public.class_subjects cs on cs.id = ases.class_subject_id
        join public.subjects sub on sub.id = cs.subject_id
        where ar.student_id = p_student_id and ar.checkout_at is not null
        limit 30
    );
end;
$$;
grant execute on function public.premium_checkout_history(uuid) to authenticated;
