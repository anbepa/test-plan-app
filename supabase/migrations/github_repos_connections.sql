-- ============================================================================
-- GitHub Repos Connections (origen del código de la HU)
-- Por usuario: organización/usuario de GitHub donde viven los repositorios,
-- filtro opcional de repos (prefijo del aplicativo) y si GitHub es el origen
-- del código en el generador. El token (PAT) se guarda CIFRADO en Supabase
-- Vault, como en github_models_connections / azure_serenity_connections.
--
-- Convención de secreto en Vault:  GITHUB_REPOS_TOKEN_<user_id>
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.github_repos_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Organización o usuario de GitHub (p. ej. 'cib-bancolombia')
  owner TEXT NOT NULL,
  -- Prefijos de repositorio separados por coma (p. ej. 'NU0139001_SAF'); vacío = todos
  repo_filter TEXT NOT NULL DEFAULT '',
  -- true = el generador usa GitHub (y no Azure Repos) como origen del código
  enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'invalid', 'expired', 'disconnected')),
  token_hint TEXT NOT NULL DEFAULT '',
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id)
);

CREATE OR REPLACE FUNCTION public.github_repos_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_github_repos_connections_updated_at ON public.github_repos_connections;
CREATE TRIGGER trg_github_repos_connections_updated_at
  BEFORE UPDATE ON public.github_repos_connections
  FOR EACH ROW EXECUTE FUNCTION public.github_repos_set_updated_at();

ALTER TABLE public.github_repos_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Usuarios ven solo su propia conexion GitHub Repos" ON public.github_repos_connections;
CREATE POLICY "Usuarios ven solo su propia conexion GitHub Repos"
  ON public.github_repos_connections
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Guardar o actualizar (si p_token es NULL/'' se conserva el token del Vault)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_repos_upsert_connection(
  p_user_id UUID,
  p_owner TEXT,
  p_repo_filter TEXT DEFAULT '',
  p_enabled BOOLEAN DEFAULT true,
  p_token TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'connected'
)
RETURNS SETOF public.github_repos_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT := 'GITHUB_REPOS_TOKEN_' || p_user_id;
  v_secret_id UUID;
  v_connection_id UUID;
  v_token_hint TEXT;
BEGIN
  SELECT id INTO v_connection_id FROM public.github_repos_connections WHERE user_id = p_user_id;
  SELECT id INTO v_secret_id FROM vault.secrets WHERE name = v_secret_name;

  IF p_token IS NOT NULL AND length(trim(p_token)) > 0 THEN
    IF v_secret_id IS NULL THEN
      INSERT INTO vault.secrets (name, secret) VALUES (v_secret_name, p_token);
    ELSE
      UPDATE vault.secrets SET secret = p_token WHERE id = v_secret_id;
    END IF;
    v_token_hint := '••••' || right(p_token, 4);
  END IF;

  IF v_connection_id IS NULL THEN
    INSERT INTO public.github_repos_connections (user_id, owner, repo_filter, enabled, status, token_hint, last_validated_at)
    VALUES (p_user_id, p_owner, COALESCE(p_repo_filter, ''), COALESCE(p_enabled, true), p_status,
            COALESCE(v_token_hint, ''), CASE WHEN p_status = 'connected' THEN now() ELSE NULL END)
    RETURNING id INTO v_connection_id;
  ELSE
    UPDATE public.github_repos_connections
    SET owner = COALESCE(p_owner, owner),
        repo_filter = COALESCE(p_repo_filter, repo_filter),
        enabled = COALESCE(p_enabled, enabled),
        status = COALESCE(p_status, status),
        token_hint = COALESCE(v_token_hint, token_hint),
        last_validated_at = CASE WHEN p_status = 'connected' THEN now() ELSE last_validated_at END
    WHERE id = v_connection_id;
  END IF;

  RETURN QUERY SELECT * FROM public.github_repos_connections WHERE id = v_connection_id;
END;
$$;

-- ----------------------------------------------------------------------------
-- Leer la conexión con el token descifrado (solo backend, service role)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_repos_get_connection_secret(p_user_id UUID)
RETURNS TABLE (
  id UUID, user_id UUID, owner TEXT, repo_filter TEXT, enabled BOOLEAN, status TEXT,
  token_hint TEXT, last_validated_at TIMESTAMPTZ, updated_at TIMESTAMPTZ, token TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT := 'GITHUB_REPOS_TOKEN_' || p_user_id;
BEGIN
  RETURN QUERY
  SELECT c.id, c.user_id, c.owner, c.repo_filter, c.enabled, c.status, c.token_hint, c.last_validated_at, c.updated_at,
         COALESCE((SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = v_secret_name), '') AS token
  FROM public.github_repos_connections c
  WHERE c.user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.github_repos_update_connection_status(p_user_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.github_repos_connections SET status = p_status WHERE user_id = p_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.github_repos_disconnect_connection(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.github_repos_connections WHERE user_id = p_user_id;
  DELETE FROM vault.secrets WHERE name = 'GITHUB_REPOS_TOKEN_' || p_user_id;
END;
$$;

-- Las RPC SECURITY DEFINER reciben p_user_id: solo el backend (service role) puede llamarlas.
REVOKE EXECUTE ON FUNCTION public.github_repos_upsert_connection(UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.github_repos_get_connection_secret(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.github_repos_update_connection_status(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.github_repos_disconnect_connection(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.github_repos_upsert_connection(UUID, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.github_repos_get_connection_secret(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.github_repos_update_connection_status(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.github_repos_disconnect_connection(UUID) TO service_role;
