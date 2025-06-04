// anbepa/test-plan-app/test-plan-app-114d3b7ac03726fd5931cc480f86ec71001e021a/src/app/image-annotation-editor/image-annotation-editor.component.ts
// src/app/image-annotation-editor/image-annotation-editor.component.ts
import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageAnnotation } from '../models/hu-data.model';

export interface AnnotationEditorOutput {
  annotations: ImageAnnotation[];
  annotatedImageDataUrl: string | null; 
  originalImageFilename: string;
}

@Component({
  selector: 'app-image-annotation-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './image-annotation-editor.component.html',
  styleUrls: ['./image-annotation-editor.component.css']
})
export class ImageAnnotationEditorComponent implements AfterViewInit, OnChanges {
  @Input() imageUrl: string | ArrayBuffer | null = null;
  @Input() existingAnnotations: ImageAnnotation[] = [];
  @Input() currentImageFilename: string = 'imagen_desconocida.png';
  @Input() imageMimeType: string | undefined = 'image/png'; // Added input for MIME type
  
  @Output() annotationsApplied = new EventEmitter<AnnotationEditorOutput>();
  @Output() editorClosed = new EventEmitter<void>();

  @ViewChild('canvasElement') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('baseImageElement') baseImageRef!: ElementRef<HTMLImageElement>;
  
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private image!: HTMLImageElement;

  currentAnnotations: ImageAnnotation[] = [];
  selectedAnnotationIndex: number | null = null;
  isDrawing: boolean = false;
  startX!: number; // Normalized
  startY!: number; // Normalized

  constructor() {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existingAnnotations']) {
      this.currentAnnotations = JSON.parse(JSON.stringify(changes['existingAnnotations'].currentValue || []));
      this.currentAnnotations.forEach(ann => {
        ann.imageFilename = this.currentImageFilename; 
      });
      this.drawCanvas();
    }
    if (changes['imageUrl'] && changes['imageUrl'].currentValue) {
      this.loadImage();
    }
     if (changes['currentImageFilename'] && this.currentAnnotations) {
        this.currentAnnotations.forEach(ann => ann.imageFilename = this.currentImageFilename);
    }
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
        this.canvas = this.canvasRef.nativeElement;
        const context = this.canvas.getContext('2d');
        if (context) {
            this.ctx = context;
            this.loadImage();

            this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
            this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
            this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
            this.canvas.addEventListener('mouseout', this.onMouseUp.bind(this));
        } else {
            console.error('Failed to get 2D context from canvas');
        }
    } else {
        console.error('CanvasRef is not available in AfterViewInit');
    }
  }

  loadImage(): void {
    if (!this.imageUrl || !this.ctx) {
      return;
    }
    this.image = new Image();
    this.image.onload = () => {
      if (this.baseImageRef && this.baseImageRef.nativeElement) {
        this.canvas.width = this.baseImageRef.nativeElement.naturalWidth || this.baseImageRef.nativeElement.width;
        this.canvas.height = this.baseImageRef.nativeElement.naturalHeight || this.baseImageRef.nativeElement.height;
      } else {
        this.canvas.width = this.image.naturalWidth;
        this.canvas.height = this.image.naturalHeight;
      }
      this.drawCanvas();
    };
    this.image.onerror = (error) => {
      console.error('Error loading image for annotation editor:', error);
    };
    this.image.src = this.imageUrl as string;
  }

  drawCanvas(): void {
    if (!this.ctx || !this.image || !this.image.complete || this.image.naturalHeight === 0) {
        return;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);

    this.currentAnnotations.forEach((ann, index) => {
      this.drawRectangle(ann, index === this.selectedAnnotationIndex);
    });
  }

  drawRectangle(annotation: ImageAnnotation, isSelected: boolean = false): void {
    if (!this.ctx || !this.canvas) return;
    const { x, y, width, height, description, sequence } = annotation;
    
    const rectX = x * this.canvas.width;
    const rectY = y * this.canvas.height;
    const rectWidth = width * this.canvas.width;
    const rectHeight = height * this.canvas.height;

    this.ctx.strokeStyle = isSelected ? 'blue' : 'red';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);

    this.ctx.fillStyle = 'white'; 
    const text = `${sequence}: ${description ? description.substring(0, 20) + (description.length > 20 ? '...' : '') : 'Sin desc.'}`;
    const textMetrics = this.ctx.measureText(text);
    const textBgPadding = 2;
    this.ctx.fillRect(rectX, rectY - 16 - textBgPadding, textMetrics.width + (2 * textBgPadding), 16 + (2 * textBgPadding));
    
    this.ctx.fillStyle = isSelected ? 'blue' : 'red';
    this.ctx.font = '12px Arial';
    this.ctx.fillText(text, rectX + textBgPadding, rectY - textBgPadding - 2);
  }

  onMouseDown(event: MouseEvent): void {
    if(!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const clickX = (event.clientX - rect.left);
    const clickY = (event.clientY - rect.top);

    this.selectedAnnotationIndex = null;
    for (let i = this.currentAnnotations.length - 1; i >= 0; i--) { 
      const ann = this.currentAnnotations[i];
      const annCanvasX = ann.x * this.canvas.width;
      const annCanvasY = ann.y * this.canvas.height;
      const annCanvasWidth = ann.width * this.canvas.width;
      const annCanvasHeight = ann.height * this.canvas.height;

      if (clickX >= annCanvasX && clickX <= annCanvasX + annCanvasWidth &&
          clickY >= annCanvasY && clickY <= annCanvasY + annCanvasHeight) {
        this.selectedAnnotationIndex = i;
        this.isDrawing = false; 
        this.startX = clickX / this.canvas.width; 
        this.startY = clickY / this.canvas.height;
        this.drawCanvas();
        return;
      }
    }
    
    this.isDrawing = true;
    this.startX = clickX / this.canvas.width;
    this.startY = clickY / this.canvas.height;
    this.drawCanvas(); 
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.isDrawing) return; 
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentX = (event.clientX - rect.left) / this.canvas.width;
    const currentY = (event.clientY - rect.top) / this.canvas.height;

    this.drawCanvas(); 

    const tempWidth = (currentX - this.startX) * this.canvas.width;
    const tempHeight = (currentY - this.startY) * this.canvas.height;
    this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(this.startX * this.canvas.width, this.startY * this.canvas.height, tempWidth, tempHeight);
  }

  onMouseUp(event: MouseEvent): void {
    if (!this.isDrawing) {
      this.isDrawing = false; 
      return;
    }
    this.isDrawing = false;
    if (!this.canvas) return;

    const rect = this.canvas.getBoundingClientRect();
    const endX = (event.clientX - rect.left) / this.canvas.width;
    const endY = (event.clientY - rect.top) / this.canvas.height;

    const newWidth = Math.abs(endX - this.startX);
    const newHeight = Math.abs(endY - this.startY);

    if (newWidth > 0.01 && newHeight > 0.01) { 
      const newX = Math.min(this.startX, endX);
      const newY = Math.min(this.startY, endY);
      this.currentAnnotations.push({
        sequence: this.currentAnnotations.length + 1,
        description: `Anotación ${this.currentAnnotations.length + 1}`,
        x: newX,
        y: newY,
        width: newWidth,
        height: newHeight,
        imageFilename: this.currentImageFilename
      });
    }
    this.drawCanvas();
  }

  addAnnotation(): void {
    this.currentAnnotations.push({
      sequence: this.currentAnnotations.length + 1,
      description: `Anotación ${this.currentAnnotations.length + 1}`,
      x: 0.1, y: 0.1, width: 0.2, height: 0.1, 
      imageFilename: this.currentImageFilename
    });
    this.drawCanvas();
  }

  removeAnnotation(index: number): void {
    this.currentAnnotations.splice(index, 1);
    this.currentAnnotations.forEach((ann, i) => ann.sequence = i + 1);
    this.selectedAnnotationIndex = null;
    this.drawCanvas();
  }

  getAnnotatedImageDataUrl(): string | null {
    if (!this.canvas || !this.image || !this.image.complete || this.image.naturalHeight === 0) {
      return null;
    }
    this.drawCanvas(); // Ensure it's current
    try {
      // Use the provided mimeType or fallback to 'image/png'
      return this.canvas.toDataURL(this.imageMimeType || 'image/png');
    } catch (e) {
      console.error("Error generating data URL from canvas:", e);
      return null;
    }
  }

  saveAnnotationsAndClose(): void {
    const annotatedImageDataUrl = this.getAnnotatedImageDataUrl();
    this.annotationsApplied.emit({
      annotations: JSON.parse(JSON.stringify(this.currentAnnotations)), 
      annotatedImageDataUrl: annotatedImageDataUrl,
      originalImageFilename: this.currentImageFilename
    });
    this.editorClosed.emit();
  }

  cancelAndClose(): void {
    this.editorClosed.emit();
  }
}