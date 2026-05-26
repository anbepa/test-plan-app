import { Component, ElementRef, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EvidenceAnalysisService, EvidenceFile } from '../services/ai/evidence-analysis.service';
import { DatabaseService, DbTestCaseWithRelations } from '../services/database/database.service';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { ToastService } from '../services/core/toast.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-evidence-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './evidence-analysis.component.html',
  styleUrls: ['./evidence-analysis.component.css']
})
export class EvidenceAnalysisComponent {
  huNumber: string = '';
  testTitle: string = '';
  additionalContext: string = '';

  files: EvidenceFile[] = [];
  selectedIndices: number[] = [];

  isExistingHU = false;
  huFeedback = '';
  isDragging = false;
  isProcessing = false;

  // Preview Modal
  showPreview = false;
  previewUrl = '';

  // Reordering
  draggedItemIndex: number | null = null;

  @ViewChild('fileInput') fileInput!: ElementRef;

  constructor(
    private analysisService: EvidenceAnalysisService,
    private dbService: EvidenceDatabaseService,
    private toast: ToastService,
    private router: Router
  ) {
    this.setupPasteListener();
  }

  private setupPasteListener() {
    if (typeof window !== 'undefined') {
      window.addEventListener('paste', this.handlePaste.bind(this));
    }
  }

  ngOnDestroy() {
    if (typeof window !== 'undefined') {
      window.removeEventListener('paste', this.handlePaste.bind(this));
    }
  }

  handlePaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    const mediaItems = Array.from(items).filter(item =>
        item.type.startsWith('image/') || item.type.startsWith('video/')
    );

    if (mediaItems.length > 0) {
        event.preventDefault();
        const blobs = mediaItems.map(item => item.getAsFile()).filter(f => !!f) as File[];
        this.processFiles(blobs);
    }
  }

  onDragOver(event: DragEvent) {
    event.preventDefault();
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.isDragging = false;
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      this.processFiles(Array.from(event.dataTransfer.files));
    }
  }

  onFileSelected(event: any) {
    if (event.target.files.length > 0) {
      this.processFiles(Array.from(event.target.files));
    }
  }

  triggerFileInput() {
    this.fileInput.nativeElement.click();
  }

  async processFiles(fileList: File[]) {
    this.isProcessing = true;
    let duplicates = 0;

    try {
      for (const file of fileList) {
        // Detección de duplicados básica por nombre y tamaño
        const isDuplicate = this.files.some(f => f.name === file.name && f.size === file.size);
        if (isDuplicate) {
          duplicates++;
          continue;
        }

        const extension = file.name.split('.').pop()?.toLowerCase();
        const isCSV = extension === 'csv' || file.type === 'text/csv';
        const isXLSX = extension === 'xlsx' || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

        if (file.type.startsWith('image/')) {
          const base64 = await this.readFileAsDataURL(file);
          // Comprimir imagen antes de guardarla para evitar error 413 en Vercel
          const compressedBase64 = await this.compressImage(base64);

          this.files.push({
            name: file.name,
            type: 'image/jpeg', // Siempre convertimos a jpeg para mejor compresión
            dataURL: compressedBase64,
            isVideo: false,
            size: file.size
          });
        } else if (isCSV || isXLSX) {
          const base64 = await this.readFileAsDataURL(file);
          this.files.push({
            name: file.name,
            type: isCSV ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            dataURL: base64,
            isVideo: false,
            size: file.size
          });
        }
      }

      if (duplicates > 0) {
        this.toast.warning(`${duplicates} archivos omitidos por estar duplicados.`);
      }

      // Actualizar selección para incluir todos
      this.selectedIndices = this.files.map((_, i) => i);

    } catch (e) {
      this.toast.error('Error al procesar archivos');
    } finally {
      this.isProcessing = false;
    }
  }

  async handleHUChange(value: string) {
    this.huNumber = value.replace(/[^0-9]/g, '');
    this.huFeedback = '';
    this.isExistingHU = false;

    if (this.huNumber.length > 0) {
      try {
        const stories = await this.dbService.searchEvidenceHU(this.huNumber);
        const exactMatch = stories.find(s => s.numero?.toString() === this.huNumber);

        if (exactMatch) {
          this.testTitle = exactMatch.title;
          this.isExistingHU = true;
          this.huFeedback = 'HU encontrada en base de datos.';
        }
      } catch (e) {
        console.error('Error searching HU:', e);
      }
    }
  }

  private readFileAsDataURL(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  private async compressImage(base64: string, maxWidth = 1280, maxHeight = 1280, quality = 0.7): Promise<string> {
    return new Promise((resolve) => {
      const img = new Image();
      img.src = base64;
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > maxWidth) {
            height *= maxWidth / width;
            width = maxWidth;
          }
        } else {
          if (height > maxHeight) {
            width *= maxHeight / height;
            height = maxHeight;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Rellenar fondo blanco para JPEGs (evita fondo negro en imágenes con transparencia)
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);
        }

        // Exportamos como JPEG para reducir drásticamente el tamaño del payload
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => resolve(base64); // Fallback al original si falla
    });
  }

  toggleSelect(index: number) {
    const pos = this.selectedIndices.indexOf(index);
    if (pos > -1) {
      this.selectedIndices.splice(pos, 1);
    } else {
      this.selectedIndices.push(index);
    }
  }

  toggleSelectAll() {
    if (this.selectedIndices.length === this.files.length) {
      this.selectedIndices = [];
    } else {
      this.selectedIndices = this.files.map((_, i) => i);
    }
  }

  removeFile(index: number, event: Event) {
    event.stopPropagation();
    this.files.splice(index, 1);
    this.selectedIndices = this.selectedIndices
      .filter(i => i !== index)
      .map(i => i > index ? i - 1 : i);
  }

  // Drag & Drop Reordering
  onDragStart(index: number) {
    this.draggedItemIndex = index;
  }

  onCardDragOver(event: DragEvent) {
    event.preventDefault();
  }

  onCardDrop(index: number, event: DragEvent) {
    event.preventDefault();
    if (this.draggedItemIndex === null || this.draggedItemIndex === index) return;

    const movedItem = this.files.splice(this.draggedItemIndex, 1)[0];
    this.files.splice(index, 0, movedItem);

    // Reset selection to match new order (simplification)
    this.selectedIndices = this.files.map((_, i) => i);
    this.draggedItemIndex = null;
  }

  openPreview(url: string, event: Event) {
    event.stopPropagation();
    this.previewUrl = url;
    this.showPreview = true;
  }

  getExtension(filename: string): string {
    if (!filename) return 'IMG';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toUpperCase() : 'IMG';
  }

  async captureScreen() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const track = stream.getVideoTracks()[0];
      const imageCapture = new (window as any).ImageCapture(track);
      const bitmap = await imageCapture.grabFrame();

      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      ctx?.drawImage(bitmap, 0, 0);

      const dataUrl = canvas.toDataURL('image/png');
      const compressedDataUrl = await this.compressImage(dataUrl);

      this.files.push({
        name: `Captura_${new Date().getTime()}.jpg`,
        type: 'image/jpeg',
        dataURL: compressedDataUrl,
        isVideo: false
      });
      this.selectedIndices.push(this.files.length - 1);

      track.stop();
    } catch (e) {
      console.error(e);
      this.toast.error('No se pudo capturar la pantalla');
    }
  }

  async generateAnalysis() {
    if (this.selectedIndices.length === 0) {
      this.toast.warning('Selecciona al menos una evidencia');
      return;
    }

    if (!this.huNumber || !this.testTitle) {
      this.toast.warning('Ingresa el Nº HU y el Título de la prueba');
      return;
    }

    this.isProcessing = true;
    this.toast.info('Subiendo evidencias y analizando con IA...');

    const selectedFiles = this.selectedIndices.map(i => this.files[i]);

    try {
      // 1. Subir imágenes a Supabase Storage primero
      // Esto evita el error 413 en Vercel porque enviamos URLs en lugar de Base64 pesado
      for (const file of selectedFiles) {
        if (!file.publicUrl) {
          file.publicUrl = await this.dbService.uploadImageToStorage(file.dataURL, file.name);
        }
      }

      // 2. Generar el análisis enviando solo las URLs públicas
      const result = await this.analysisService.analyzeEvidences(this.additionalContext, selectedFiles).toPromise();
      console.log('Analysis Result:', result);

      // 3. Asegurar o crear la HU en la tabla de evidencias
      await this.dbService.getOrCreateEvidenceHU(this.huNumber, this.testTitle);

      // 4. Guardar el reporte (saveEvidenceReport reutilizará las publicUrl ya subidas)
      const reportId = await this.dbService.saveEvidenceReport(result, selectedFiles, this.huNumber);

      this.toast.success('Análisis generado y guardado exitosamente');

      this.router.navigate(['/evidence-analysis/report', reportId]);
    } catch (e: any) {
      console.error(e);
      this.toast.error('Error al generar el análisis: ' + e.message);
    } finally {
      this.isProcessing = false;
    }
  }
}
