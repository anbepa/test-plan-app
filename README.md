# Test Plan Manager

Aplicación Angular para generación de planes de prueba usando IA (Google Gemini).

## Características

- Generación automática de casos de prueba
- Técnicas de diseño de pruebas (Clases de Equivalencia, Valores Límite, etc.)
- Exportación a PDF y HTML
- Editor de casos de prueba
- Matriz de trazabilidad

## Tecnologías

- Angular 19
- Google Gemini AI (gemini-2.0-flash)
- Supabase (base de datos)
- Vercel (despliegue)

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

```
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
src/
├── app/
│   ├── test-plan-generator/     # Generador principal
│   ├── test-case-generator/     # Generador de casos
│   ├── test-case-editor/        # Editor de casos
│   ├── test-plan-viewer/        # Visor de planes
│   ├── html-matrix-exporter/    # Exportador de matrices
│   ├── services/                # Servicios (Gemini, DB, etc.)
│   └── models/                  # Modelos de datos
├── environments/                # Configuración por entorno
└── types/                       # Definiciones TypeScript

api/
└── gemini-proxy.ts              # Proxy serverless para Vercel

local-api-server.js              # Proxy local para desarrollo
```

## Licencia

MIT
