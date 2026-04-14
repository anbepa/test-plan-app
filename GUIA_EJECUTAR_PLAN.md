# 🚀 Guía de Uso: Ejecutar Plan de Pruebas

## Introducción

La nueva funcionalidad **"Ejecutar Plan"** te permite ejecutar los pasos de tu plan de pruebas directamente en la aplicación, con la capacidad de:

✅ Subir imágenes como evidencias  
✅ Editar imágenes con herramientas de anotación (pintar, círculos, líneas)  
✅ Cambiar el estado de cada paso (Pendiente, En Progreso, Completado, Falló)  
✅ Agregar notas por paso  
✅ Guardar todo en localStorage automáticamente  
✅ Descargar la ejecución completa en formato DOCX  

---

## 1️⃣ Acceder a la Ejecución

### Desde la Vista de Escenarios:
1. Navega a **"Ver escenarios de prueba"** de una HU
2. Haz clic en el botón morado **"▶ Ejecutar Plan"**
3. Se abrirá la interfaz de ejecución

---

## 2️⃣ Interfaz Principal

La pantalla se divide en dos secciones:

### Panel Izquierdo - Casos de Prueba
- Lista todos los casos de prueba
- Indicador visual del estado (⭕ Pendiente, ⟳ En Progreso, ✓ Completado, ✕ Falló)
- Haz clic para seleccionar un caso

### Panel Derecho - Detalles del Paso
- Información del precondiciones
- Resultado esperado
- Lista de pasos como botones
- Detalles completos del paso seleccionado

---

## 3️⃣ Ejecutar Pasos

### Cambiar Estado del Paso:
1. Selecciona un caso de prueba (panel izquierdo)
2. Selecciona un paso (en la lista de pasos)
3. Elige el estado:
   - **◯ Pendiente**: Paso no iniciado
   - **⟳ En Progreso**: Estoy ejecutando el paso
   - **✓ Completado**: Paso realizado exitosamente
   - **✕ Falló**: El paso falló o encontró un problema

---

## 4️⃣ Agregar Evidencias (Imágenes)

### Subir una Imagen:
1. En la sección "Evidencias" del paso
2. Haz clic en **"+ Subir Imagen"**
3. Selecciona una imagen de tu computadora
4. Se abrirá el editor de imágenes

### Agregar Múltiples Evidencias:
- Puedes subir varias imágenes por paso
- Verás todas en una galería
- Cada imagen muestra la fecha/hora en que se subió

---

## 5️⃣ Editor de Imágenes

El editor integrado te permite anotar y marcar tus imágenes.

### Herramientas Disponibles:

| Herramienta | Uso | Acceso |
|-------------|-----|--------|
| ✏️ Bolígrafo | Dibuja líneas libres | Clic en "Bolígrafo" |
| 📏 Línea | Dibuja líneas rectas | Clic en "Línea" |
| ⭕ Círculo | Dibuja círculos | Clic en "Círculo" |
| ▭ Rectángulo | Dibuja rectángulos | Clic en "Rectángulo" |
| 🗑️ Borrador | Borra partes de la imagen | Clic en "Borrador" |

### Controles:

1. **Color**: 
   - Abre el selector de color
   - Elige el color que deseas (rojo por defecto)
   - No disponible para el borrador

2. **Tamaño**: 
   - Slider de 1 a 20 píxeles
   - Más alto = más grueso

3. **Acciones**:
   - **🔄 Limpiar**: Vuelve a la imagen original
   - **💾 Guardar**: Guarda los cambios
   - **⬇️ Descargar**: Descarga la imagen PNG editada

### Cómo Dibujar:
1. Selecciona la herramienta
2. Para herramientas de forma (círculo, rectángulo, línea):
   - Haz clic y arrastra desde el punto inicial al final
3. Para bolígrafo y borrador:
   - Arrastra sobre la imagen para dibujar

---

## 6️⃣ Agregar Notas

### Por Paso:
- En la sección "Notas" del paso
- Escribe comentarios sobre lo que observas o cualquier problema

### Guardar:
- Haz clic en **"💾 Guardar"** en los botones de navegación
- O navega a otro paso (se guarda automáticamente)

---

## 7️⃣ Gestionar Imágenes

### Ver Imágenes:
- Se muestran en una galería en la sección de evidencias
- Thumbnail de cada imagen

### Editar Imagen:
- Haz clic en la imagen o en el botón **✏️**
- Se abre el editor nuevamente
- Realiza cambios y guarda

### Eliminar Imagen:
- Haz clic en el botón **🗑️** en la imagen
- Se elimina inmediatamente

---

## 8️⃣ Navegación entre Pasos

### Botones de Navegación:
- **← Anterior**: Va al paso anterior (deshabilitado en el primero)
- **💾 Guardar**: Guarda la ejecución actual
- **Siguiente →**: Va al siguiente paso

### Saltos Directos:
- Haz clic en cualquier paso de la lista
- O en cualquier caso de prueba del panel izquierdo

---

## 9️⃣ Barra de Progreso

En la cabecera se muestra:
- **Pasos completados**: X/Y Pasos
- **Total de evidencias**: Número de imágenes subidas
- **Barra de progreso**: Representación visual del avance

---

## 🔟 Descargar Ejecución

### Formato DOCX:
1. Completa la ejecución del plan
2. Haz clic en **"📄 Descargar Ejecución (.docx)"**
3. Se descargará un archivo Word con:
   - Título de la HU
   - Fechas de creación y actualización
   - Todos los casos de prueba
   - Todos los pasos con estado
   - **Todas las imágenes incrustadas**
   - Notas por paso

El documento está listo para:
- 📊 Compartir con el equipo
- 📋 Adjuntar a reportes
- 🔍 Auditoría y revisión

---

## 1️⃣1️⃣ Gestionar Ejecuciones

### Barra de Acciones (Abajo):

1. **📄 Descargar Ejecución (.docx)**
   - Exporta todo en formato Word

2. **🔄 Nueva Ejecución**
   - Reinicia la ejecución del mismo HU
   - Los datos anteriores se conservan

3. **🗑️ Eliminar Ejecución**
   - Borra la ejecución actual
   - Solicita confirmación
   - No se puede deshacer

---

## 💾 Almacenamiento

### Automático:
- Los cambios se guardan en **localStorage** de tu navegador
- Se conservan entre sesiones
- No necesita conexión a internet

### Datos Guardados:
- Estados de pasos
- Notas
- Imágenes (en base64)
- Fechas de creación/actualización

### ⚠️ Limitaciones:
- localStorage tiene límite (~5-10MB por sitio)
- Borrar datos del navegador elimina todo
- Específico por navegador (no sincroniza entre dispositivos)

---

## 🎯 Casos de Uso

### Caso 1: Tester Ejecutando Pruebas
1. Abre el plan de pruebas
2. Ejecuta cada paso
3. Captura pantallas evidenciando el resultado
4. Anota observaciones
5. Descarga el DOCX con todo listo

### Caso 2: Revisión de QA
1. Tester carga su ejecución
2. Revisa en línea sin necesidad de descargar
3. Agrega comentarios en notas
4. Verifica las evidencias

### Caso 3: Documentación de Defectos
1. Si un paso falla, marca como "✕ Falló"
2. Captura el error
3. Anota qué salió mal
4. Descarga para reportar

---

## 🐛 Solución de Problemas

### Las imágenes no se guardan
- Verifica que localStorage esté habilitado
- Comprueba si el navegador tiene espacio disponible
- Intenta con una imagen más pequeña

### El editor de imágenes no dibuja
- Verifica que estés seleccionando una herramienta
- Intenta cambiar el color o tamaño
- Recarga la página si falla

### Pérdida de datos
- Los datos se almacenan localmente
- Si borras datos del navegador, se pierden
- **No hay recuperación** - descarga regularmente

### Performance lento con muchas imágenes
- Reduce el tamaño de las imágenes antes de subir
- Comprime imágenes grandes
- Limpia ejecuciones antiguas

---

## 💡 Tips y Trucos

✨ **Guardar Regularmente**
- No esperes a terminar todo para guardar
- Haz clic en "Guardar" frecuentemente

✨ **Herramienta de Línea**
- Usa para marcar áreas específicas en pantallazos
- Efectivo para señalar errores

✨ **Colores para Diferenciar**
- Rojo para errores
- Verde para áreas correctas
- Azul para señalaciones especiales

✨ **Descargar Periódicamente**
- Descarga una versión DOCX cada cierto tiempo
- Así tienes respaldo fuera del navegador

✨ **Notas Claras**
- Escribe notas descriptivas
- Útil para quien revise después

---

## 📱 Dispositivos Móviles

La interfaz es **responsive** pero ten en cuenta:
- Pantallas pequeñas: editor de imágenes ajustado
- Touch: dibuja con el dedo (puede no ser muy preciso)
- Recomendado: usar en desktop para mejor control

---

## ❓ Preguntas Frecuentes

**P: ¿Se pierde la ejecución si cierro el navegador?**
R: No, se guarda en localStorage. Pero si usas "Limpiar datos de navegación", se perderá.

**P: ¿Puedo usar en múltiples dispositivos?**
R: No, cada dispositivo tiene su propio localStorage.

**P: ¿Hay límite de imágenes?**
R: Técnicamente no, pero localStorage tiene límite (5-10MB).

**P: ¿Se puede recuperar una ejecución eliminada?**
R: No, la eliminación es permanente.

**P: ¿Puedo editar las imágenes después de guardar?**
R: Sí, haz clic en la imagen para abrirla en el editor de nuevo.

---

## 📞 Soporte

Si encuentras problemas:
1. Verifica que localStorage esté habilitado
2. Prueba en otro navegador
3. Comprueba que el navegador esté actualizado
4. Intenta limpiar caché (mantén los datos del sitio)

---

**¡Listo para ejecutar tus planes de prueba! 🎉**
