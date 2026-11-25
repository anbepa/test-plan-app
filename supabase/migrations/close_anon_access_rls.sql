-- Cierra accesos abiertos detectados el 2026-11-25 con la clave publishable (anon).
--
-- 1) serenity_report_results: la política "service role full access" está
--    definida para el rol public con USING (true), así que cualquiera (anon o
--    cualquier usuario autenticado) podía leer, modificar y borrar todas las
--    filas. El service role ya ignora RLS, por lo que la política sobra.
-- 2) test_plan_risk_strategies: políticas para anon (lectura y escritura) y
--    para authenticated con USING (true), que anulan las políticas por dueño
--    (risk_*_owner). Se quitan y quedan solo las de dueño.
-- 3) Vistas de resumen: se crean con el dueño (postgres), así que ignoran RLS
--    de test_plans/user_stories/test_cases. Con security_invoker respetan
--    las políticas del usuario que consulta.

drop policy if exists "service role full access on serenity_report_results" on public.serenity_report_results;

drop policy if exists "Allow anon read risk strategies" on public.test_plan_risk_strategies;
drop policy if exists "Allow anon write risk strategies" on public.test_plan_risk_strategies;
drop policy if exists "Allow authenticated read risk strategies" on public.test_plan_risk_strategies;
drop policy if exists "Allow authenticated write risk strategies" on public.test_plan_risk_strategies;

alter view if exists public.v_test_plan_summary set (security_invoker = on);
alter view if exists public.test_plans_summary set (security_invoker = on);
alter view if exists public.test_plan_summaries set (security_invoker = on);

revoke all on public.v_test_plan_summary from anon;
revoke all on public.test_plans_summary from anon;
revoke all on public.test_plan_summaries from anon;
