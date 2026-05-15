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
  
  isDragging = false;
  isProcessing = false;
  isExistingHU = false;
  huFeedback = '';
  
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
    try {
      for (const file of fileList) {
        if (file.type.startsWith('image/')) {
          const base64 = await this.readFileAsDataURL(file);
          this.files.push({
            name: file.name,
            type: file.type,
            dataURL: base64,
            isVideo: false,
            size: file.size
          });
        }
      }
      
      // Ordenar por nombre para asegurar secuencia cronológica (como en el proyecto de referencia)
      this.files.sort((a, b) => a.name.localeCompare(b.name));
      
      // Actualizar selección para incluir todos los nuevos (o todos)
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
      this.files.push({
        name: `Captura_${new Date().getTime()}.png`,
        type: 'image/png',
        dataURL: dataUrl,
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
    this.toast.info('Generando análisis con IA...');

    const selectedFiles = this.selectedIndices.map(i => this.files[i]);
    
    try {
      const result = await this.analysisService.analyzeEvidences(this.additionalContext, selectedFiles).toPromise();
      console.log('Analysis Result:', result);
      
      // 1. Asegurar o crear la HU en la tabla de evidencias
      await this.dbService.getOrCreateEvidenceHU(this.huNumber, this.testTitle);
      
      // 2. Guardar el reporte
      const reportId = await this.dbService.saveEvidenceReport(result, selectedFiles, this.huNumber);
      
      this.toast.success('Análisis generado y guardado exitosamente');
      
      // Navegar a la vista de detalle del reporte (que crearemos a continuación)
      // Por ahora, si no existe la ruta, al menos no dará el error de "0 rows" en el viewer
      this.router.navigate(['/evidence-analysis/report', reportId]);
    } catch (e: any) {
      console.error(e);
      this.toast.error('Error al generar el análisis: ' + e.message);
    } finally {
      this.isProcessing = false;
    }
  }
}
