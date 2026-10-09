-- ============================================================================
-- SCHOOLAR — ÉTAPE 10 / N — Communication : messagerie, annonces, notifications
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Le "centre de notifications in-app" (section 24) était déjà, dans le
--     PHP d'origine, une alternative maison au push/SMS faute de fournisseur
--     tiers disponible. Sur Supabase, on obtient l'équivalent d'un vrai push
--     GRATUITEMENT via Realtime : il suffit d'ajouter `messages` et
--     `notifications` à la publication `supabase_realtime` (fait en fin de
--     migration) pour que le frontend reçoive les nouveaux messages/
--     notifications instantanément par abonnement, sans purchase ni service
--     tiers, sans code serveur supplémentaire.
--   - list()/messages() (MessagingController) utilisaient des sous-requêtes
--     scalaires corrélées PARCE QUE le LATERAL de MySQL 8 n'est pas supporté
--     par MariaDB — cette contrainte n'existe plus : list_my_conversations()
--     utilise LATERAL nativement, comme l'aurait fait la version PostgreSQL
--     originale avant sa conversion vers MySQL.
--   - startOrGet() (recherche-ou-création transactionnelle d'une conversation
--     directe) devient start_or_get_conversation(), SECURITY DEFINER : elle
--     doit pouvoir insérer une ligne conversation_participants pour LE
--     DESTINATAIRE (pas seulement l'appelant), ce qu'aucune policy RLS
--     raisonnable n'autoriserait pour un simple insert direct.
--   - L'envoi d'un message reste une Edge Function (messaging-send) : email +
--     ligne de notification pour l'autre participant à chaque message,
--     comme le PHP d'origine — mais rien n'empêche d'alléger ça plus tard en
--     s'appuyant davantage sur Realtime plutôt que sur l'email systématique.
-- ============================================================================

-- Helper manquant jusqu'ici : le "scope" du rôle (family vs establishment vs
-- national), utilisé pour distinguer vue parent / vue personnel des annonces.
create or replace function public.my_role_scope()
returns text
language sql stable security definer set search_path = public
as $$
  select r.scope from public.profiles p join public.roles r on r.id = p.role_id where p.id = auth.uid();
$$;

-- ----------------------------------------------------------------------------
-- 1. Messagerie interne
-- ----------------------------------------------------------------------------
create table public.conversations (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    type                  varchar(20) not null default 'direct' check (type in ('direct','group')),
    title                 varchar(150),
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now()
);
create index idx_conversations_establishment on public.conversations(establishment_id);

create table public.conversation_participants (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references public.conversations(id) on delete cascade,
    user_id          uuid not null references public.profiles(id) on delete cascade,
    last_read_at     timestamptz,
    joined_at        timestamptz not null default now(),
    unique (conversation_id, user_id)
);
create index idx_conversation_participants_user on public.conversation_participants(user_id);

create table public.messages (
    id               uuid primary key default gen_random_uuid(),
    conversation_id  uuid not null references public.conversations(id) on delete cascade,
    sender_id        uuid not null references public.profiles(id),
    body             varchar(2000) not null,
    created_at       timestamptz not null default now()
);
create index idx_messages_conversation on public.messages(conversation_id, created_at);

alter table public.conversations enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages enable row level security;

create policy conversations_select on public.conversations for select to authenticated
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = conversations.id and cp.user_id = auth.uid()));

-- Pas de policy INSERT directe : la création passe exclusivement par
-- start_or_get_conversation() (SECURITY DEFINER, ci-dessous).

create policy conversation_participants_select on public.conversation_participants for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.conversation_participants cp2 where cp2.conversation_id = conversation_participants.conversation_id and cp2.user_id = auth.uid())
  );

create policy conversation_participants_update_self on public.conversation_participants for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_select on public.messages for select to authenticated
  using (exists (select 1 from public.conversation_participants cp where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid()));

create policy messages_insert on public.messages for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (select 1 from public.conversation_participants cp where cp.conversation_id = messages.conversation_id and cp.user_id = auth.uid())
  );
-- Pas d'update/delete sur les messages (comme dans le PHP d'origine).

-- ----------------------------------------------------------------------------
-- start_or_get_conversation() — remplace MessagingController::startOrGet()
-- ----------------------------------------------------------------------------
create or replace function public.start_or_get_conversation(p_recipient_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    values (v_establishment_id, 'direct', v_me)
    returning id into v_new_id;

    insert into public.conversation_participants (conversation_id, user_id) values (v_new_id, v_me), (v_new_id, p_recipient_id);

    return jsonb_build_object('conversation_id', v_new_id, 'created', true);
end;
$$;
grant execute on function public.start_or_get_conversation(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- list_my_conversations() — remplace MessagingController::list(). LATERAL
-- natif (plus de sous-requêtes corrélées répétées trois fois).
-- ----------------------------------------------------------------------------
create or replace function public.list_my_conversations()
returns jsonb
language sql stable security invoker set search_path = public
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'created_at', c.created_at,
        'other_user_id', other.id, 'other_first_name', other.first_name, 'other_last_name', other.last_name,
        'other_role_code', r.code, 'other_role_label_fr', r.label_fr, 'other_role_label_en', r.label_en,
        'last_message_body', lm.body, 'last_message_at', lm.created_at, 'last_message_sender_id', lm.sender_id,
        'unread_count', (
            select count(*) from public.messages m
            where m.conversation_id = c.id and m.sender_id <> auth.uid()
              and m.created_at > coalesce(cp.last_read_at, 'epoch'::timestamptz)
        )
    ) order by coalesce(lm.created_at, c.created_at) desc), '[]'::jsonb)
    from public.conversation_participants cp
    join public.conversations c on c.id = cp.conversation_id
    join public.conversation_participants other_cp on other_cp.conversation_id = c.id and other_cp.user_id <> auth.uid()
    join public.profiles other on other.id = other_cp.user_id
    join public.roles r on r.id = other.role_id
    left join lateral (
        select body, created_at, sender_id from public.messages where conversation_id = c.id order by created_at desc limit 1
    ) lm on true
    where cp.user_id = auth.uid();
$$;
grant execute on function public.list_my_conversations() to authenticated;

-- ----------------------------------------------------------------------------
-- open_conversation() — remplace MessagingController::messages() (lecture +
-- marquage "lu" en un seul aller-retour)
-- ----------------------------------------------------------------------------
create or replace function public.open_conversation(p_conversation_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
    v_messages jsonb;
begin
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', m.id, 'body', m.body, 'created_at', m.created_at, 'sender_id', m.sender_id,
        'sender_first_name', p.first_name, 'sender_last_name', p.last_name
    ) order by m.created_at asc), '[]'::jsonb)
    into v_messages
    from public.messages m join public.profiles p on p.id = m.sender_id
    where m.conversation_id = p_conversation_id;

    update public.conversation_participants set last_read_at = now()
      where conversation_id = p_conversation_id and user_id = auth.uid();

    return jsonb_build_object('messages', v_messages);
end;
$$;
grant execute on function public.open_conversation(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Annonces
-- ----------------------------------------------------------------------------
create table public.announcements (
    id                    uuid primary key default gen_random_uuid(),
    establishment_id      uuid not null references public.establishments(id) on delete cascade,
    title                 varchar(255) not null,
    body                  varchar(2000) not null,
    audience              varchar(30) not null check (audience in ('all_establishment','all_staff','all_parents','class')),
    class_id              uuid references public.classes(id) on delete cascade,
    created_by_profile_id uuid references public.profiles(id),
    created_at            timestamptz not null default now()
);
create index idx_announcements_establishment on public.announcements(establishment_id, created_at desc);

alter table public.announcements enable row level security;

-- Lecture : reproduit la vue parent / vue personnel d'AnnouncementController::list().
create policy announcements_select on public.announcements for select to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (
      audience = 'all_establishment'
      or (public.my_role_scope() = 'family' and audience = 'all_parents')
      or (public.my_role_scope() <> 'family' and audience = 'all_staff')
      or (audience = 'class' and (
            (public.my_role_scope() = 'family' and class_id in (
                select s.class_id from public.student_parents sp join public.students s on s.id = sp.student_id
                where sp.parent_id = auth.uid()
            ))
            or (public.my_role_scope() <> 'family' and class_id in (
                select id from public.classes where homeroom_teacher_id = auth.uid()
                union
                select class_id from public.class_subjects where teacher_id = auth.uid()
            ))
          ))
    )
  );

-- Création : administration = toute audience ; le reste = seulement 'class',
-- et seulement leur propre classe.
create policy announcements_insert on public.announcements for insert to authenticated
  with check (
    establishment_id = public.my_establishment_id()
    and (
      public.my_role_code() in ('proviseur','principal','directeur','censeur','surveillant_general','secretaire')
      or (
        audience = 'class'
        and class_id in (
          select id from public.classes where homeroom_teacher_id = auth.uid()
          union
          select class_id from public.class_subjects where teacher_id = auth.uid()
        )
      )
    )
  );

-- Suppression : l'auteur, ou la direction.
create policy announcements_delete on public.announcements for delete to authenticated
  using (
    establishment_id = public.my_establishment_id()
    and (created_by_profile_id = auth.uid() or public.my_role_code() in ('proviseur','principal','directeur'))
  );

-- ----------------------------------------------------------------------------
-- 3. Centre de notifications in-app
-- ----------------------------------------------------------------------------
create table public.notifications (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references public.profiles(id) on delete cascade,
    establishment_id  uuid references public.establishments(id) on delete cascade,
    type              varchar(40) not null,
    title             varchar(255) not null,
    body              varchar(500),
    link              varchar(255),
    read_at           timestamptz,
    created_at        timestamptz not null default now()
);
create index idx_notifications_user on public.notifications(user_id, read_at, created_at desc);

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_mark_read on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
-- Pas de policy INSERT : uniquement créées par les Edge Functions (service_role).

-- ----------------------------------------------------------------------------
-- 4. Realtime — messages et notifications instantanés côté frontend, sans
--    fournisseur tiers ni Edge Function de polling.
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.conversation_participants;
