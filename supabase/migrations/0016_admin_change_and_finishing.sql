-- ============================================================================
-- SCHOOLAR — ÉTAPE 16 / N — Changement d'administrateur d'établissement
-- (flux laissé en suspens à l'étape 3) + classement des épreuves concours
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - Le nouveau titulaire définit son mot de passe à la CONFIRMATION par
--     email (avant la validation finale par l'admin national) — le PHP
--     stockait alors un hash de mot de passe "en attente" dans
--     admin_change_requests. Avec Supabase Auth, il n'existe pas
--     d'équivalent "hash en attente" : le compte auth.users est donc créé
--     dès la confirmation (email_confirm ok, mais sans profil applicatif
--     encore), et seul son id est mémorisé (new_admin_auth_user_id). La
--     validation par l'admin national crée alors le PROFIL (établissement +
--     rôle), ce qui active réellement l'accès — équivalent fonctionnel
--     exact du "compte pas encore utilisable tant que non validé".
-- ============================================================================

alter table public.admin_change_requests add column new_admin_auth_user_id uuid;

-- ----------------------------------------------------------------------------
-- admin_change_status() — remplace AdminChangeController::status() (public)
-- ----------------------------------------------------------------------------
create or replace function public.admin_change_status(p_token text)
returns jsonb
language sql stable security definer set search_path = public
as $$
    select case when acr.id is null then jsonb_build_object('error', 'invalid_confirmation_link') else jsonb_build_object(
        'request', jsonb_build_object(
            'new_admin_first_name', acr.new_admin_first_name, 'new_admin_last_name', acr.new_admin_last_name,
            'new_admin_email', acr.new_admin_email, 'status', acr.status, 'establishment_name', e.name
        )
    ) end
    from (select 1) dummy
    left join public.admin_change_requests acr on acr.validation_token = p_token
    left join public.establishments e on e.id = acr.establishment_id;
$$;
grant execute on function public.admin_change_status(text) to anon, authenticated;

-- ----------------------------------------------------------------------------
-- exam_ranking() — remplace ExamController::ranking()
-- ----------------------------------------------------------------------------
create or replace function public.exam_ranking(p_exam_paper_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_exam record;
begin
    select establishment_id, subject_label, level into v_exam from public.exam_papers where id = p_exam_paper_id;
    if v_exam.establishment_id is null or v_exam.establishment_id is distinct from public.my_establishment_id() then
        raise exception 'exam_not_found';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'first_name', s.first_name, 'last_name', s.last_name, 'score', ea.score, 'max_score', ea.max_score,
            'rank', rank() over (order by ea.score desc)
        ) order by ea.score desc), '[]'::jsonb)
        from public.exam_attempts ea
        join public.exam_papers ep on ep.id = ea.exam_paper_id
        join public.students s on s.id = ea.student_id
        where ep.establishment_id = v_exam.establishment_id and ep.subject_label = v_exam.subject_label
          and ep.level = v_exam.level and ea.status = 'graded'
        limit 50
    );
end;
$$;
grant execute on function public.exam_ranking(uuid) to authenticated;
