# Debugging Vercel Deployment - Error NG0200

## Problema
Error `NG0200` en el navegador al acceder a la app desplegada en Vercel, indicando problemas con la inyección de dependencias, típicamente causado por variables de entorno no configuradas.

## Solución Paso a Paso

### 1. Verificar Variables de Entorno en Vercel Dashboard

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Selecciona tu proyecto `test-plan-app`
3. Ve a **Settings** → **Environment Variables**
4. Asegúrate de que estén configuradas estas variables:

```
SUPABASE_URL = https://tuproyecto.supabase.co
SUPABASE_SERVICE_KEY = tu_service_role_key_aqui
```

**🔑 IMPORTANTE**: 
- Debes usar `SUPABASE_SERVICE_KEY` (NO `SUPABASE_KEY`)
- Esta debe ser la **service_role** key de Supabase, **NO la anon key**
- La service_role key permite operaciones de lectura/escritura completas
- Estas variables deben estar configuradas para **Production**, **Preview** y **Development**

**📍 Dónde encontrar la service_role key:**
1. Ve a tu proyecto en [Supabase Dashboard](https://supabase.com/dashboard)
2. Settings → API
3. Copia la clave **service_role** (no la anon/public)

### 2. Verificar Configuración de Build

En **Settings** → **General** → **Build & Output Settings**:
- **Build Command**: `npm run build:vercel`
- **Output Directory**: `dist/test-plan-app/browser` (o el que uses)

### 3. Verificar Logs de Build

1. Ve a **Deployments** en tu proyecto
2. Haz click en el último deployment
3. Ve a **Function Logs** o **Build Logs**
4. Busca estos mensajes:

✅ **Correcto**:
```
🔧 Configurando variables de entorno para producción...
✅ Variables encontradas:
SUPABASE_URL: https://abc123...
SUPABASE_SERVICE_KEY: eyJhbGci...
```

❌ **Incorrecto**:
```
❌ ERROR: SUPABASE_URL no está definida
❌ ERROR: SUPABASE_SERVICE_KEY no está definida
```

### 4. Comandos de Emergencia

Si necesitas un fix rápido, puedes hardcodear temporalmente en `environment.prod.ts`:

```typescript
// SOLO PARA TESTING - QUITAR DESPUÉS
export const environment = {
  production: true,
  supabaseUrl: 'https://TU_URL_REAL.supabase.co',
  supabaseKey: 'TU_KEY_REAL_AQUI',
  // ... resto de config
};
```

**⚠️ NO olvides revertir esto y usar variables de entorno!**

### 5. Re-deploy

Después de configurar las variables:
1. Ve a **Deployments**
2. Haz click en **Redeploy** en el último deployment
3. O haz un nuevo `git push` para triggerar deployment

### 6. Verificación Final

En el navegador, la consola debería mostrar:
```
✅ DatabaseService inicializado con environment.ts
```

En lugar de:
```
❌ Variables de entorno de Supabase no configuradas
ERROR NG0200: t
```

## Archivos Modificados

- ✅ `build-vercel.sh` - Script mejorado con validaciones
- ✅ `database.service.ts` - Validación de variables en constructor
- ✅ `environment.prod.ts` - Placeholders configurados correctamente