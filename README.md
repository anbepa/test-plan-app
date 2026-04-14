# Test Plan App

Aplicación para generar y refinar escenarios/casos de prueba con IA.

## Requisitos mínimos

- Node.js 18+
- npm

## Inicio rápido (local)

1. Instalar dependencias:

```bash
npm install
```

2. Crear `.env.local` en la raíz:

```env
GEMINI_API_KEY=tu_api_key
SUPABASE_URL=tu_supabase_url
SUPABASE_KEY=tu_supabase_anon_key
SUPABASE_SERVICE_KEY=tu_supabase_service_key
ENCRYPTION_KEY=tu_encryption_key
```

3. Levantar proyecto:

```bash
npm start
```

Servicios locales:
- Frontend: http://localhost:4200
- API local: http://localhost:3000

## Scripts útiles

- `npm start`: API local + Angular
- `npm run start:angular`: solo Angular
- `npm run start:api`: solo API local
- `npm run build`: build de producción
- `npm test`: pruebas

## Despliegue (Vercel)

Variables requeridas en el entorno:

- `GEMINI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ENCRYPTION_KEY`

La rama `main` es la rama de despliegue.

## Verificación rápida del contexto IA

Para regenerar escenarios respetando el contexto del analista:

1. Entrar a la vista **Regenerar Escenarios con Contexto** (`/refiner/context`).
2. Completar descripción, criterios, técnica ISTQB y campo de contexto.
3. Ejecutar regeneración y validar resultados.

Referencia técnica del prompt de prioridad de contexto:
- [src/app/config/prompts.config.ts](src/app/config/prompts.config.ts#L107)

## Licencia

MIT
