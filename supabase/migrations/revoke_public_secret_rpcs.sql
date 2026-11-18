-- ============================================================================
-- Seguridad: las RPC SECURITY DEFINER que leen, escriben o borran secretos
-- reciben p_user_id y no validan quién llama. Con EXECUTE para anon/authenticated
-- cualquiera con la clave pública podía leer el PAT/token de otro usuario.
-- Solo el backend (service role) debe poder ejecutarlas.
-- ============================================================================
REVOKE EXECUTE ON FUNCTION public.azure_serenity_get_connection_secret(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.azure_serenity_upsert_connection(uuid, text, text, integer, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.azure_serenity_disconnect_connection(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.github_models_get_connection_secret(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.github_models_upsert_connection(uuid, text, boolean, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.github_models_disconnect_connection(uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.azure_serenity_get_connection_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.azure_serenity_upsert_connection(uuid, text, text, integer, text, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.azure_serenity_disconnect_connection(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.github_models_get_connection_secret(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.github_models_upsert_connection(uuid, text, boolean, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.github_models_disconnect_connection(uuid) TO service_role;
