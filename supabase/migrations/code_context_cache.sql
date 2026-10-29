-- ============================================================================
-- Code Context Cache (Agente de exploración de código — Azure Repos)
--
-- Guarda, por usuario, el "Contexto técnico" que el agente generó para una
-- combinación repositorio + commit + alcance + HU. Si la rama no cambió
-- (mismo commit) y la HU es la misma, el contexto se reutiliza al instante.
--
-- SEGURO PARA PRODUCCIÓN:
--   * Solo CREA objetos nuevos (IF NOT EXISTS). No altera ni borra tablas,
--     columnas, funciones ni datos existentes.
--   * Se puede ejecutar más de una vez sin efectos secundarios.
--   * Es OPCIONAL: si no se ejecuta, la app funciona igual (solo sin caché).
--
-- Rollback (si se quisiera retirar): DROP TABLE IF EXISTS public.code_context_cache;
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.code_context_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- sha256(repositoryId + commitId + scopePath + mode + descripción + criterios)
  cache_key TEXT NOT NULL,
  repository_id TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  commit_id TEXT NOT NULL,
  context TEXT NOT NULL,
  files_reviewed JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, cache_key)
);

CREATE INDEX IF NOT EXISTS idx_code_context_cache_user_created
  ON public.code_context_cache (user_id, created_at DESC);

-- ----------------------------------------------------------------------------
-- RLS: cada usuario solo ve/modifica su propia caché.
-- (El backend usa service role y además filtra explícitamente por user_id.)
-- ----------------------------------------------------------------------------
ALTER TABLE public.code_context_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios ven solo su propia cache de contexto de codigo"
  ON public.code_context_cache;

CREATE POLICY "Usuarios ven solo su propia cache de contexto de codigo"
  ON public.code_context_cache
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
