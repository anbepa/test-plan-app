-- Script para configurar proveedores de IA
-- Ejecutar en Supabase SQL Editor

-- 1. Crear tabla si no existe
CREATE TABLE IF NOT EXISTS ai_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    endpoint_url TEXT NOT NULL,
    default_model TEXT,
    is_active BOOLEAN DEFAULT false,
    has_api_key BOOLEAN DEFAULT false,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Insertar o actualizar Gemini
INSERT INTO ai_providers (id, name, display_name, endpoint_url, default_model, is_active, has_api_key)
VALUES (
    'gemini',
    'gemini',
    'Google Gemini',
    'https://generativelanguage.googleapis.com/v1/models/',
    'gemini-2.5-flash-lite',
    false, -- Desactivado porque alcanzó la cuota
    true
)
ON CONFLICT (id) DO UPDATE SET
    is_active = false,
    updated_at = NOW();

-- 3. Insertar o actualizar DeepSeek
INSERT INTO ai_providers (id, name, display_name, endpoint_url, default_model, is_active, has_api_key)
VALUES (
    'deepseek',
    'deepseek',
    'DeepSeek',
    'https://api.deepseek.com/chat/completions',
    'deepseek-chat',
    true, -- Activado como proveedor principal
    true
)
ON CONFLICT (id) DO UPDATE SET
    is_active = true,
    updated_at = NOW();

-- 4. Verificar configuración
SELECT 
    id,
    display_name,
    default_model,
    is_active,
    has_api_key
FROM ai_providers
ORDER BY is_active DESC, id;
