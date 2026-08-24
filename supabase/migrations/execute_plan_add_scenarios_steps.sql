-- ============================================================================
-- Migración: Soporte para agregar Escenarios y Pasos en /viewer/execute-plan
-- ----------------------------------------------------------------------------
-- OBJETIVO:
--   Garantizar persistencia en BD al:
--     (a) agregar un escenario (test case) en blanco con pasos
--     (b) agregar pasos nuevos a escenarios ya creados
--
-- CONTEXTO DE ARQUITECTURA (importante):
--   - La EJECUCIÓN (Test Run) completa —casos + pasos + evidencias— se guarda
--     como JSONB en la columna `plan_executions.execution_data`. Por lo tanto,
--     agregar escenarios/pasos DESDE execute-plan YA persiste automáticamente
--     sin cambios de esquema (ver execution-storage-supabase.service.ts).
--   - El "blueprint" original vive en las tablas relacionales:
--         user_stories -> test_cases -> test_case_steps
--     Estas tablas YA tienen todas las columnas necesarias.
--
--   Esta migración NO crea tablas nuevas ni cambia tipos. Solo REFUERZA de forma
--   IDEMPOTENTE y NO DESTRUCTIVA: defaults, índices y columnas opcionales que
--   pudieran faltar en algún entorno. Es seguro correrla en PRODUCCIÓN.
--
-- GARANTÍAS DE SEGURIDAD:
--   * NO contiene DROP TABLE / DROP COLUMN / TRUNCATE / DELETE / UPDATE de datos.
--   * NO usa ALTER COLUMN ... TYPE (no reescribe datos existentes).
--   * Todo es "IF NOT EXISTS" / condicional -> re-ejecutable sin efectos.
--   * Envuelto en una transacción: si algo falla, se revierte todo.
--
-- CÓMO EJECUTAR:
--   1. HAZ UN BACKUP / SNAPSHOT antes (Supabase: Database > Backups).
--   2. Ejecuta primero el bloque de VERIFICACIÓN (al final, comentado) para ver
--      el estado actual sin modificar nada.
--   3. Corre este archivo completo en el SQL Editor de Supabase.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) test_cases: asegurar columnas opcionales usadas por execute-plan
--    (title, preconditions, expected_results, position, timestamps)
--    Solo se agregan si faltan; NO se modifican las existentes.
-- ----------------------------------------------------------------------------
ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS preconditions    text,
  ADD COLUMN IF NOT EXISTS expected_results text,
  ADD COLUMN IF NOT EXISTS position         integer,
  ADD COLUMN IF NOT EXISTS created_at       timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at       timestamptz DEFAULT now();

-- Default de posición para nuevos escenarios en blanco (no toca filas existentes)
ALTER TABLE public.test_cases
  ALTER COLUMN position SET DEFAULT 0;

-- Índice para ordenar/insertar escenarios por HU de forma eficiente
CREATE INDEX IF NOT EXISTS idx_test_cases_user_story_position
  ON public.test_cases (user_story_id, position);

-- ----------------------------------------------------------------------------
-- 2) test_case_steps: asegurar columnas usadas para agregar pasos
--    (step_number, action, created_at)
-- ----------------------------------------------------------------------------
ALTER TABLE public.test_case_steps
  ADD COLUMN IF NOT EXISTS step_number integer,
  ADD COLUMN IF NOT EXISTS action      text,
  ADD COLUMN IF NOT EXISTS created_at  timestamptz DEFAULT now();

-- Default de step_number para pasos nuevos (no toca filas existentes)
ALTER TABLE public.test_case_steps
  ALTER COLUMN step_number SET DEFAULT 1;

-- Índice para ordenar/insertar pasos por escenario de forma eficiente
CREATE INDEX IF NOT EXISTS idx_test_case_steps_case_number
  ON public.test_case_steps (test_case_id, step_number);

-- ----------------------------------------------------------------------------
-- 3) plan_executions: asegurar la estructura JSONB donde vive el snapshot
--    de la ejecución (casos + pasos agregados en execute-plan).
--    Solo se aseguran columnas si faltan; NO se altera execution_data.
-- ----------------------------------------------------------------------------
ALTER TABLE public.plan_executions
  ADD COLUMN IF NOT EXISTS execution_data jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at     timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at     timestamptz DEFAULT now();

-- Índice para buscar ejecuciones por usuario + HU (consulta getExecutionsByHU)
CREATE INDEX IF NOT EXISTS idx_plan_executions_user_hu
  ON public.plan_executions (user_id, hu_id);

-- Índice GIN opcional para consultas dentro del JSONB (búsquedas por caso/paso)
CREATE INDEX IF NOT EXISTS idx_plan_executions_data_gin
  ON public.plan_executions USING gin (execution_data);

-- ----------------------------------------------------------------------------
-- 4) Trigger updated_at para plan_executions (idempotente).
--    Mantiene updated_at fresco al guardar escenarios/pasos nuevos.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.plan_executions_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_plan_executions_updated_at ON public.plan_executions;
CREATE TRIGGER trg_plan_executions_updated_at
  BEFORE UPDATE ON public.plan_executions
  FOR EACH ROW
  EXECUTE FUNCTION public.plan_executions_set_updated_at();

COMMIT;

-- ============================================================================
-- BLOQUE DE VERIFICACIÓN (solo lectura). Descoméntalo para inspeccionar el
-- estado ANTES o DESPUÉS. No modifica datos.
-- ============================================================================
-- SELECT table_name, column_name, data_type, column_default, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('test_cases', 'test_case_steps', 'plan_executions')
-- ORDER BY table_name, ordinal_position;
--
-- SELECT indexname, indexdef
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename IN ('test_cases', 'test_case_steps', 'plan_executions')
-- ORDER BY tablename, indexname;

-- ============================================================================
-- ROLLBACK MANUAL (solo si necesitas revertir los índices/trigger agregados).
-- NO revierte columnas para no arriesgar datos. Ejecutar manualmente si aplica:
-- ============================================================================
-- DROP TRIGGER IF EXISTS trg_plan_executions_updated_at ON public.plan_executions;
-- DROP FUNCTION IF EXISTS public.plan_executions_set_updated_at();
-- DROP INDEX IF EXISTS public.idx_test_cases_user_story_position;
-- DROP INDEX IF EXISTS public.idx_test_case_steps_case_number;
-- DROP INDEX IF EXISTS public.idx_plan_executions_user_hu;
-- DROP INDEX IF EXISTS public.idx_plan_executions_data_gin;
