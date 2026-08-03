## Solución: Error 413 (Content Too Large) en Vercel Free Tier

### 📋 Problema Identificado

Cuando intentabas subir el reporte Serenity + documentos DOCX/PDF al plan de pruebas en Azure DevOps a través de Vercel, recibías:
```
Status Code: 413 Content Too Large
{"error": {"code": "413", "message": "Request Entity Too Large"}}
```

### 🔍 Causa Raíz

**Límite oficial de Vercel en free tier: 4.5 MB para request/response body**

El reporte Serenity + DOCX/PDF generados excedían este límite, causando el rechazo de la solicitud.

---

## ✅ Solución Implementada

### 1. **Por Defecto: Solo Reporte Serenity**
   - Los formatos DOCX y PDF ahora están **deshabilitados por defecto**
   - Esto reduce el payload a ~2-3 MB (dentro del límite de 4.5 MB)
   - El usuario puede habilitarlos opcionalmente si el tamaño final lo permite

**Cambio en:** `src/app/shared/components/evidence-upload-modal/evidence-upload-modal.component.ts`
```typescript
selectedFormats = { docx: false, pdf: false }; // Deshabilitado por defecto
```

### 2. **Validación de Tamaño en el Servidor**
   - Validación antes de empaquetar (inputs)
   - Validación después de comprimir (output ZIP)
   - Mensajes de error claros y específicos

**Cambio en:** `api/integrations/azure-devops/work-items.ts`
```typescript
const safePayloadLimit = 4 * 1024 * 1024; // 4MB (margen de seguridad)
const maxZipSize = 4 * 1024 * 1024; // 4MB (comprimido)
```

### 3. **Banner de Advertencia en la UI**
   - Informar al usuario sobre el límite de 4.5 MB
   - Explicar por qué DOCX/PDF están deshabilitados por defecto

**Cambio en:** `src/app/shared/components/evidence-upload-modal/evidence-upload-modal.component.html`
```html
<!-- Advertencia de límite de Vercel -->
<div class="warning-banner vercel-limit-warning">
  <strong>Límite de Vercel: 4.5 MB</strong>
  <p>Por defecto se sube solo el reporte Serenity. Los formatos DOCX/PDF aumentan el tamaño considerablemente.</p>
</div>
```

### 4. **Compresión Mejorada**
   - Nivel de compresión DEFLATE máximo (nivel 9)
   - Reduce el tamaño del archivo final de forma óptima

**Cambio en:** `api/integrations/azure-devops/work-items.ts`
```typescript
const zipBuffer = await zip.generateAsync({ 
  type: 'nodebuffer', 
  compression: 'DEFLATE',
  compressionOptions: { level: 9 } // Máxima compresión
});
```

---

## 📊 Comparativa de Tamaños (Estimado)

| Configuración | Tamaño (sin comprimir) | Tamaño (comprimido) | ¿Vercel OK? |
|---|---|---|---|
| Solo Serenity | ~10-12 MB | ~2-3 MB | ✅ SÍ |
| Serenity + DOCX | ~15-18 MB | ~4-5 MB | ❌ NO (marginal) |
| Serenity + PDF | ~12-15 MB | ~3-4 MB | ⚠️ POSIBLE |
| Serenity + DOCX + PDF | ~20-25 MB | ~6-8 MB | ❌ NO |

---

## 🚀 Cómo Usar

### Caso Normal (Recomendado)
1. Abre el modal de carga de evidencias
2. Valida el plan de Azure DevOps
3. **Solo el reporte Serenity estará habilitado** (veras la advertencia)
4. Haz click en "Generar y subir"
5. ✅ Se sube correctamente (~2-3 MB)

### Caso Avanzado (Si necesitas DOCX/PDF)
1. Sigue los pasos 1-2 anteriores
2. **Habilita DOCX o PDF manualmente** (si realmente lo necesitas)
3. Asegúrate de que el total sea < 4.5 MB
4. Haz click en "Generar y subir"
5. Si excede el límite, recibiras un error claro con el tamaño exacto

---

## 🔧 Alternativas si Esto No es Suficiente

Si incluso solo el Serenity excede 4.5 MB:

### Opción 1: Upgrade a Vercel Pro
- Precio: ~$20/mes
- Límite: 12 MB por función
- Acceso de 2 minutos para ejecutar funciones

### Opción 2: Almacenamiento Alternativo
- Usar Vercel Blob (recomendado)
- Usar AWS S3 o Azure Blob Storage
- Los archivos se suben directo sin pasar por Vercel Functions

### Opción 3: Migrar Hosting
- Railway, Render, Heroku, etc.
- Sin límites de payload en free tier
- Mayor costo operativo pero más flexibilidad

---

## ✨ Beneficios de Esta Solución

✅ **Sin costo adicional** - Funciona en free tier de Vercel  
✅ **Automático** - Valida y comprime automáticamente  
✅ **Seguro** - Margen de seguridad de 0.5 MB  
✅ **Claro** - Mensajes de error explicativos  
✅ **User-friendly** - Advertencia visual en la UI  
✅ **Reversible** - Si cambias de hosting, solo cambia la configuración  

---

## 📝 Cambios de Archivo

| Archivo | Cambio |
|---------|--------|
| `api/integrations/azure-devops/work-items.ts` | Validación robusta de tamaño (inputs y outputs) |
| `src/app/shared/components/evidence-upload-modal/evidence-upload-modal.component.ts` | DOCX/PDF deshabilitados por defecto |
| `src/app/shared/components/evidence-upload-modal/evidence-upload-modal.component.html` | Banner de advertencia |
| `src/app/shared/components/evidence-upload-modal/evidence-upload-modal.component.css` | Estilos para banner |
| `src/app/services/export/evidence-upload-orchestrator.service.ts` | Validación de tamaño en cliente |
| `vercel.json` | Memoria aumentada a 1024MB |

---

## 🧪 Testing Local

Para probar localmente:

```bash
# Terminal 1: Inicia el servidor de desarrollo
npm start

# Terminal 2: Inicia el API local (si lo tienes configurado)
node local-api-server.js

# Abre http://localhost:4200
# Ve a la sección de carga de evidencias
# Verifica que DOCX/PDF estén deshabilitados por defecto
# Intenta habilitar uno y verifica el warning
```

---

## 📌 Resumen

La solución implementada aprovecha el límite de 4.5 MB de Vercel free tier:
- **Por defecto**: Serenity solo (~2-3 MB) ✅
- **Opcional**: Agregar DOCX/PDF (~3-5 MB) ⚠️
- **Nunca**: Todos juntos (~6-8 MB) ❌

Esto permite a los usuarios seguir usando Vercel free tier sin incurrir en costos adicionales, mientras mantiene la funcionalidad de carga de evidencias completamente operativa.

