-- =============================================================
-- SCRIPT: Eliminar tablas no implementadas en el código Angular
-- Fecha : 2026-04-03
-- Autor : Auto-generado
-- =============================================================
-- ANTES DE EJECUTAR:
--   1. Realiza un backup / snapshot de la base de datos.
--   2. Revisa que ningún proyecto externo dependa de estas tablas.
--   3. Ejecuta en un ambiente de staging primero.
-- =============================================================

-- ---------------------------------------------------------------
-- 1. test_evidences
--    Motivo: Ninguna referencia en src/**/*.ts.
--    Depende de: test_execution_steps (FK fk_test_step_evidence)
--    Se debe eliminar ANTES que test_execution_steps.
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS public.test_evidences CASCADE;

-- ---------------------------------------------------------------
-- 2. test_execution_steps
--    Motivo: Ninguna referencia en src/**/*.ts.
--    Era referenciada por: test_evidences (ya eliminada arriba).
--    Tenía FKs hacia: test_plans, user_stories, test_cases
--    (todas tablas activas, no se ven afectadas).
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS public.test_execution_steps CASCADE;

-- ---------------------------------------------------------------
-- 3. images
--    Motivo: La columna image_base64 se SELECCIONA en las queries
--    de lectura, pero nunca se INSERT/UPDATE desde el código.
--    En test-plan-mapper.service.ts siempre se envía images: []
--    al guardar, por lo que la tabla está vacía en producción.
--    FK: images.user_story_id → user_stories(id)
-- ---------------------------------------------------------------
DROP TABLE IF EXISTS public.images CASCADE;


-- =============================================================
-- TABLA EN ZONA GRIS — REVISAR ANTES DE ELIMINAR
-- =============================================================
-- perfiles
--   Motivo para conservar: aunque el código Angular NO la consulta
--   directamente, Supabase la popula automáticamente mediante el
--   trigger `trg_auto_create_perfil` (definido en
--   scripts/setup-auth-multitenant.sql) cada vez que se registra
--   un usuario en auth.users.
--   También es usada por las políticas RLS para validar el rol
--   ('master' / 'user').
--
--   Si se confirma que el trigger y las políticas RLS han sido
--   reemplazados o eliminados, descomenta las líneas siguientes:
--
-- DROP POLICY IF EXISTS "perfiles_select_own"  ON public.perfiles;
-- DROP POLICY IF EXISTS "perfiles_update_own"  ON public.perfiles;
-- DROP TABLE  IF EXISTS public.perfiles CASCADE;
-- =============================================================


-- ---------------------------------------------------------------
-- Verificación posterior (ejecutar para confirmar que no existen)
-- ---------------------------------------------------------------
SELECT table_name
FROM   information_schema.tables
WHERE  table_schema = 'public'
  AND  table_name IN ('test_evidences', 'test_execution_steps', 'images')
ORDER  BY table_name;
-- Resultado esperado: 0 filas
