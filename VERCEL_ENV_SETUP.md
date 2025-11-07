# 🔐 Variables de Entorno para Vercel

## Configuración Segura para Producción

### Variables Requeridas en Vercel:

✅ **Las siguientes variables ya están configuradas en tu Vercel:**

1. **SUPABASE_URL**
   - ✅ Configurada en Vercel
   - Descripción: URL de tu proyecto Supabase

2. **SUPABASE_KEY**
   - ✅ Configurada en Vercel  
   - Descripción: Clave anónima de Supabase (safe for client-side)

3. **GEMINI_API_KEY**
   - ✅ Configurada en Vercel
   - Descripción: API Key de Google Gemini

4. **ENCRYPTION_KEY**
   - ✅ Configurada en Vercel
   - Descripción: Clave para encriptación

5. **SUPABASE_SERVICE_KEY**
   - ✅ Configurada en Vercel
   - Descripción: Clave de servicio para operaciones backend

### ⚠️ Nota de Seguridad:
- La `SUPABASE_KEY` (anon key) es segura para el cliente
- `SUPABASE_SERVICE_KEY` es secreta - solo para backend
- `GEMINI_API_KEY` es secreta - solo para backend
- `ENCRYPTION_KEY` es secreta - solo para backend

## ✅ Configuración Completada

### 🎯 **Estado Actual - TODO LISTO PARA VERCEL:**

1. **✅ Variables configuradas en Vercel Dashboard:**
   - `SUPABASE_URL` 
   - `SUPABASE_KEY`
   - `GEMINI_API_KEY`
   - `ENCRYPTION_KEY` 
   - `SUPABASE_SERVICE_KEY`

2. **✅ Archivos de environment configurados:**
   - `environment.ts` - valores hardcoded para desarrollo
   - `environment.prod.ts` - placeholders que se reemplazarán en build

3. **✅ Script de build personalizado:**
   - `build-vercel.sh` - reemplaza variables en build time
   - `vercel.json` configurado para usar `npm run build:vercel`

### 🚀 **Para Desplegar:**
```bash
# Solo hacer push - Vercel se encarga del resto
git add .
git commit -m "Configuración de variables de entorno para Vercel"
git push
```

### 🔄 **Cómo Funciona:**
1. Vercel ejecuta `npm run build:vercel`
2. El script reemplaza `${SUPABASE_URL}` con el valor real
3. Se compila Angular con las variables correctas
4. ¡Listo! 🎉

### ✅ Verificar:
- [ ] `.env.local` en .gitignore
- [ ] Variables configuradas en Vercel
- [ ] Environments/* usan process.env
- [ ] No hay credenciales hardcodeadas en código