-- Índices para claves foráneas que no tenían uno (detectado el 2026-11-25).
-- Sin índice, borrar o actualizar la fila padre obliga a recorrer toda la tabla hija.
create index if not exists idx_test_scenario_steps_scenario_id on public.test_scenario_steps (scenario_id);
create index if not exists idx_report_images_report_id on public.report_images (report_id);
create index if not exists idx_report_images_step_id on public.report_images (step_id);
create index if not exists idx_test_plan_risk_strategies_user_id on public.test_plan_risk_strategies (user_id);
create index if not exists idx_refinements_report_id on public.refinements (report_id);
create index if not exists idx_evidence_hus_user_id on public.evidence_hus (user_id);
