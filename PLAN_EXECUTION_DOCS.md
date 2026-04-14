# Funcionalidad "Ejecutar Plan" - Documentación

## Descripción General

Se ha implementado una nueva funcionalidad completa llamada **"Ejecutar Plan"** que permite ejecutar y documentar los pasos de un plan de pruebas con evidencias visuales (imágenes) directamente en la aplicación.

## Nuevos Componentes

### 1. **plan-execution.component**
**Ubicación**: `src/app/test-plan-viewer/components/plan-execution/`

Componente principal que gestiona la ejecución completa del plan de pruebas.

**Funcionalidades**:
- Visualización de todos los casos de prueba
- Navegación entre pasos y casos de prueba
- Cambio de estado de pasos (Pendiente, En Progreso, Completado, Falló)
- Carga y gestión de imágenes como evidencias
- Editor integrado de imágenes con herramientas de anotación
- Notas por paso
- Guardado automático de progreso
- Exportación a DOCX con evidencias
- Estadísticas de progreso

**Estructura**:
- `plan-execution.component.ts` - Lógica del componente
- `plan-execution.component.html` - Template
- `plan-execution.component.css` - Estilos

### 2. **image-editor.component**
**Ubicación**: `src/app/test-plan-viewer/components/image-editor/`

Componente mini-paint para editar y anotar imágenes.

**Funcionalidades**:
- **Herramientas de dibujo**:
  - ✏️ Bolígrafo (dibujo libre)
  - 📏 Línea recta
  - ⭕ Círculos
  - ▭ Rectángulos
  - 🗑️ Borrador

- **Controles**:
  - Selector de color
  - Control de grosor de línea (1-20px)
  - Limpiar canvas
  - Guardar imagen editada
  - Descargar imagen en PNG

**Estructura**:
- `image-editor.component.ts` - Lógica del canvas
- `image-editor.component.html` - Interfaz
- `image-editor.component.css` - Estilos

## Nuevos Servicios

### **execution-storage.service.ts**
**Ubicación**: `src/app/services/core/`

Servicio para persistencia de datos en localStorage.

**Métodos principales**:
```typescript
// Gestión de ejecuciones
getAllExecutions(): PlanExecution[]
getExecution(executionId: string): PlanExecution | null
getExecutionsByHU(huId: string): PlanExecution[]
saveExecution(execution: PlanExecution): void
deleteExecution(executionId: string): void

// Gestión de imágenes
saveImage(image: ImageEvidence): void
getAllImages(): ImageEvidence[]
getStepImages(stepId: string): ImageEvidence[]
deleteImage(imageId: string): void

// Utilidades
createPlanExecution(huId: string, huTitle: string, testCases: DetailedTestCase[]): PlanExecution
updateStepStatus(executionId: string, testCaseId: string, stepId: string, status): void
getExecutionStats(executionId: string): ExecutionStats
clearAllExecutions(): void
```

## Nuevas Interfaces/Modelos

**Ubicación**: `src/app/models/hu-data.model.ts`

```typescript
// Evidencia de imagen
interface ImageEvidence {
  id: string;
  stepId: string;
  fileName: string;
  base64Data: string;
  originalBase64: string; // Para restaurar la original
  timestamp: number;
}

// Paso de ejecución con estado y evidencias
interface ExecutionStep {
  stepId: string;
  numero_paso: number;
  accion: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  notes?: string;
  evidences: ImageEvidence[];
}

// Caso de prueba en ejecución
interface TestCaseExecution {
  testCaseId: string;
  title: string;
  preconditions: string;
  steps: ExecutionStep[];
  expectedResults: string;
  startedAt?: number;
  completedAt?: number;
  notes?: string;
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
}

// Plan completo en ejecución
interface PlanExecution {
  id: string;
  huId: string;
  huTitle: string;
  testCases: TestCaseExecution[];
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}
```

## Extensiones a Servicios Existentes

### **export.service.ts**
Se agregó el método:
```typescript
async exportExecutionToDOCX(execution: PlanExecution, hu: HUData | null): Promise<void>
```

Permite exportar la ejecución completa con imágenes incrustadas en formato DOCX.

## Rutas Nuevas

Se agregó en `src/app/app.routes.ts`:
```typescript
{
  path: 'viewer/execute-plan',
  loadComponent: () => import('./test-plan-viewer/components/plan-execution/plan-execution.component').then(m => m.PlanExecutionComponent),
  title: 'Ejecutar Plan de Pruebas',
  canActivate: [authGuard]
}
```

## Cambios en Componentes Existentes

### **hu-scenarios-view.component**

Se agregó:
1. Botón "▶ Ejecutar Plan" en la sección de acciones
2. Método `executeTestPlan()` que navega al componente plan-execution
3. Estilo CSS `.button-execute` con gradiente morado

## Flujo de Uso

### 1. **Acceso a la ejecución**
   - Usuario ve un HU con casos de prueba
   - Hace clic en el botón "▶ Ejecutar Plan"

### 2. **Ejecución de pasos**
   - Se carga la ejecución existente o se crea una nueva
   - Usuario selecciona un caso de prueba
   - Selecciona un paso
   - Actualiza el estado del paso
   - Sube imágenes como evidencias

### 3. **Edición de imágenes**
   - Usuario hace clic en una imagen o abre el editor
   - Puede dibujar, anotar, usar herramientas geométricas
   - Guarda los cambios

### 4. **Persistencia**
   - Todo se guarda automáticamente en localStorage
   - Las ejecuciones persisten entre sesiones

### 5. **Exportación**
   - Usuario descarga la ejecución en formato DOCX
   - Documento incluye pasos, estado, y todas las imágenes

## Almacenamiento en LocalStorage

### Claves usadas:
- **`plan_executions`**: Array de todas las ejecuciones
- **`execution_images`**: Array de todas las imágenes

Cada ejecución genera un ID único: `exec_[timestamp]_[random]`

## Estilos Visuales

Se mantiene coherencia con el diseño existente de la app:
- Gradiente principal: `linear-gradient(135deg, #667eea 0%, #764ba2 100%)`
- Colores de estado:
  - **Pendiente**: Gris (#999)
  - **En Progreso**: Naranja (#ff9800)
  - **Completado**: Verde (#4caf50)
  - **Falló**: Rojo (#f44336)

## Responsive Design

Los componentes son totalmente responsivos:
- Desktop: Layout completo con panel lateral
- Tablet: Ajustes de grid y espaciado
- Mobile: Layout vertical, botones en full-width

## Características de Seguridad y Datos

1. **LocalStorage**: Todos los datos se guardan localmente
2. **Base64 para imágenes**: Las imágenes se codifican en base64 para almacenamiento
3. **IDs únicos**: Cada entidad tiene un ID único generado con timestamp + random
4. **Integridad**: Validaciones en cada operación

## Posibles Extensiones Futuras

1. **Sincronización en servidor**: Guardar ejecuciones en base de datos
2. **Búsqueda y filtrado**: Buscar en ejecuciones pasadas
3. **Comparación de ejecuciones**: Comparar múltiples ejecuciones
4. **Templates de anotaciones**: Formas predefinidas para marcar
5. **Colaboración**: Compartir ejecuciones con otros usuarios
6. **Historial de cambios**: Ver versiones anteriores de imágenes
7. **Integración con herramientas de IA**: Análisis automático de evidencias

## Requisitos de Dependencias

Asegurar que están instaladas:
- `@angular/common`
- `@angular/forms`
- `docx` (para exportación DOCX)
- `file-saver` (para descargas)

## Testing

Se recomienda crear tests unitarios para:
- `ExecutionStorageService`
- `ImageEditorComponent`
- `PlanExecutionComponent`
- Métodos de exportación en `ExportService`
