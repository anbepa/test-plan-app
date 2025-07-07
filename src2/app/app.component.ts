import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import * as Papa from 'papaparse';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ExcelPreviewComponent } from './excel-preview';
import * as XLSX from 'xlsx';
import { ImageEditorComponent } from './image-editor/image-editor.component';
import { StorageService } from './storage.service';

// Declaración de tipos para que TypeScript reconozca las propiedades del plugin
declare module 'jspdf' {
  interface jsPDF {
    autoTable: (options: any) => jsPDF;
    lastAutoTable: { finalY: number };
  }
}

// Interfaces para la estructura de datos
export interface Escenario {
  'ID Caso': string;
  'Escenario de Prueba': string;
  Precondiciones: string;
  'Paso a Paso': string;
  'Resultado Esperado': string;
  evidencias: Evidencia[];
}

export interface Evidencia {
  tipo: 'img';
  nombre: string;
  data: string;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, ExcelPreviewComponent, ImageEditorComponent],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css']
})
export class AppComponent implements OnInit {
  title = 'Matriz de Casos de Prueba';
  public escenarios: Escenario[] = [];
  public escenarioActivo: number = 0;
  public excelTableData: string[][] = [];
  public showExcelPreview = false;
  public excelImageUrl: string | null = null;
  public excelTableDataPorEscenario: { [key: number]: string[][] } = {};
  public showExcelPreviewPorEscenario: { [key: number]: boolean } = {};
  public excelPreviewEscenarioActivo: number | null = null;
  public imageEditorVisible = false;
  public imageEditorData: string | null = null;
  public imageEditorEscenarioIndex: number | null = null;
  public imageEditorEvidenciaIndex: number | null = null;

  constructor(private storageService: StorageService) {} // Inyecta el servicio aquí

  ngOnInit(): void {
    const escenariosGuardados = this.storageService.cargarEscenarios();
    if (escenariosGuardados && escenariosGuardados.length > 0) {
      this.escenarios = escenariosGuardados;
    } else {
      // Si no hay nada guardado, usa los datos de ejemplo
      this.escenarios = [{
        'ID Caso': 'CP1',
        'Escenario de Prueba': 'Crear tabla con nombre válido.',
        'Precondiciones': 'El sistema de base de datos está accesible.',
        'Paso a Paso': 'Ejecutar la sentencia SQL para crear la tabla de saldos.',
        'Resultado Esperado': 'La tabla se crea exitosamente.',
        evidencias: []
      }];
    }
    this.escenarioActivo = 0;
  }

  public guardarEstado(): void {
    this.storageService.guardarEscenarios(this.escenarios);
    console.log('Estado guardado automáticamente.');
  }

  limpiarProyecto(): void {
    if (confirm('¿Estás seguro de que quieres borrar todo el proyecto? Esta acción no se puede deshacer.')) {
      this.storageService.limpiarEstado();
      window.location.reload(); // Recarga la página para empezar de cero
    }
  }

  // --- Métodos de manejo de la UI (sin cambios) ---
  seleccionarEscenario(index: number): void { this.escenarioActivo = index; }
  agregarEscenario(): void {
    const nuevoEscenario: Escenario = { 'ID Caso': `CP${this.escenarios.length + 1}`, 'Escenario de Prueba': '', 'Precondiciones': '', 'Paso a Paso': '', 'Resultado Esperado': '', evidencias: [] };
    this.escenarios.push(nuevoEscenario);
    this.escenarioActivo = this.escenarios.length - 1;
    this.guardarEstado();
  }
  eliminarEscenario(index: number): void {
    if (confirm('¿Estás seguro?')) {
      this.escenarios.splice(index, 1);
      if (this.escenarioActivo >= index && this.escenarioActivo > 0) this.escenarioActivo--;
      else if (this.escenarios.length === 0) this.escenarioActivo = 0;
      this.guardarEstado();
    }
  }
  subirEvidencias(event: Event, escenarioIndex: number): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;
    for (let i = 0; i < input.files.length; i++) {
      const file = input.files[i];
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.escenarios[escenarioIndex].evidencias.push({ tipo: 'img', nombre: file.name, data: e.target.result });
        this.guardarEstado(); // Guardar aquí
      };
      reader.readAsDataURL(file);
    }
    input.value = '';
  }
  async pegarEvidencia(escenarioIndex: number): Promise<void> {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      alert('La API del portapapeles no es compatible con este navegador.');
      return;
    }
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find(type => type.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          const reader = new FileReader();
          reader.onload = (e: any) => {
            this.escenarios[escenarioIndex].evidencias.push({
              tipo: 'img',
              nombre: `Evidencia pegada - ${new Date().toLocaleString('es-CO')}.png`,
              data: e.target.result
            });
            this.guardarEstado(); // Guardar aquí
          };
          reader.readAsDataURL(blob);
        }
      }
    } catch (err: any) {
      console.error('Error al pegar desde el portapapeles:', err);
      alert(`No se pudo pegar la imagen. Es posible que necesites conceder permisos para acceder al portapapeles. Error: ${err.message}`);
    }
  }
  eliminarEvidencia(escenarioIndex: number, evidenciaIndex: number): void {
    this.escenarios[escenarioIndex].evidencias.splice(evidenciaIndex, 1);
    this.guardarEstado();
  }
  limpiarEvidencias(escenarioIndex: number): void {
    if (confirm('¿Limpiar evidencias?')) {
      this.escenarios[escenarioIndex].evidencias = [];
      this.guardarEstado();
    }
  }
  cargarCSV(event: Event): void { /* ... sin cambios ... */ }


  // --- FUNCIÓN MEJORADA PARA GENERAR EL PDF ---

  async generarReportePDF() {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 40;
    const indiceItems: { nombre: string, page: number }[] = [];

    // ======================================================
    // 1. Portada del Documento
    // ======================================================
    doc.setFontSize(26);
    doc.text('Reporte de Matriz de Casos de Prueba', pageWidth / 2, pageHeight / 2 - 60, { align: 'center' });
    doc.setFontSize(14);
    doc.text(`Fecha de generación: ${new Date().toLocaleString('es-CO')}`, pageWidth / 2, pageHeight / 2 - 20, { align: 'center' });
    doc.text('Área: QA / Testing', pageWidth / 2, pageHeight / 2, { align: 'center' });
    doc.text('Versión: 1.0', pageWidth / 2, pageHeight / 2 + 20, { align: 'center' });

    // ======================================================
    // 2. Página de Índice (se llenará al final)
    // ======================================================
    doc.addPage();
    const pageIndex = doc.getNumberOfPages();
    doc.setFontSize(20);
    doc.text('Índice', margin, margin + 20);

    // ======================================================
    // 3. Páginas de Contenido (Loop por cada escenario)
    // ======================================================
    for (const esc of this.escenarios) {
      doc.addPage();
      const currentPage = doc.getNumberOfPages();
      indiceItems.push({ nombre: esc['ID Caso'] || 'Escenario sin ID', page: currentPage });

      autoTable(doc, {
        head: [['ID Caso', 'Escenario de Prueba', 'Precondiciones', 'Paso a Paso', 'Resultado Esperado']],
        body: [[
          esc['ID Caso'],
          esc['Escenario de Prueba'],
          esc['Precondiciones'],
          esc['Paso a Paso'],
          esc['Resultado Esperado']
        ]],
        startY: margin,
        theme: 'grid',
        headStyles: { fillColor: '#e3eafc', textColor: '#1e293b', fontStyle: 'bold' },
        styles: { cellPadding: 8, fontSize: 10 }
      });

      if (esc.evidencias && esc.evidencias.length > 0) {
        let yPos = (doc as any).lastAutoTable.finalY + 30;

        if (yPos > pageHeight - 80) {
          doc.addPage();
          yPos = margin;
        }
        doc.setFontSize(14);
        doc.setTextColor('#2563eb');
        doc.text('Evidencias:', margin, yPos);
        yPos += 20;

        for (const ev of esc.evidencias) {
          const getImg = (data: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = (err) => reject(err);
              img.src = data;
            });
          };

          try {
            const img = await getImg(ev.data);
            const imgMaxWidth = pageWidth - margin * 2;
            const aspectRatio = img.width / img.height;
            const scaledHeight = imgMaxWidth / aspectRatio;
            const pageContentHeight = pageHeight - margin * 2;

            // Decidir si la imagen necesita ser troceada
            const mustSplit = scaledHeight > pageContentHeight;

            if (!mustSplit) {
              // --- RUTA PARA IMÁGENES NORMALES (NO SE TROCEAN) ---
              const containerHeight = scaledHeight + 50; // padding + title

              if (yPos + containerHeight > pageHeight - margin) {
                doc.addPage();
                yPos = margin;
              }

              doc.setFillColor('#f5f5f5');
              doc.setDrawColor('#e0e0e0');
              doc.roundedRect(margin, yPos, imgMaxWidth, containerHeight, 5, 5, 'FD');
              doc.setFontSize(11);
              doc.setTextColor('#333');
              doc.text(ev.nombre, margin + 10, yPos + 18, { maxWidth: imgMaxWidth - 20 });
              doc.addImage(img, 'PNG', margin + 10, yPos + 30, imgMaxWidth - 20, scaledHeight, undefined, 'FAST');
              yPos += containerHeight + 20;

            } else {
              // --- RUTA PARA IMÁGENES MUY GRANDES (SE TROCEAN) ---
              if (yPos + 40 > pageHeight - margin) { // Espacio para el título
                doc.addPage();
                yPos = margin;
              }
              doc.setFontSize(11);
              doc.setTextColor('#333');
              doc.text(ev.nombre, margin, yPos, { maxWidth: imgMaxWidth });
              yPos += 20;

              let sourceY = 0;
              while (sourceY < img.height) {
                let availableHeight = pageHeight - yPos - margin;
                if (availableHeight <= 20) {
                  doc.addPage();
                  yPos = margin;
                  availableHeight = pageHeight - yPos - margin;
                }

                const sliceHeightOnPdf = availableHeight;
                const sliceHeightOnSource = (sliceHeightOnPdf / scaledHeight) * img.height;
                const remainingSourceHeight = img.height - sourceY;
                const currentSliceSourceHeight = Math.min(sliceHeightOnSource, remainingSourceHeight);
                const currentSlicePdfHeight = (currentSliceSourceHeight / img.height) * scaledHeight;

                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = currentSliceSourceHeight;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                  ctx.drawImage(img, 0, sourceY, img.width, currentSliceSourceHeight, 0, 0, img.width, currentSliceSourceHeight);
                  const sliceDataUrl = canvas.toDataURL('image/png');
                  doc.addImage(sliceDataUrl, 'PNG', margin, yPos, imgMaxWidth, currentSlicePdfHeight, undefined, 'FAST');
                }

                sourceY += currentSliceSourceHeight;
                yPos += currentSlicePdfHeight;

                if (sourceY < img.height) {
                  doc.addPage();
                  yPos = margin;
                }
              }
              yPos += 30;
            }
          } catch (e) {
            console.error(`Error al procesar imagen: ${ev.nombre}`, e);
            if (yPos > pageHeight - 100) { doc.addPage(); yPos = margin; }
            doc.setTextColor('#ff0000');
            doc.text(`Error al cargar imagen: ${ev.nombre}`, margin, yPos + 20);
            yPos += 40;
          }
        }
      }
    }

    // ======================================================
    // 4. Página de Firmas
    // ======================================================
    doc.addPage();
    doc.setFontSize(20);
    doc.text('Firmas y Validaciones', margin, margin + 20);
    doc.setFontSize(12);
    doc.text('Responsable QA:', margin, margin + 80);
    doc.line(margin + 120, margin + 75, margin + 400, margin + 75);
    doc.text('Revisor:', margin, margin + 140);
    doc.line(margin + 70, margin + 135, margin + 400, margin + 135);
    doc.text('Aprobador:', margin, margin + 200);
    doc.line(margin + 85, margin + 195, margin + 400, margin + 195);

    // ======================================================
    // 5. Paginación y llenado del Índice
    // ======================================================
    const totalPages = doc.getNumberOfPages();
    doc.setPage(pageIndex);
    let yPosIndex = margin + 50;
    for (const item of indiceItems) {
      if (yPosIndex > pageHeight - margin) {
        doc.addPage();
        yPosIndex = margin;
      }
      const dots = '.'.repeat(120);
      doc.text(`${item.nombre} ${dots} ${item.page}`, margin, yPosIndex, { maxWidth: pageWidth - margin * 2 });
      yPosIndex += 20;
    }

    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFontSize(10);
      doc.setTextColor('#888');
      doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 20, { align: 'right' });
    }
    
    // ======================================================
    // 6. Guardar el PDF
    // ======================================================
    doc.save('reporte_casos_prueba.pdf');
  }

  onExcelFileChange(event: Event, escenarioIndex: number) {
    const input = event.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      this.excelTableDataPorEscenario[escenarioIndex] = json as string[][];
      this.showExcelPreviewPorEscenario[escenarioIndex] = true;
      this.excelPreviewEscenarioActivo = escenarioIndex;
    };
    reader.readAsArrayBuffer(file);
  }

  onExcelImageReadyPorEscenario(imageUrl: string, escenarioIndex: number) {
    this.escenarios[escenarioIndex].evidencias.push({ tipo: 'img', nombre: 'Excel convertido', data: imageUrl });
    this.showExcelPreviewPorEscenario[escenarioIndex] = false;
    this.excelPreviewEscenarioActivo = null;
    this.guardarEstado();
  }

  openImageEditor(escenarioIndex: number, evidenciaIndex: number) {
    this.imageEditorEscenarioIndex = escenarioIndex;
    this.imageEditorEvidenciaIndex = evidenciaIndex;
    this.imageEditorData = this.escenarios[escenarioIndex].evidencias[evidenciaIndex].data;
    this.imageEditorVisible = true;
  }

  closeImageEditor() {
    this.imageEditorVisible = false;
    this.imageEditorData = null;
    this.imageEditorEscenarioIndex = null;
    this.imageEditorEvidenciaIndex = null;
  }

  saveImageEditor(editedData: string) {
    if (this.imageEditorEscenarioIndex !== null && this.imageEditorEvidenciaIndex !== null) {
      this.escenarios[this.imageEditorEscenarioIndex].evidencias[this.imageEditorEvidenciaIndex].data = editedData;
      this.guardarEstado();
    }
    this.closeImageEditor();
  }
}
