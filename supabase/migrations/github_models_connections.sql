-- ============================================================================
-- GitHub Models (Copilot) Connections
-- Almacena, por usuario, el token de GitHub (obtenido vía Device Flow OAuth)
-- para usar GitHub Models/Copilot como proveedor de IA opcional.
-- El token se guarda ENCRIPTADO en Supabase Vault (mismo patrón que
-- azure_serenity_connections). Cada usuario solo puede ver su propia fila (RLS).
--
-- Convención de secreto en Vault:  GITHUB_MODELS_TOKEN_<user_id>
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tabla de conexiones (SIN el token; el token vive cifrado en Vault)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.github_models_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- 'enabled' = el usuario quiere usar GitHub Models como proveedor activo
  enabled BOOLEAN NOT NULL DEFAULT false,
  -- Modelo elegido en el desplegable (p. ej. 'gpt-4o'); NULL si aún no eligió
  selected_model TEXT,
  status TEXT NOT NULL DEFAULT 'disconnected'
    CHECK (status IN ('connected', 'invalid', 'expired', 'disconnected')),
  -- Pista visible en la UI, p. ej. '••••A408' (nunca el token completo)
  token_hint TEXT NOT NULL DEFAULT '',
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id)      -- 👈 una única configuración de GitHub Models por usuario
);

-- Índice por usuario
CREATE INDEX IF NOT EXISTS idx_github_models_connections_user
  ON public.github_models_connections (user_id);

-- ----------------------------------------------------------------------------
-- Trigger para mantener updated_at
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_models_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_github_models_connections_updated_at
  ON public.github_models_connections;

CREATE TRIGGER trg_github_models_connections_updated_at
  BEFORE UPDATE ON public.github_models_connections
  FOR EACH ROW EXECUTE FUNCTION public.github_models_set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: cada usuario solo ve/modifica su propia conexión
-- ----------------------------------------------------------------------------
ALTER TABLE public.github_models_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios ven solo su propia conexion GitHub Models"
  ON public.github_models_connections;

CREATE POLICY "Usuarios ven solo su propia conexion GitHub Models"
  ON public.github_models_connections
  FOR ALL USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- ----------------------------------------------------------------------------
-- 2. RPC: Guardar o actualizar la conexión + token en Vault
--    Se llama tras completar el Device Flow (cuando ya tenemos el token 'ghu_').
--    Nota: si p_token es NULL o '', se conserva el token existente en Vault
--    (útil para actualizar solo preferencias como enabled / selected_model).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_models_upsert_connection(
  p_user_id UUID,
  p_token TEXT DEFAULT NULL,
  p_enabled BOOLEAN DEFAULT NULL,
  p_selected_model TEXT DEFAULT NULL,
  p_status TEXT DEFAULT 'connected'
)
RETURNS SETOF public.github_models_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT;
  v_secret_id UUID;
  v_connection_id UUID;
  v_token_hint TEXT;
  v_has_token BOOLEAN;
BEGIN
  -- Formato: GITHUB_MODELS_TOKEN_<user_id>
  v_secret_name := 'GITHUB_MODELS_TOKEN_' || p_user_id;
  v_has_token := (p_token IS NOT NULL AND length(trim(p_token)) > 0);

  -- Conexión existente (si la hay)
  SELECT id INTO v_connection_id
  FROM public.github_models_connections
  WHERE user_id = p_user_id;

  -- Secreto existente en Vault (si lo hay)
  SELECT id INTO v_secret_id
  FROM vault.secrets
  WHERE name = v_secret_name;

  -- Crear o actualizar el secreto en Vault SOLO si llega un token nuevo
  IF v_has_token THEN
    IF v_secret_id IS NULL THEN
      INSERT INTO vault.secrets (name, secret)
      VALUES (v_secret_name, p_token)
      RETURNING id INTO v_secret_id;
    ELSE
      UPDATE vault.secrets
      SET secret = p_token
      WHERE id = v_secret_id;
    END IF;

    v_token_hint := '••••' || right(p_token, 4);
  END IF;

  -- Crear o actualizar la fila de conexión
  IF v_connection_id IS NULL THEN
    INSERT INTO public.github_models_connections (
      user_id, enabled, selected_model, status, token_hint, last_validated_at
    ) VALUES (
      p_user_id,
      COALESCE(p_enabled, false),
      p_selected_model,
      p_status,
      COALESCE(v_token_hint, ''),
      CASE WHEN p_status = 'connected' THEN now() ELSE NULL END
    )
    RETURNING id INTO v_connection_id;
  ELSE
    UPDATE public.github_models_connections
    SET
      -- Solo actualiza cada campo si se envía (COALESCE conserva el actual)
      enabled          = COALESCE(p_enabled, enabled),
      selected_model   = COALESCE(p_selected_model, selected_model),
      status           = COALESCE(p_status, status),
      token_hint       = COALESCE(v_token_hint, token_hint),
      last_validated_at = CASE
                            WHEN p_status = 'connected' THEN now()
                            ELSE last_validated_at
                          END
    WHERE id = v_connection_id;
  END IF;

  RETURN QUERY
  SELECT * FROM public.github_models_connections WHERE id = v_connection_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- 3. RPC: Obtener conexión SIN el token (para pintar la UI)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_models_get_connection(
  p_user_id UUID
)
RETURNS SETOF public.github_models_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT * FROM public.github_models_connections
  WHERE user_id = p_user_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- 4. RPC: Obtener conexión CON el token desencriptado (solo backend/admin)
--    Se usa al hacer proxy hacia la API de GitHub Models/Copilot.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_models_get_connection_secret(
  p_user_id UUID
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  enabled BOOLEAN,
  selected_model TEXT,
  status TEXT,
  token_hint TEXT,
  last_validated_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  token TEXT,
  secret_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret_name TEXT;
BEGIN
  v_secret_name := 'GITHUB_MODELS_TOKEN_' || p_user_id;

  RETURN QUERY
  SELECT
    c.id,
    c.user_id,
    c.enabled,
    c.selected_model,
    c.status,
    c.token_hint,
    c.last_validated_at,
    c.updated_at,
    COALESCE(
      (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = v_secret_name),
      ''
    ) AS token,
    (SELECT id FROM vault.secrets WHERE name = v_secret_name) AS secret_id
  FROM public.github_models_connections c
  WHERE c.user_id = p_user_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- 5. RPC: Actualizar solo el estado (p. ej. marcar 'expired' / 'invalid')
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_models_update_connection_status(
  p_user_id UUID,
  p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.github_models_connections
  SET status = p_status
  WHERE user_id = p_user_id;
END;
$$;


-- ----------------------------------------------------------------------------
-- 6. RPC: Desconectar (elimina conexión y token del Vault)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.github_models_disconnect_connection(
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
  v_secret_name := 'GITHUB_MODELS_TOKEN_' || p_user_id;

  DELETE FROM public.github_models_connections WHERE user_id = p_user_id;
  DELETE FROM vault.secrets WHERE name = v_secret_name;
END;
$$;
