#!/bin/bash

echo "🔧 Configurando variables de entorno para producción..."

# Verificar que las variables de entorno están definidas
if [ -z "$SUPABASE_URL" ]; then
  echo "❌ ERROR: SUPABASE_URL no está definida"
  exit 1
fi

if [ -z "$SUPABASE_SERVICE_KEY" ]; then
  echo "❌ ERROR: SUPABASE_SERVICE_KEY no está definida"
  exit 1
fi

echo "✅ Variables encontradas:"
echo "SUPABASE_URL: ${SUPABASE_URL:0:30}..."
echo "SUPABASE_SERVICE_KEY: ${SUPABASE_SERVICE_KEY:0:10}..."

# Crear una copia del archivo para modificar
cp src/environments/environment.prod.ts src/environments/environment.prod.ts.tmp

# Reemplazar las variables usando una sintaxis más segura
sed "s|\${SUPABASE_URL}|$SUPABASE_URL|g" src/environments/environment.prod.ts.tmp > src/environments/environment.prod.ts.build
sed "s|\${SUPABASE_SERVICE_KEY}|$SUPABASE_SERVICE_KEY|g" src/environments/environment.prod.ts.build > src/environments/environment.prod.ts

# Limpiar archivos temporales
rm src/environments/environment.prod.ts.tmp src/environments/environment.prod.ts.build

echo "🔍 Verificando reemplazo:"
grep -n "supabase" src/environments/environment.prod.ts

echo "🏗️ Iniciando build de Angular..."
npm run build