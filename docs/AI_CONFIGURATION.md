# Configuración de Proveedores de IA

## 📋 Resumen

Sistema centralizado para gestionar proveedores de IA (Gemini, DeepSeek, Copilot) mediante variables de entorno, funcionando tanto en desarrollo local como en Vercel.

---

## 🔧 Configuración Local

### 1. Crear archivo .env.local

Copia `.env.example` a `.env.local`:

```bash
cp .env.example .env.local
```

### 2. Configurar variables de entorno

Edita `.env.local` con tus credenciales:

```bash
# Proveedor activo (gemini | deepseek | copilot)
AI_PROVIDER=deepseek

# Google Gemini
GEMINI_API_KEY=AIzaSy...
GEMINI_MODEL=gemini-2.5-flash-lite

# DeepSeek
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_MODEL=deepseek-chat

# GitHub Copilot
COPILOT_API_KEY=ghp_...
COPILOT_MODEL=gpt-4o
```

### 3. Reiniciar servidor

```bash
npm start
```

---

## ☁️ Configuración en Vercel

### Variables de Entorno Requeridas

En Vercel Dashboard → Settings → Environment Variables:

| Variable | Ejemplo | Descripción |
|----------|---------|-------------|
| `AI_PROVIDER` | `deepseek` | Proveedor activo (gemini o deepseek) |
| `GEMINI_API_KEY` | `AIzaSy...` | API Key de Gemini |
| `GEMINI_MODEL` | `gemini-2.5-flash-lite` | Modelo de Gemini |
| `DEEPSEEK_API_KEY` | `sk-...` | API Key de DeepSeek |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Modelo de DeepSeek |

### Aplicar a Todos los Entornos

Marca las variables para:
- ✅ Production
- ✅ Preview
- ✅ Development

---

## 🎯 Proveedores Disponibles

### Google Gemini

**Modelos disponibles**:
- `gemini-2.0-flash-exp` (Experimental, más rápido)
- `gemini-2.5-flash-lite` (Lite, económico)
- `gemini-1.5-pro` (Pro, más potente)

**Obtener API Key**:
1. Ve a [Google AI Studio](https://aistudio.google.com/app/apikey)
2. Crea una API Key
3. Copia y pega en `GEMINI_API_KEY`

---

### DeepSeek

**Modelos disponibles**:
- `deepseek-chat` (Chat optimizado)
- `deepseek-coder` (Código especializado)

**Obtener API Key**:
1. Ve a [DeepSeek Platform](https://platform.deepseek.com/)
2. Regístrate y obtén API Key
3. Copia y pega en `DEEPSEEK_API_KEY`

---

## 🔄 Cambiar de Proveedor

### Opción 1: Variable de Entorno (Recomendado)

Cambia `AI_PROVIDER` en `.env.local`:

```bash
AI_PROVIDER=gemini  # o deepseek
```

### Opción 2: UI (Si está implementado)

Selecciona el proveedor desde la interfaz de usuario.

---

## 📁 Archivos de Configuración

### ai-config.ts

Archivo centralizado que lee variables de entorno:

```typescript
import { getAIConfig, getActiveProviderConfig } from './config/ai-config';

// Obtener configuración completa
const config = getAIConfig();

// Obtener proveedor activo
const activeProvider = getActiveProviderConfig();
console.log(activeProvider.displayName); // "DeepSeek"
console.log(activeProvider.model);       // "deepseek-chat"
```

---

## 🔍 Verificación

### Verificar configuración local

```bash
# Ver variables de entorno
cat .env.local | grep AI_PROVIDER
cat .env.local | grep DEEPSEEK_API_KEY
```

### Verificar en Vercel

1. Ve a tu proyecto en Vercel
2. Settings → Environment Variables
3. Verifica que todas las variables estén configuradas

---

## ⚠️ Solución de Problemas

### Error: "API key not configured"

**Causa**: Variable de entorno no está configurada.

**Solución**:
1. Verifica que `.env.local` existe
2. Verifica que la variable está definida
3. Reinicia el servidor: `npm start`

### Error: "Provider not found"

**Causa**: `AI_PROVIDER` tiene un valor inválido.

**Solución**:
```bash
# Valores válidos: gemini, deepseek
AI_PROVIDER=deepseek
```

### Modelo no funciona

**Causa**: Modelo no disponible para el proveedor.

**Solución**: Verifica los modelos disponibles en la documentación del proveedor.

---

## 🎉 Ventajas

- ✅ **Centralizado**: Una sola fuente de verdad
- ✅ **Flexible**: Cambiar proveedor con 1 variable
- ✅ **Seguro**: API keys en variables de entorno
- ✅ **Multi-entorno**: Funciona en local y Vercel
- ✅ **Escalable**: Fácil agregar nuevos proveedores

---

**Última actualización**: 2025-12-11
