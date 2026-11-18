-- ============================================================================
-- Índice de "líneas de interés" del código de los repos del aplicativo (GitHub).
-- Lo usa search_app del agente de código en vez de la búsqueda de código de GitHub.
-- Esquema propio (code_index), no expuesto en la API: solo el backend (service
-- role) lo lee y escribe a través de las funciones public.code_index_*.
-- No guarda archivos completos: solo líneas clasificadas (definición, escritura,
-- lectura, endpoint, constante) sin secretos y con valores sensibles enmascarados.
-- Borrar todo: DROP SCHEMA code_index CASCADE + las funciones public.code_index_*.
-- ============================================================================
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE SCHEMA IF NOT EXISTS code_index;
REVOKE ALL ON SCHEMA code_index FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA code_index TO service_role;

CREATE TABLE IF NOT EXISTS code_index.repos (
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  branch TEXT NOT NULL,
  head_sha TEXT,
  lines INTEGER NOT NULL DEFAULT 0,
  indexed_at TIMESTAMPTZ,
  PRIMARY KEY (owner, repo)
);

CREATE TABLE IF NOT EXISTS code_index.lines (
  id BIGSERIAL PRIMARY KEY,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('def', 'write', 'read', 'endpoint', 'const')),
  object TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  layer TEXT NOT NULL DEFAULT '',
  is_test BOOLEAN NOT NULL DEFAULT false,
  historic BOOLEAN NOT NULL DEFAULT false,
  run_id TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS code_index_lines_repo ON code_index.lines (owner, repo, run_id);
CREATE INDEX IF NOT EXISTS code_index_lines_text_trgm ON code_index.lines USING gin (text extensions.gin_trgm_ops);

REVOKE ALL ON ALL TABLES IN SCHEMA code_index FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA code_index TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA code_index TO service_role;

-- Inserta un lote de líneas de una corrida de indexación.
CREATE OR REPLACE FUNCTION public.code_index_insert_lines(p_owner TEXT, p_repo TEXT, p_run_id TEXT, p_lines JSONB)
RETURNS INTEGER LANGUAGE sql SET search_path = '' AS $$
  WITH rows AS (
    INSERT INTO code_index.lines (owner, repo, path, line, kind, object, text, layer, is_test, historic, run_id)
    SELECT p_owner, p_repo, l->>'path', (l->>'line')::int, l->>'kind', coalesce(l->>'object', ''), l->>'text',
           coalesce(l->>'layer', ''), coalesce((l->>'is_test')::boolean, false), coalesce((l->>'historic')::boolean, false), p_run_id
    FROM jsonb_array_elements(p_lines) AS l
    RETURNING 1
  )
  SELECT count(*)::int FROM rows;
$$;

-- Cierra la corrida: borra las líneas de corridas anteriores del repo y registra el commit indexado.
CREATE OR REPLACE FUNCTION public.code_index_finish_repo(p_owner TEXT, p_repo TEXT, p_branch TEXT, p_run_id TEXT, p_head_sha TEXT, p_lines INTEGER)
RETURNS VOID LANGUAGE sql SET search_path = '' AS $$
  DELETE FROM code_index.lines WHERE owner = p_owner AND repo = p_repo AND run_id <> p_run_id;
  INSERT INTO code_index.repos (owner, repo, branch, head_sha, lines, indexed_at)
  VALUES (p_owner, p_repo, p_branch, p_head_sha, p_lines, now())
  ON CONFLICT (owner, repo) DO UPDATE SET branch = EXCLUDED.branch, head_sha = EXCLUDED.head_sha, lines = EXCLUDED.lines, indexed_at = now();
$$;

-- Repos indexados de un aplicativo (prefijos del nombre; vacío = todos).
CREATE OR REPLACE FUNCTION public.code_index_status(p_owner TEXT, p_prefixes TEXT[])
RETURNS TABLE (repo TEXT, branch TEXT, head_sha TEXT, lines INTEGER, indexed_at TIMESTAMPTZ)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT r.repo, r.branch, r.head_sha, r.lines, r.indexed_at
  FROM code_index.repos r
  WHERE r.owner = p_owner
    AND (coalesce(cardinality(p_prefixes), 0) = 0
         OR lower(r.repo) LIKE ANY (SELECT replace(lower(p), '_', '\_') || '%' FROM unnest(p_prefixes) AS p))
  ORDER BY r.repo;
$$;

-- Líneas que contienen el término en los repos permitidos. Orden: vigentes antes que migraciones
-- viejas, definición > escritura > lectura > endpoint > constante, código productivo antes que pruebas.
CREATE OR REPLACE FUNCTION public.code_index_search(p_owner TEXT, p_repos TEXT[], p_term TEXT, p_limit INTEGER)
RETURNS TABLE (repo TEXT, branch TEXT, path TEXT, line INTEGER, kind TEXT, layer TEXT, text TEXT)
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT l.repo, r.branch, l.path, l.line, l.kind, l.layer, l.text
  FROM code_index.lines l
  JOIN code_index.repos r ON r.owner = l.owner AND r.repo = l.repo
  WHERE l.owner = p_owner
    AND l.repo = ANY (p_repos)
    AND l.text ILIKE '%' || replace(replace(replace(p_term, '\', '\\'), '%', '\%'), '_', '\_') || '%'
  ORDER BY l.historic, CASE l.kind WHEN 'def' THEN 0 WHEN 'write' THEN 1 WHEN 'read' THEN 2 WHEN 'endpoint' THEN 3 ELSE 4 END,
           l.is_test, length(l.path), l.line
  LIMIT greatest(1, least(coalesce(p_limit, 60), 200));
$$;

REVOKE EXECUTE ON FUNCTION public.code_index_insert_lines(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_finish_repo(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_status(TEXT, TEXT[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.code_index_search(TEXT, TEXT[], TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.code_index_insert_lines(TEXT, TEXT, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_finish_repo(TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_status(TEXT, TEXT[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.code_index_search(TEXT, TEXT[], TEXT, INTEGER) TO service_role;
