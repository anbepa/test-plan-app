import { Component, ElementRef, ViewChild, NgZone } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { EvidenceAnalysisService, EvidenceFile } from '../services/ai/evidence-analysis.service';
import { DatabaseService, DbTestCaseWithRelations } from '../services/database/database.service';
import { EvidenceDatabaseService } from '../services/database/evidence-database.service';
import { ToastService } from '../services/core/toast.service';
import { Router } from '@angular/router';
import { ImageEditorComponent } from '../test-plan-viewer/components/image-editor/image-editor.component';


@Component({
  selector: 'app-evidence-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule, ImageEditorComponent],
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
  previewIndex: number = -1;

  // Reordering
  draggedItemIndex: number | null = null;

  // Screen Projection
  isProjecting = false;
  projectionStream: MediaStream | null = null;
  captureCount = 0;
  isCapturing = false;
  projectionMinimized = false;

  @ViewChild('fileInput') fileInput!: ElementRef;
  @ViewChild('projectionVideo') projectionVideo!: ElementRef<HTMLVideoElement>;

  constructor(
    private analysisService: EvidenceAnalysisService,
    private dbService: EvidenceDatabaseService,
    private toast: ToastService,
    private router: Router,
    private ngZone: NgZone
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

  getBuiltContext(): string {
    return this.additionalContext.trim();
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

  openPreview(index: number, event: Event) {
    event.stopPropagation();
    this.previewIndex = index;
    this.previewUrl = this.files[index].dataURL;
    this.showPreview = true;
  }

  onImageSaved(event: { base64: string, stateJson: string }) {
    if (this.previewIndex !== -1 && this.files[this.previewIndex]) {
      this.files[this.previewIndex].dataURL = event.base64;
      this.toast.success('Imagen editada correctamente');
      this.showPreview = false;
      this.previewIndex = -1;
    }
  }

  getExtension(filename: string): string {
    if (!filename) return 'IMG';
    const parts = filename.split('.');
    return parts.length > 1 ? parts.pop()!.toUpperCase() : 'IMG';
  }

  async startProjection() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false
      } as any);

      this.projectionStream = stream;
      this.isProjecting = true;
      this.captureCount = 0;
      this.projectionMinimized = false;

      // Listen for when user stops sharing via browser UI
      const track = stream.getVideoTracks()[0];
      track.onended = () => {
        this.ngZone.run(() => {
          this.stopProjection();
        });
      };

      // Wait for the video element to be rendered, then attach the stream
      setTimeout(() => {
        if (this.projectionVideo?.nativeElement) {
          this.projectionVideo.nativeElement.srcObject = stream;
        }
      }, 100);

      this.toast.success('Proyección iniciada. Captura las evidencias que necesites.');
    } catch (e: any) {
      if (e.name !== 'NotAllowedError') {
        console.error(e);
        this.toast.error('No se pudo iniciar la proyección de pantalla');
      }
    }
  }

  stopProjection() {
    if (this.projectionStream) {
      this.projectionStream.getTracks().forEach(track => track.stop());
      this.projectionStream = null;
    }
    this.isProjecting = false;
    if (this.captureCount > 0) {
      this.toast.info(`Proyección finalizada. ${this.captureCount} capturas añadidas.`);
    }
  }

  toggleProjectionMinimize() {
    this.projectionMinimized = !this.projectionMinimized;
  }

  async captureFromProjection() {
    if (!this.projectionStream || this.isCapturing) return;
    this.isCapturing = true;

    try {
      const video = this.projectionVideo.nativeElement;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(video, 0, 0);
      const dataUrl = canvas.toDataURL('image/png');
      const compressedDataUrl = await this.compressImage(dataUrl);

      this.captureCount++;
      const timestamp = new Date();
      const timeStr = timestamp.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      this.files.push({
        name: `Captura_${this.captureCount}_${timeStr.replace(/:/g, '-')}.jpg`,
        type: 'image/jpeg',
        dataURL: compressedDataUrl,
        isVideo: false,
        size: compressedDataUrl.length
      });
      this.selectedIndices.push(this.files.length - 1);

      this.toast.success(`📸 Captura ${this.captureCount} añadida`);
    } catch (e) {
      console.error(e);
      this.toast.error('Error al capturar la pantalla');
    } finally {
      this.isCapturing = false;
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
      const builtContext = this.getBuiltContext();
      const result = await this.analysisService.analyzeEvidences(builtContext, selectedFiles).toPromise();
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
