#!/bin/bash

echo "🔧 Configurando variables de entorno para producción..."

# Reemplazar las variables en environment.prod.ts antes del build
sed -i "s/\${SUPABASE_URL}/$SUPABASE_URL/g" src/environments/environment.prod.ts
sed -i "s/\${SUPABASE_KEY}/$SUPABASE_KEY/g" src/environments/environment.prod.ts

echo "✅ Variables configuradas:"
echo "SUPABASE_URL: ${SUPABASE_URL:0:30}..."
echo "SUPABASE_KEY: ${SUPABASE_KEY:0:30}..."

echo "🏗️ Iniciando build de Angular..."
npm run build