# Test Plan Manager

Aplicación Angular para generación de planes de prueba usando IA (Google Gemini).

## Características

- ✅ Generación automática de casos de prueba con IA
- ✅ Técnicas ISTQB (Clases de Equivalencia, Valores Límite, Tablas de Decisión, etc.)
- ✅ Exportación a Word y Excel con formato profesional
- ✅ Editor visual de casos de prueba con drag & drop
- ✅ Matriz de trazabilidad de ejecución
- ✅ Gestión de planes de prueba con filtros avanzados
- ✅ Refinamiento inteligente con IA
- ✅ Persistencia en base de datos (Supabase)

## Tecnologías

- Angular 19 (Standalone Components)
- Google Gemini AI (gemini-2.0-flash-exp)
- Supabase (PostgreSQL)
- Vercel (Despliegue)
- ExcelJS & Docx (Exportación)

## Desarrollo Local

### Requisitos
- Node.js 18.x o superior
- npm

### Instalación

```bash
npm install
```

### Configuración

Crea un archivo `.env.local` con:

```env
GEMINI_API_KEY=tu_api_key_aqui
SUPABASE_URL=tu_supabase_url
SUPABASE_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_KEY=tu_supabase_service_key
ENCRYPTION_KEY=tu_encryption_key
```

### Ejecutar en desarrollo

```bash
npm start
```

Esto inicia:
- Servidor API local en `http://localhost:3000`
- Angular en `http://localhost:4200`

### Build de producción

```bash
npm run build
```

## Despliegue en Vercel

### Variables de entorno requeridas

Configura en Vercel Dashboard:

- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ENCRYPTION_KEY`

### Despliegue automático

Push a la rama `main` despliega automáticamente en Vercel.

### Despliegue manual

```bash
vercel --prod
```

## Estructura del Proyecto

```
src/app/
├── test-plan-generator/         # Generador principal de planes
├── test-case-generator/         # Generador de casos individuales
├── test-case-editor/            # Editor visual de casos
├── test-case-refiner/           # Refinamiento con IA
├── test-plan-viewer/            # Visor y gestor de planes
│   └── components/
│       └── general-sections/    # Secciones estáticas (alcance, estrategia)
├── html-matrix-exporter/        # Exportador Excel
├── word-exporter/               # Exportador Word
├── confirmation-modal/          # Modal de confirmación
├── toast/                       # Sistema de notificaciones
├── services/                    # Servicios centrales
│   ├── gemini.service.ts       # Integración con IA
│   ├── database.service.ts     # Operaciones de BD
│   ├── ai-providers.service.ts # Gestión de proveedores IA
│   └── app-config.service.ts   # Configuración global
└── models/                      # Modelos TypeScript
    ├── hu-data.model.ts        # Modelos UI
    └── database.model.ts       # Modelos BD

api/
└── gemini-proxy.ts              # Proxy serverless Vercel

local-api-server.js              # Proxy local desarrollo
```

## Mantenimiento del Código

### Limpieza Realizada (Nov 2025)

**Archivos eliminados:**
- ❌ `REFACTORING_ANALYSIS.md` - Documentación obsoleta de refactorización
- ❌ `REFACTORING_REFINER_COMPONENT.md` - Notas de desarrollo ya implementadas

**Código optimizado:**
- ✅ Logs de consola mantenidos solo para debugging crítico
- ✅ Código comentado eliminado (solo se mantienen comentarios explicativos)
- ✅ Funciones no utilizadas identificadas y documentadas
- ✅ Imports optimizados y organizados

### Buenas Prácticas

**Logging:**
- Los `console.log` se mantienen en servicios críticos (DatabaseService, GeminiService) para facilitar debugging en producción
- Formato estándar: `✅ Éxito`, `❌ Error`, `📊 Info`, `🧠 Proceso`

**Código:**
- Todos los componentes usan arquitectura standalone
- Servicios inyectables con `providedIn: 'root'`
- Modelos TypeScript estrictos para type safety
- Smart updates para optimizar operaciones de BD

**Base de Datos:**
- Operaciones batch para mejor rendimiento
- Transacciones para integridad de datos
- Índices optimizados en tablas principales
- Cascade deletes configurados correctamente

## Licencia

MIT
