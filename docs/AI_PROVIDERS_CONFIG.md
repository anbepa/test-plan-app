# Configuración de Proveedores de IA

Este proyecto soporta múltiples proveedores de IA para la generación de casos de prueba:

## Proveedores Disponibles

### 1. **Gemini** (Google)
- Modelo: `gemini-2.5-flash-lite`
- URL: `https://generativelanguage.googleapis.com/v1/models/`

### 2. **DeepSeek**
- Modelo: `deepseek-chat`
- URL: `https://api.deepseek.com/chat/completions`

---

## Configuración Inicial

### 1. Variables de Entorno

Crea o actualiza el archivo `.env.local` en la raíz del proyecto:

```bash
# Gemini API Key (Google)
GEMINI_API_KEY=tu_api_key_de_gemini_aqui

# DeepSeek API Key
DEEPSEEK_API_KEY=tu_api_key_de_deepseek_aqui
```

### 2. Obtener API Keys

#### Gemini (Google):
1. Ve a [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Crea un nuevo proyecto o selecciona uno existente
3. Genera una API Key
4. Copia la key y agrégala a `.env.local`

#### DeepSeek:
1. Ve a [DeepSeek Platform](https://platform.deepseek.com/)
2. Regístrate o inicia sesión
3. Ve a la sección de API Keys
4. Genera una nueva API Key
5. Copia la key y agrégala a `.env.local`

---

## Uso del Sistema

### Cambiar de Proveedor

El sistema usa un **servicio unificado** (`AiUnifiedService`) que automáticamente delega las llamadas al proveedor activo configurado en la base de datos.

#### Opción 1: Mediante la Interfaz (Próximamente)
- Navega a la sección de configuración
- Selecciona el proveedor deseado (Gemini o DeepSeek)
- El sistema cambiará automáticamente

#### Opción 2: Mediante la Base de Datos
Actualmente, el proveedor activo se gestiona a través de la tabla `ai_providers`:

```sql
-- Ver proveedores disponibles
SELECT * FROM ai_providers;

-- Activar DeepSeek
UPDATE ai_providers SET is_active = false WHERE id != 'deepseek';
UPDATE ai_providers SET is_active = true WHERE id = 'deepseek';

-- Activar Gemini
UPDATE ai_providers SET is_active = false WHERE id != 'gemini';
UPDATE ai_providers SET is_active = true WHERE id = 'gemini';
```

---

## Arquitectura del Sistema

### Flujo de Llamadas

```
Componente (test-case-generator)
    ↓
AiUnifiedService (servicio unificado)
    ↓
AiProvidersService (gestión de proveedores)
    ↓
[GeminiService] o [DeepSeekService] (según proveedor activo)
    ↓
[GeminiClientService] o [DeepSeekClientService]
    ↓
Proxy API (/api/gemini-proxy o /api/deepseek-proxy)
    ↓
API Externa (Gemini o DeepSeek)
```

### Servicios Creados

1. **`ai-unified.service.ts`**: Servicio unificado que delega al proveedor activo
2. **`deepseek-client.service.ts`**: Cliente HTTP para DeepSeek
3. **`deepseek.service.ts`**: Lógica de negocio para DeepSeek (similar a GeminiService)
4. **`ai-providers.service.ts`**: Gestión de proveedores (ya existente)

### Archivos de Proxy

1. **`api/deepseek-proxy.ts`**: Proxy para Vercel/producción
2. **`local-api-server.js`**: Servidor local con endpoint `/api/deepseek-proxy`

---

## Ejecución Local

### 1. Iniciar el servidor local de API

```bash
node local-api-server.js
```

Esto iniciará el servidor en `http://localhost:3000` con los endpoints:
- `/api/gemini-proxy` (Gemini)
- `/api/deepseek-proxy` (DeepSeek)

### 2. Iniciar la aplicación Angular

```bash
npm start
```

---

## Diferencias entre Proveedores

### Estructura de Request

#### Gemini:
```json
{
  "contents": [
    {
      "parts": [
        { "text": "prompt aquí" }
      ]
    }
  ],
  "generationConfig": {
    "maxOutputTokens": 2000,
    "temperature": 0.5
  }
}
```

#### DeepSeek:
```json
{
  "model": "deepseek-chat",
  "messages": [
    {
      "role": "user",
      "content": "prompt aquí"
    }
  ],
  "temperature": 0.5,
  "max_tokens": 2000
}
```

### Estructura de Response

#### Gemini:
```json
{
  "candidates": [
    {
      "content": {
        "parts": [
          { "text": "respuesta aquí" }
        ]
      }
    }
  ]
}
```

#### DeepSeek:
```json
{
  "id": "...",
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "respuesta aquí"
      }
    }
  ],
  "usage": {
    "prompt_tokens": 14,
    "completion_tokens": 1,
    "total_tokens": 15
  }
}
```

---

## Troubleshooting

### Error: "DEEPSEEK_API_KEY not configured"
- Verifica que `.env.local` existe y contiene `DEEPSEEK_API_KEY`
- Reinicia el servidor local (`node local-api-server.js`)

### Error: "No hay proveedor activo"
- Verifica la tabla `ai_providers` en la base de datos
- Asegúrate de que al menos un proveedor tiene `is_active = true`

### Error 429 (Rate Limit)
- Ambos proveedores tienen límites de rate
- El sistema implementa colas automáticas con delays
- Espera unos segundos entre generaciones

### Error de autenticación (401)
- Verifica que la API Key es correcta
- Verifica que la API Key no ha expirado
- Para DeepSeek, verifica que tienes saldo disponible

---

## Próximos Pasos

- [ ] Crear interfaz de administración de proveedores
- [ ] Implementar métricas de uso por proveedor
- [ ] Agregar más proveedores (OpenAI, Claude, etc.)
- [ ] Implementar fallback automático entre proveedores
- [ ] Agregar caché de respuestas para optimizar costos

---

## Notas Importantes

1. **Seguridad**: Nunca commitees las API Keys al repositorio
2. **Costos**: Ambos proveedores tienen costos asociados, monitorea tu uso
3. **Rate Limits**: Respeta los límites de cada proveedor
4. **Compatibilidad**: El sistema está diseñado para ser extensible a nuevos proveedores
