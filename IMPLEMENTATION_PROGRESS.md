# Implementación: Gestión de Evidencias en Azure DevOps
## Estado de Progreso y Próximos Pasos

### ✅ Completado

1. **Modelos e Interfaces** (`src/app/models/azure-devops-evidence.model.ts`)
   - Enum de estados del flujo (IDLE, VALIDATING_PLAN, PLAN_VALIDATED, etc.)
   - Interfaz para información validada del plan
   - Interfaz para errores de validación
   - Modelo de configuración del nombre del ZIP
   - Tipos para compresión, carga y vinculación

2. **Servicio de Validación de Planes** (`src/app/services/integrations/azure-devops-evidence.service.ts`)
   - Validación de formato de ID
   - Consulta a Azure DevOps del plan
   - Validación de respuesta
   - Extracción automática de projectId desde URL
   - Manejo de errores específicos

3. **Servicio de Compresión** (`src/app/services/export/evidence-compression.service.ts`)
   - Resolución de plantilla de nombres con variables
   - Sanitización de nombres de archivo
   - Compresión con JSZip
   - Creación de estructura carpeta/archivo
   - Validación de ZIP

4. **Servicio Orquestador** (`src/app/services/export/evidence-upload-orchestrator.service.ts`)
   - Coordinación del flujo completo
   - Estado observable para UI
   - Manejo de cancelación
   - Reintentos segmentados
   - Limpieza de recursos

5. **Componente Modal de Descargas** (`src/app/shared/components/evidence-download-modal/`)
   - Modal para seleccionar formato (Word, PDF, Serenity)
   - Indicadores de progreso
   - Manejo de estados y errores
   - Cleanup al destruir

6. **Endpoints Backend** (`api/integrations/azure-devops/work-items.ts`)
   - GET: Consultar Work Item
   - POST: Cargar archivo
   - PATCH: Vincular archivo

7. **JSZip CDN** agregado a `src/index.html`

---

### ⏳ Por Completar (Próximos Pasos)

#### Paso 1: Crear Componente Unificado "Gestionar Evidencias"
**Archivo**: `src/app/shared/components/evidence-manager/evidence-manager.component.ts`

```typescript
// Componente principal que unifica:
// - Un botón "Gestionar evidencias" en lugar de Word/PDF/Serenity
// - Modal contenedor con dos opciones
// - Opción 1: "Descargar evidencias" → usa EvidenceDownloadModalComponent
// - Opción 2: "Subir a Azure DevOps" → nuevo modal de carga
```

Este componente debe:
- Reemplazar los botones Word, PDF, Serenity en `plan-execution.component.html`
- Recibir como @Input: execution, testRun, huData
- Emitir eventos cuando se completen operaciones
- Ser reutilizable

#### Paso 2: Crear Modal de Carga a Azure DevOps
**Archivo**: `src/app/shared/components/evidence-upload-modal/evidence-upload-modal.component.ts`

El modal debe incluir:
1. Campo de entrada: ID del plan (ej: 7695070)
2. Botón "Validar plan" que:
   - Llama a `AzureDevOpsEvidenceService.validateTestPlan()`
   - Muestra información del plan (título, área, tipo)
3. Vista previa del nombre del ZIP
4. 5 secciones de estado para cada paso:
   - Validación de plan
   - Generación de Serenity
   - Compresión
   - Carga de archivo
   - Vinculación
5. Botón "Generar y subir"
6. Botón "Reintentar" (cuando falla un paso)
7. Botón "Cancelar"

#### Paso 3: Agregar Configuración del Nombre del ZIP
**Archivo**: Modificar `src/app/configuracion/configuracion.component.ts`

Añadir:
```typescript
serenityZipNameTemplate = 'Evidencia_{{planId}}_{{timestamp}}';

// Input field en HTML:
// <input type="text" [(ngModel)]="serenityZipNameTemplate" 
//        placeholder="Ej: Evidencia_{{planId}}_{{planTitle}}_{{timestamp}}" />

// Guardar en localStorage o en base de datos
```

#### Paso 4: Completar el Orquestador (Fase de Serenity y Compresión)
**Archivo**: Actualizar `src/app/services/export/evidence-upload-orchestrator.service.ts`

En el paso 2 (Serenity) y 3 (Compresión), necesita:
- Acceder a los archivos generados por Serenity desde el sistema de archivos
- O recibir referencia a la salida de Serenity
- Crear Blob real desde esos archivos
- Pasar el Blob al paso 4 (carga)

Nota: Esto puede depender de dónde Serenity guarda sus archivos.

#### Paso 5: Actualizar Plan Execution Component
**Archivo**: `src/app/test-plan-viewer/components/plan-execution/plan-execution.component.ts`

Cambiar:
```typescript
// DE:
<button (click)="exportToDOCX()">Word</button>
<button (click)="exportToPDF()">PDF</button>
<button (click)="downloadSerenityReport()">Serenity</button>

// A:
<app-evidence-manager 
  [execution]="execution"
  [testRun]="testRun"
  [huData]="hu">
</app-evidence-manager>
```

#### Paso 6: Pruebas Unitarias
**Archivo**: `src/app/services/integrations/azure-devops-evidence.service.spec.ts`

Mínimo requerido:
```typescript
describe('AzureDevOpsEvidenceService', () => {
  describe('validateTestPlan', () => {
    it('debe validar exitosamente un plan válido');
    it('debe retornar error para ID vacío');
    it('debe retornar error para ID con formato inválido');
    it('debe extraer projectId desde _links.self.href');
    it('debe extraer projectId desde url como fallback');
    it('debe retornar error cuando no puede extraer projectId');
    it('debe retornar error cuando tipo de Work Item no es permitido');
  });
});
```

Similar para `EvidenceCompressionService` y `EvidenceUploadOrchestrator`.

#### Paso 7: Validación Final

**Checklist de verificación**:
- [ ] Compilación sin errores: `npm run build`
- [ ] Linting: `npm run lint`
- [ ] Pruebas: `npm run test`
- [ ] No hay credenciales en código frontend
- [ ] No hay valores fijos de projectId/areaPath
- [ ] No hay suscripciones pendientes (memory leaks)
- [ ] Modal responde a estados de progreso
- [ ] Errores muestran mensajes claros
- [ ] Botón deshabilitado durante operaciones
- [ ] Limpieza de temporales
- [ ] Estructura del ZIP cumple con lo especificado

---

### Configuración de Rutas (Verificar)

El endpoint backend requiere enrutamiento correcto. Verificar:
1. `vercel.json` incluya rutas para `/api/integrations/azure-devops/work-items/[...]`
2. O que use dinámicamente el parámetro de ruta

---

### Archivos Creados Hasta Ahora

1. `/src/app/models/azure-devops-evidence.model.ts` ✅
2. `/src/app/services/integrations/azure-devops-evidence.service.ts` ✅
3. `/src/app/services/export/evidence-compression.service.ts` ✅
4. `/src/app/services/export/evidence-upload-orchestrator.service.ts` ✅
5. `/src/app/shared/components/evidence-download-modal/evidence-download-modal.component.ts` ✅
6. `/src/app/shared/components/evidence-download-modal/evidence-download-modal.component.html` ✅
7. `/src/app/shared/components/evidence-download-modal/evidence-download-modal.component.css` ✅
8. `/api/integrations/azure-devops/work-items.ts` ✅

---

### Archivos Que Deben Ser Modificados

1. `src/app/test-plan-viewer/components/plan-execution/plan-execution.component.html`
   - Reemplazar botones Word, PDF, Serenity por componente unificado

2. `src/app/test-plan-viewer/components/plan-execution/plan-execution.component.ts`
   - Remover métodos `exportToDOCX()`, `exportToPDF()`, `downloadSerenityReport()`
   - Pasar datos al nuevo componente

3. `src/app/configuracion/configuracion.component.ts`
   - Agregar entrada para nombre del ZIP con variables

4. `src/app/configuracion/configuracion.component.html`
   - Agregar campo de entrada para plantilla del ZIP

---

### Notas Importantes

- **JSZip**: Ya agregado a CDN en `index.html`
- **Serenity Output**: Necesita investigar cómo acceder a archivos generados
- **Blob Handling**: El servicio compresión debe trabajar con Blobs reales
- **Rutas Backend**: Verificar estructura de rutas en Vercel
- **Limpieza**: SessionStorage y archivos temporales se limpian correctamente
- **Seguridad**: PAT nunca se expone en frontend

---

### Comando para Compilar y Validar

```bash
# Compilar
npm run build

# Lint
npm run lint

# Tests
npm run test

# Dev server
ng serve
```

Después de completar cada paso, ejecutar compilación para detectar errores temprano.
