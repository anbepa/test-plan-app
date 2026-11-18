-- ============================================================================
-- Índice de símbolos del código de los repos del aplicativo (GitHub).
-- Lo usa search_app del agente de código en vez de la búsqueda de código de
-- GitHub (~10 consultas/min). Solo guarda símbolos por archivo (no el código):
-- las líneas se leen de GitHub con el token del usuario.
-- Tablas sin políticas RLS: solo el backend (service role) las lee y escribe.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

CREATE TABLE IF NOT EXISTS public.code_index_repos (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  head_sha TEXT,
  files INTEGER NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ,
  PRIMARY KEY (owner, repo, branch)
);

CREATE TABLE IF NOT EXISTS public.code_index_files (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  path TEXT NOT NULL,
  symbols TEXT NOT NULL,
  run_id TEXT NOT NULL,
  PRIMARY KEY (owner, repo, branch, path)
);

CREATE INDEX IF NOT EXISTS code_index_files_symbols_trgm
  ON public.code_index_files USING gin (symbols extensions.gin_trgm_ops);

ALTER TABLE public.code_index_repos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_index_files ENABLE ROW LEVEL SECURITY;

-- Guarda un lote de archivos de una corrida de indexación.
CREATE OR REPLACE FUNCTION public.code_index_upsert_files(
  p_owner TEXT, p_repo TEXT, p_branch TEXT, p_run_id TEXT, p_files JSONB
) RETURNS INTEGER
LANGUAGE sql
SET search_path = ''
AS $$
  WITH rows AS (
    INSERT INTO public.code_index_files (owner, repo, branch, path, symbols, run_id)
    SELECT p_owner, p_repo, p_branch, f->>'path', f->>'symbols', p_run_id
    FROM jsonb_array_elements(p_files) AS f
    ON CONFLICT (owner, repo, branch, path)
    DO UPDATE SET symbols = EXCLUDED.symbols, run_id = EXCLUDED.run_id
    RETURNING 1
  )
  SELECT count(*)::INTEGER FROM rows;
$$;

-- Cierra la corrida: borra los archivos que ya no existen y registra el commit indexado.
CREATE OR REPLACE FUNCTION public.code_index_finish_run(
  p_owner TEXT, p_repo TEXT, p_branch TEXT, p_run_id TEXT, p_head_sha TEXT, p_files INTEGER, p_is_default BOOLEAN
) RETURNS VOID
LANGUAGE sql
SET search_path = ''
AS $$
  DELETE FROM public.code_index_files
  WHERE owner = p_owner AND repo = p_repo AND branch = p_branch AND run_id <> p_run_id;
  INSERT INTO public.code_index_repos (owner, repo, branch, is_default, head_sha, files, indexed_at)
  VALUES (p_owner, p_repo, p_branch, p_is_default, p_head_sha, p_files, now())
  ON CONFLICT (owner, repo, branch)
  DO UPDATE SET is_default = EXCLUDED.is_default, head_sha = EXCLUDED.head_sha, files = EXCLUDED.files, indexed_at = now();
$$;

-- Repos y ramas indexados de un aplicativo (prefijos de nombre de repo; vacío = todos).
CREATE OR REPLACE FUNCTION public.code_index_status(p_owner TEXT, p_prefixes TEXT[])
RETURNS TABLE (repo TEXT, branch TEXT, is_default BOOLEAN, head_sha TEXT, files INTEGER, indexed_at TIMESTAMPTZ)
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT r.repo, r.branch, r.is_default, r.head_sha, r.files, r.indexed_at
  FROM public.code_index_repos r
  WHERE r.owner = p_owner
    AND (coalesce(cardinality(p_prefixes), 0) = 0
         OR lower(r.repo) LIKE ANY (SELECT lower(p) || '%' FROM unnest(p_prefixes) AS p))
  ORDER BY r.repo, r.is_default DESC, r.branch;
$$;

-- Archivos cuyos símbolos contienen el término. Primero la rama principal y el código productivo.
CREATE OR REPLACE FUNCTION public.code_index_search(p_owner TEXT, p_prefixes TEXT[], p_term TEXT, p_limit INTEGER)
RETURNS TABLE (repo TEXT, branch TEXT, path TEXT)
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT f.repo, f.branch, f.path
  FROM public.code_index_files f
  JOIN public.code_index_repos r ON r.owner = f.owner AND r.repo = f.repo AND r.branch = f.branch
  WHERE f.owner = p_owner
    AND (coalesce(cardinality(p_prefixes), 0) = 0
         OR lower(f.repo) LIKE ANY (SELECT lower(p) || '%' FROM unnest(p_prefixes) AS p))
    AND f.symbols ILIKE '%' || replace(replace(replace(lower(p_term), '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY (f.path ~* '(^|/)(test|tests|__tests__)(/|$)|\.(spec|test)\.|Test\.java$'), r.is_default DESC, length(f.path)
  LIMIT greatest(1, least(coalesce(p_limit, 12), 50));
$$;

REVOKE ALL ON public.code_index_repos, public.code_index_files FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_upsert_files(TEXT, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_finish_run(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_status(TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_search(TEXT, TEXT[], TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.code_index_repos, public.code_index_files TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_upsert_files(TEXT, TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_finish_run(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_status(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_search(TEXT, TEXT[], TEXT, INTEGER) TO service_role;
