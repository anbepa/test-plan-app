-- ============================================================================
-- Azure Serenity Release Connections
-- Almacena la configuración del Release CD de Serenity en Azure DevOps
-- por usuario, con el PAT encriptado en Supabase Vault.
-- ============================================================================

-- 1. Tabla de conexiones (sin el token)
CREATE TABLE IF NOT EXISTS public.azure_serenity_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  azure_organization TEXT NOT NULL,
  azure_project TEXT NOT NULL,
  release_definition_id INTEGER NOT NULL,
  pipeline_name TEXT NOT NULL DEFAULT 'Serenity Report CD',
  branch TEXT NOT NULL DEFAULT 'trunk',
  status TEXT NOT NULL DEFAULT 'connected'
    CHECK (status IN ('connected', 'invalid', 'expired', 'disconnected')),
  token_hint TEXT NOT NULL DEFAULT '',
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id)
);

-- Indices
CREATE INDEX IF NOT EXISTS idx_azure_serenity_connections_user
  ON public.azure_serenity_connections (user_id);

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION public.azure_serenity_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_azure_serenity_connections_updated_at
  ON public.azure_serenity_connections;

CREATE TRIGGER trg_azure_serenity_connections_updated_at
  BEFORE UPDATE ON public.azure_serenity_connections
  FOR EACH ROW EXECUTE FUNCTION public.azure_serenity_set_updated_at();

-- Habilitar RLS
ALTER TABLE public.azure_serenity_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Usuarios ven solo su propia conexion Azure Serenity"
  ON public.azure_serenity_connections
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- 2. RPC: Guardar o actualizar conexión + secreto en Vault
CREATE OR REPLACE FUNCTION public.azure_serenity_upsert_connection(
  p_user_id UUID,
  p_azure_organization TEXT,
  p_azure_project TEXT,
  p_release_definition_id INTEGER,
  p_personal_access_token TEXT,
  p_pipeline_name TEXT DEFAULT 'Serenity Report CD',
  p_branch TEXT DEFAULT 'trunk',
  p_status TEXT DEFAULT 'connected'
)
RETURNS SETOF public.azure_serenity_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT;
  v_secret_id UUID;
  v_connection_id UUID;
BEGIN
  -- Formato: AZ_SERENITY_PAT_<user_id>
  v_secret_name := 'AZ_SERENITY_PAT_' || p_user_id;

  -- Buscar conexión existente
  SELECT id INTO v_connection_id
  FROM public.azure_serenity_connections
  WHERE user_id = p_user_id;

  -- Buscar secreto existente en Vault
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  -- Crear o actualizar secreto en Vault
  IF v_secret_id IS NULL THEN
    INSERT INTO vault.secrets (name, secret)
    VALUES (v_secret_name, p_personal_access_token)
    RETURNING id INTO v_secret_id;
  ELSE
    UPDATE vault.secrets
    SET secret = p_personal_access_token
    WHERE id = v_secret_id;
  END IF;

  -- Crear o actualizar la conexión
  IF v_connection_id IS NULL THEN
    INSERT INTO public.azure_serenity_connections (
      user_id, azure_organization, azure_project, release_definition_id,
      pipeline_name, branch, status, token_hint, last_validated_at
    ) VALUES (
      p_user_id, p_azure_organization, p_azure_project, p_release_definition_id,
      p_pipeline_name, p_branch, p_status,
      '••••' || right(p_personal_access_token, 4),
      now()
    )
    RETURNING id INTO v_connection_id;
  ELSE
    UPDATE public.azure_serenity_connections
    SET
      azure_organization = p_azure_organization,
      azure_project = p_azure_project,
      release_definition_id = p_release_definition_id,
      pipeline_name = p_pipeline_name,
      branch = p_branch,
      status = p_status,
      token_hint = '••••' || right(p_personal_access_token, 4),
      last_validated_at = now()
    WHERE id = v_connection_id;
  END IF;

  RETURN QUERY SELECT * FROM public.azure_serenity_connections WHERE id = v_connection_id;
END;
$$;


-- 3. RPC: Obtener conexión con secreto desencriptado (solo admin)
CREATE OR REPLACE FUNCTION public.azure_serenity_get_connection_secret(
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  azure_organization TEXT,
  azure_project TEXT,
  release_definition_id INTEGER,
  pipeline_name TEXT,
  branch TEXT,
  status TEXT,
  token_hint TEXT,
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  personal_access_token TEXT,
  secret_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  v_secret_name := 'AZ_SERENITY_PAT_' || p_user_id;

  RETURN QUERY
  SELECT
    c.id,
    c.user_id,
    c.azure_organization,
    c.azure_project,
    c.release_definition_id,
    c.pipeline_name,
    c.branch,
    c.status,
    c.token_hint,
    c.last_validated_at,
    c.updated_at,
    COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = v_secret_name),
      ''
    ) AS personal_access_token,
    (SELECT id FROM vault.secrets WHERE name = v_secret_name) AS secret_id
  FROM public.azure_serenity_connections c
  WHERE c.user_id = p_user_id;
END;
$$;


-- 4. RPC: Desconectar (elimina conexión y secreto)
CREATE OR REPLACE FUNCTION public.azure_serenity_disconnect_connection(
  p_user_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  v_secret_name := 'AZ_SERENITY_PAT_' || p_user_id;

  DELETE FROM public.azure_serenity_connections WHERE user_id = p_user_id;
  DELETE FROM vault.secrets WHERE name = v_secret_name;
END;
$$;
