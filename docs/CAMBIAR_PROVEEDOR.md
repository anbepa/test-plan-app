# Cambiar Proveedor de IA - Guía Rápida

## 🎯 Sistema Simplificado

El sistema ahora usa **localStorage** en lugar de base de datos para gestionar el proveedor activo.

## 🔄 Cambiar de Proveedor

### Opción 1: Desde la Consola del Navegador (Más Rápido)

1. Abre la aplicación en el navegador
2. Presiona `F12` para abrir DevTools
3. Ve a la pestaña **Console**
4. Ejecuta uno de estos comandos:

```javascript
// Cambiar a DeepSeek
localStorage.setItem('active_ai_provider', 'deepseek');
location.reload();

// Cambiar a Gemini
localStorage.setItem('active_ai_provider', 'gemini');
location.reload();

// Ver proveedor actual
console.log('Proveedor activo:', localStorage.getItem('active_ai_provider') || 'gemini (default)');
```

### Opción 2: Desde el Código (Programático)

Inyecta el servicio en cualquier componente:

```typescript
import { AiProvidersService } from './services/ai/ai-providers.service';

constructor(private aiProviders: AiProvidersService) {}

// Cambiar a DeepSeek
this.aiProviders.setActiveProvider('deepseek');

// Cambiar a Gemini
this.aiProviders.setActiveProvider('gemini');

// Ver proveedor actual
const active = this.aiProviders.getActiveProvider();
console.log('Proveedor activo:', active?.displayName);
```

## 📋 Configuración Inicial

### 1. Agregar API Keys en `.env.local`:

```bash
# Gemini (Google)
GEMINI_API_KEY=tu_api_key_de_gemini

# DeepSeek
DEEPSEEK_API_KEY=tu_api_key_de_deepseek
```

### 2. Reiniciar el servidor local:

```bash
# Terminal 1
node local-api-server.js

# Terminal 2
npm start
```

## 🎨 Proveedores Disponibles

| ID | Nombre | Modelo | Estado |
|---|---|---|---|
| `gemini` | Google Gemini | gemini-2.5-flash-lite | Por defecto |
| `deepseek` | DeepSeek | deepseek-chat | Disponible |

## 🔍 Verificar Configuración

Abre la consola del navegador y ejecuta:

```javascript
// Ver todos los proveedores
console.table([
  { id: 'gemini', activo: localStorage.getItem('active_ai_provider') === 'gemini' },
  { id: 'deepseek', activo: localStorage.getItem('active_ai_provider') === 'deepseek' }
]);
```

## ⚡ Cambio Rápido (Gemini alcanzó cuota)

Si Gemini alcanzó su cuota (error 429), cambia a DeepSeek inmediatamente:

```javascript
// En la consola del navegador (F12)
localStorage.setItem('active_ai_provider', 'deepseek');
location.reload();
```

## 🎯 Flujo Automático

El sistema funciona así:

1. **Al cargar la app**: Lee `localStorage.getItem('active_ai_provider')`
2. **Si no existe**: Usa `gemini` por defecto
3. **Si existe**: Usa el proveedor guardado
4. **Al generar casos**: `AiUnifiedService` delega al proveedor activo automáticamente

## 📝 Notas Importantes

- ✅ **No requiere base de datos** - Todo se guarda en localStorage del navegador
- ✅ **Cambio instantáneo** - Solo recarga la página
- ✅ **Persistente** - Se mantiene entre sesiones del navegador
- ⚠️ **Por navegador** - Cada navegador tiene su propia configuración
- ⚠️ **Requiere API Key** - Asegúrate de tener la API Key en `.env.local`

## 🚀 Ejemplo Completo

```javascript
// 1. Ver proveedor actual
console.log('Actual:', localStorage.getItem('active_ai_provider'));

// 2. Cambiar a DeepSeek
localStorage.setItem('active_ai_provider', 'deepseek');

// 3. Recargar página
location.reload();

// 4. Verificar (después de recargar)
console.log('Nuevo proveedor:', localStorage.getItem('active_ai_provider'));
```
