-- ============================================================================
-- SCHOOLAR — ÉTAPE 14 / N — Tableau de bord national
-- ============================================================================
-- CHOIX D'ARCHITECTURE :
--   - latitude/longitude existent déjà sur `establishments` depuis l'étape 1
--     (anticipées dès les fondations) — rien à ajouter ici.
--   - Toutes les requêtes de ce contrôleur sont réservées à l'admin national
--     et agrègent des données de TOUS les établissements. Or la RLS de
--     `students`/`grades`/`classes`/etc. (étapes 5-6) filtre sur
--     `establishment_id = my_establishment_id()`, qui vaut NULL pour l'admin
--     national (il n'appartient à aucun établissement) — ces policies
--     l'excluent donc de fait. Plutôt que de retoucher une dizaine de
--     policies déjà en place dans les migrations précédentes, ces
--     statistiques sont exposées via des fonctions SECURITY DEFINER dédiées
--     (même principe qu'à l'étape 8 pour timetable_history) : chacune
--     vérifie elle-même is_national_admin() puis lit sans restriction.
--   - Le CTE VALIDATED_AVERAGES_CTE, dupliqué tel quel dans 3 requêtes PHP
--     (faute de vue réutilisable dans cette architecture), devient une vraie
--     VIEW PostgreSQL (student_validated_averages) — plus de duplication de
--     SQL, une seule définition.
--   - setCoordinates() n'a besoin d'AUCUNE fonction : la policy
--     establishments_update (étape 1) autorise déjà is_national_admin() à
--     modifier n'importe quel établissement, latitude/longitude inclus —
--     un simple update PostgREST suffit.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Vue : moyenne pondérée par élève, sur les séquences VALIDÉES de l'année
-- scolaire en cours de son établissement (remplace VALIDATED_AVERAGES_CTE).
-- ----------------------------------------------------------------------------
create or replace view public.student_validated_averages as
select
    g.student_id, s.establishment_id, e.region, e.department,
    sum(g.score * cs.coefficient) / nullif(sum(cs.coefficient), 0) as average
from public.grades g
join public.class_subjects cs on cs.id = g.class_subject_id
join public.sequences seq on seq.id = g.sequence_id
join public.class_sequence_validations csv on csv.class_id = cs.class_id and csv.sequence_id = seq.id and csv.status = 'validated'
join public.students s on s.id = g.student_id and s.status = 'active'
join public.establishments e on e.id = s.establishment_id and e.status = 'active'
join public.school_years sy on sy.id = seq.school_year_id and sy.is_current
where g.score is not null
group by g.student_id, s.establishment_id, e.region, e.department;

-- ----------------------------------------------------------------------------
-- national_stats_overview() — remplace NationalStatsController::overview()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_overview()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return jsonb_build_object(
        'establishments_by_status', (
            select coalesce(jsonb_agg(jsonb_build_object('status', status, 'n', n)), '[]'::jsonb)
            from (select status, count(*) as n from public.establishments group by status) t
        ),
        'establishments_total', (select count(*) from public.establishments),
        'students_total', (
            select count(*) from public.students s join public.establishments e on e.id = s.establishment_id
            where s.status = 'active' and e.status = 'active'
        ),
        'teachers_total', (
            select count(*) from public.profiles p
            join public.roles r on r.id = p.role_id
            join public.establishments e on e.id = p.establishment_id
            where r.code in ('enseignant', 'professeur_principal') and p.status = 'active' and e.status = 'active'
        ),
        'success_rate', (
            select jsonb_build_object(
                'students_with_grades', count(*),
                'students_passing', sum(case when average >= 10 then 1 else 0 end),
                'success_rate', round(100.0 * sum(case when average >= 10 then 1 else 0 end) / nullif(count(*), 0), 1)
            )
            from public.student_validated_averages
        )
    );
end;
$$;
grant execute on function public.national_stats_overview() to authenticated;

-- ----------------------------------------------------------------------------
-- national_stats_by_region() — remplace NationalStatsController::byRegion()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_by_region()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'region', reg.region, 'establishments', reg.establishments, 'students', reg.students,
            'teachers', reg.teachers, 'success_rate', sr.success_rate
        ) order by reg.region), '[]'::jsonb)
        from (
            select e.region,
                   count(distinct e.id) as establishments,
                   count(distinct s.id) filter (where s.status = 'active') as students,
                   count(distinct p.id) filter (where p.status = 'active') as teachers
            from public.establishments e
            left join public.students s on s.establishment_id = e.id
            left join public.profiles p on p.establishment_id = e.id and p.role_id in (select id from public.roles where code in ('enseignant', 'professeur_principal'))
            where e.status = 'active'
            group by e.region
        ) reg
        left join (
            select region, round(100.0 * sum(case when average >= 10 then 1 else 0 end) / nullif(count(*), 0), 1) as success_rate
            from public.student_validated_averages group by region
        ) sr on sr.region = reg.region
    );
end;
$$;
grant execute on function public.national_stats_by_region() to authenticated;

-- ----------------------------------------------------------------------------
-- national_stats_by_department() — remplace NationalStatsController::byDepartment()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_by_department(p_region text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'region', dep.region, 'department', dep.department, 'establishments', dep.establishments,
            'students', dep.students, 'teachers', dep.teachers, 'success_rate', sr.success_rate
        ) order by dep.region, dep.department), '[]'::jsonb)
        from (
            select e.region, e.department,
                   count(distinct e.id) as establishments,
                   count(distinct s.id) filter (where s.status = 'active') as students,
                   count(distinct p.id) filter (where p.status = 'active') as teachers
            from public.establishments e
            left join public.students s on s.establishment_id = e.id
            left join public.profiles p on p.establishment_id = e.id and p.role_id in (select id from public.roles where code in ('enseignant', 'professeur_principal'))
            where e.status = 'active' and (p_region is null or e.region = p_region)
            group by e.region, e.department
        ) dep
        left join (
            select region, department, round(100.0 * sum(case when average >= 10 then 1 else 0 end) / nullif(count(*), 0), 1) as success_rate
            from public.student_validated_averages
            where p_region is null or region = p_region
            group by region, department
        ) sr on sr.region = dep.region and sr.department = dep.department
    );
end;
$$;
grant execute on function public.national_stats_by_department(text) to authenticated;

-- ----------------------------------------------------------------------------
-- national_stats_map() — remplace NationalStatsController::map()
-- ----------------------------------------------------------------------------
create or replace function public.national_stats_map()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.is_national_admin() then
        raise exception 'forbidden';
    end if;

    return (
        select coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'code', e.code, 'name', e.name, 'establishment_type', e.establishment_type,
            'region', e.region, 'department', e.department, 'latitude', e.latitude, 'longitude', e.longitude,
            'student_count', (select count(*) from public.students s where s.establishment_id = e.id and s.status = 'active')
        ) order by e.name), '[]'::jsonb)
        from public.establishments e
        where e.status = 'active' and e.latitude is not null and e.longitude is not null
    );
end;
$$;
grant execute on function public.national_stats_map() to authenticated;
