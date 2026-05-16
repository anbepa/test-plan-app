#!/bin/bash
set -e

echo "🔧 Generando environment.prod.ts desde variables de entorno de Vercel..."

# Validar variables obligatorias
if [ -z "$SUPABASE_URL" ]; then
  echo "❌ ERROR: SUPABASE_URL no está definida en Vercel"
  exit 1
fi

if [ -z "$SUPABASE_KEY" ]; then
  echo "❌ ERROR: SUPABASE_KEY no está definida en Vercel"
  exit 1
fi

echo "✅ Variables encontradas:"
echo "   SUPABASE_URL: ${SUPABASE_URL:0:35}..."
echo "   SUPABASE_KEY: ${SUPABASE_KEY:0:12}..."

# Generar environment.prod.ts desde cero (no depende de que exista en git)
cat > src/environments/environment.prod.ts << EOF
// =====================================================================
// environment.prod.ts — PRODUCCIÓN (generado automáticamente por build-vercel.sh)
// NO commitear este archivo al repositorio.
// Regenerado en cada deploy de Vercel desde las variables de entorno.
// =====================================================================
export const environment = {
  production: true,

  useGeminiProxy: true,
  geminiApiUrl: '/api/gemini-proxy',
  geminiApiKey: '',
  geminiApiEndpoint: '',

  supabaseUrl: '${SUPABASE_URL}',
  supabaseKey: '${SUPABASE_KEY}',

  apiTimeout: 30000,
  maxRetries: 3,

  features: {
    useDatabase: true,
    enableRealtime: false,
    enableAuth: true
  }
};
EOF

echo "🔍 environment.prod.ts generado:"
grep -n "supabase" src/environments/environment.prod.ts

echo "🏗️ Iniciando build de Angular..."
npm run build