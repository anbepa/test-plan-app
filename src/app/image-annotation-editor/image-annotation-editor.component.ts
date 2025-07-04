// src/app/image-annotation-editor/image-annotation-editor.component.ts
import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageAnnotation } from '../models/hu-data.model';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize } from 'rxjs/operators';
import { of } from 'rxjs';

export interface AnnotationEditorOutput {
  annotations: ImageAnnotation[];
  annotatedImageDataUrl: string | null;
  originalImageFilename: string;
}

type EditorAction = 'drawing' | 'moving' | 'resizing' | 'none';
type ResizeHandleType = 'topLeft' | 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left' | null;

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
  @Input() imageMimeType: string | undefined = 'image/png';

  @Output() annotationsApplied = new EventEmitter<AnnotationEditorOutput>();
  @Output() editorClosed = new EventEmitter<void>();

  @ViewChild('canvasElement') canvasRef!: ElementRef<HTMLCanvasElement>;
  @ViewChild('baseImageElement') baseImageRef!: ElementRef<HTMLImageElement>;

  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private image!: HTMLImageElement;
  private canvasRect!: DOMRect;
  public isImageLoadedAndCanvasReady = false;

  currentAnnotations: ImageAnnotation[] = [];
  selectedAnnotationIndex: number | null = null;

  private currentAction: EditorAction = 'none';
  private startXnorm!: number;
  private startYnorm!: number;
  private lastKnownMouseXnorm!: number;
  private lastKnownMouseYnorm!: number;

  private dragOffsetXnorm!: number;
  private dragOffsetYnorm!: number;

  private activeResizeHandle: ResizeHandleType = null;
  private readonly RESIZE_HANDLE_SIZE_PX = 8;
  private readonly MIN_ANNOTATION_SIZE_NORM = 0.02;

  isAnnotatingWithAI: boolean = false;
  annotatingAIIndex: number | null = null;
  aiAnnotationError: string | null = null;

  // Tipos de anotación disponibles para el dropdown
  public readonly annotationTypes: ImageAnnotation['type'][] = ['trigger', 'input', 'verification', 'observation'];

  constructor(
    private cdr: ChangeDetectorRef,
    private geminiService: GeminiService
    ) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existingAnnotations']) {
      this.currentAnnotations = JSON.parse(JSON.stringify(changes['existingAnnotations'].currentValue || []));
      if (this.isImageLoadedAndCanvasReady) { this.drawCanvas(); }
    }
    if (changes['imageUrl'] && changes['imageUrl'].currentValue) {
      this.isImageLoadedAndCanvasReady = false;
      this.loadImageAndSetupCanvas();
    }
  }

  ngAfterViewInit(): void {
    if (this.canvasRef) {
        this.canvas = this.canvasRef.nativeElement;
        const context = this.canvas.getContext('2d');
        if (context) {
            this.ctx = context;
            if (this.imageUrl) {
              this.loadImageAndSetupCanvas();
            }
        } else { console.error('Failed to get 2D context'); }
    } else { console.error('CanvasRef not available'); }
  }

  private loadImageAndSetupCanvas(): void {
    if (!this.imageUrl || !this.ctx || !this.baseImageRef) {
      return;
    }
    this.isImageLoadedAndCanvasReady = false;
    this.image = this.baseImageRef.nativeElement;
    this.image.onload = () => {
      if (!this.canvas) return;
      this.canvas.width = this.image.naturalWidth;
      this.canvas.height = this.image.naturalHeight;
      setTimeout(() => {
        if(!this.canvas) return;
        this.canvasRect = this.canvas.getBoundingClientRect();
        this.isImageLoadedAndCanvasReady = true;
        this.drawCanvas();
        this.cdr.detectChanges();
      }, 0);
    };
    if (this.image.complete) {
        this.image.onload(new Event('load'));
    }
  }

  public drawCanvas(): void {
    if (!this.isImageLoadedAndCanvasReady || !this.ctx || !this.canvas || !this.image) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);
    this.currentAnnotations.forEach((ann, index) => {
      this.drawRectangle(ann, index === this.selectedAnnotationIndex);
    });
  }

  private drawRectangle(annotation: ImageAnnotation, isSelected: boolean = false): void {
      if (!this.ctx || !this.canvas) return;
      const { x, y, width, height, description, sequence, type } = annotation;
      const rectXpx = x * this.canvas.width;
      const rectYpx = y * this.canvas.height;
      const rectWidthPx = width * this.canvas.width;
      const rectHeightPx = height * this.canvas.height;
  
      let color = 'red'; // Default for observation
      if (type === 'trigger') color = 'blue';
      if (type === 'input') color = 'orange';
      if (type === 'verification') color = 'green';
      if (isSelected) color = 'purple';

      this.ctx.strokeStyle = color;
      this.ctx.lineWidth = isSelected ? 4 : 2;
      this.ctx.strokeRect(rectXpx, rectYpx, rectWidthPx, rectHeightPx);
  
      this.ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
      const text = `${sequence}: [${type.toUpperCase()}] ${description ? description.substring(0, 25) + (description.length > 25 ? '...' : '') : '(Sin desc.)'}`;
      this.ctx.font = '12px Arial';
      const textMetrics = this.ctx.measureText(text);
      const textBgPadding = 3;
      const textBgHeight = 16 + (2 * textBgPadding);
      let textBgY = rectYpx - textBgHeight - textBgPadding;
      if (textBgY < textBgPadding) {
        textBgY = rectYpx + rectHeightPx + textBgPadding;
        if (textBgY + textBgHeight > this.canvas.height - textBgPadding) { textBgY = rectYpx + textBgPadding; }
      }
      this.ctx.fillRect(rectXpx, textBgY, textMetrics.width + (2 * textBgPadding), textBgHeight);
      this.ctx.fillStyle = color;
      this.ctx.fillText(text, rectXpx + textBgPadding, textBgY + 14 + textBgPadding / 2 );
  
      if (isSelected) { this.drawResizeHandles(annotation); }
  }

  private drawResizeHandles(annotation: ImageAnnotation): void {
    if (!this.ctx || !this.canvas) return;
    const { x, y, width, height } = annotation;
    const handleSizePx = this.RESIZE_HANDLE_SIZE_PX;
    const halfHandle = handleSizePx / 2;
    const normX = x * this.canvas.width, normY = y * this.canvas.height;
    const normWidth = width * this.canvas.width, normHeight = height * this.canvas.height;
    const handles = [
      { type: 'topLeft', px: normX, py: normY }, { type: 'top', px: normX + normWidth / 2, py: normY }, { type: 'topRight', px: normX + normWidth, py: normY },
      { type: 'left', px: normX, py: normY + normHeight / 2 }, { type: 'right', px: normX + normWidth, py: normY + normHeight / 2 },
      { type: 'bottomLeft', px: normX, py: normY + normHeight }, { type: 'bottom', px: normX + normWidth / 2, py: normY + normHeight }, { type: 'bottomRight', px: normX + normWidth, py: normY + normHeight },
    ];
    this.ctx.fillStyle = 'purple';
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 1;
    handles.forEach(handle => {
      this.ctx.fillRect(handle.px - halfHandle, handle.py - halfHandle, handleSizePx, handleSizePx);
      this.ctx.strokeRect(handle.px - halfHandle, handle.py - halfHandle, handleSizePx, handleSizePx);
    });
  }

  private getNormalizedMousePosition(event: MouseEvent): { x: number, y: number } {
    if (!this.canvas || !this.canvasRect) return { x: 0, y: 0 };
    const clickX = event.clientX - this.canvasRect.left;
    const clickY = event.clientY - this.canvasRect.top;
    return {
      x: Math.max(0, Math.min(1, clickX / this.canvasRect.width)),
      y: Math.max(0, Math.min(1, clickY / this.canvasRect.height))
    };
  }
  
  private isPointInAnnotation(mouseXnorm: number, mouseYnorm: number, annotation: ImageAnnotation): boolean {
    return mouseXnorm >= annotation.x && mouseXnorm <= annotation.x + annotation.width &&
           mouseYnorm >= annotation.y && mouseYnorm <= annotation.y + annotation.height;
  }

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    if (!this.isImageLoadedAndCanvasReady || !this.canvas || event.target !== this.canvas) return;
    event.preventDefault();
    this.canvasRect = this.canvas.getBoundingClientRect();
    const normPos = this.getNormalizedMousePosition(event);
    this.lastKnownMouseXnorm = normPos.x;
    this.lastKnownMouseYnorm = normPos.y;

    if (this.selectedAnnotationIndex !== null) {
      const selectedAnn = this.currentAnnotations[this.selectedAnnotationIndex];
      this.activeResizeHandle = this.getClickedResizeHandle(normPos.x, normPos.y, selectedAnn);
      if (this.activeResizeHandle) {
        this.currentAction = 'resizing';
        this.updateCursor();
        return;
      }
    }

    for (let i = this.currentAnnotations.length - 1; i >= 0; i--) {
      if (this.isPointInAnnotation(normPos.x, normPos.y, this.currentAnnotations[i])) {
        this.selectedAnnotationIndex = i;
        this.currentAction = 'moving';
        this.dragOffsetXnorm = normPos.x - this.currentAnnotations[i].x;
        this.dragOffsetYnorm = normPos.y - this.currentAnnotations[i].y;
        this.updateCursor();
        this.cdr.detectChanges();
        return;
      }
    }

    this.selectedAnnotationIndex = null;
    this.currentAction = 'drawing';
    this.startXnorm = normPos.x;
    this.startYnorm = normPos.y;
    this.updateCursor();
    this.cdr.detectChanges();
  }

  @HostListener('document:mousemove', ['$event'])
  onGlobalMouseMove(event: MouseEvent): void {
    if (this.currentAction === 'none' || !this.isImageLoadedAndCanvasReady) return;
    event.preventDefault();
    this.canvasRect = this.canvas.getBoundingClientRect();
    const normPos = this.getNormalizedMousePosition(event);

    if (this.currentAction === 'drawing') {
      this.drawCanvas();
      this.ctx.strokeStyle = 'rgba(128, 0, 128, 0.7)';
      this.ctx.lineWidth = 2;
      const currentRectX = Math.min(this.startXnorm, normPos.x) * this.canvas.width;
      const currentRectY = Math.min(this.startYnorm, normPos.y) * this.canvas.height;
      const currentRectWidth = Math.abs(normPos.x - this.startXnorm) * this.canvas.width;
      const currentRectHeight = Math.abs(normPos.y - this.startYnorm) * this.canvas.height;
      this.ctx.strokeRect(currentRectX, currentRectY, currentRectWidth, currentRectHeight);
    } else {
      if (this.currentAction === 'moving' && this.selectedAnnotationIndex !== null) {
        const ann = this.currentAnnotations[this.selectedAnnotationIndex];
        ann.x = normPos.x - this.dragOffsetXnorm;
        ann.y = normPos.y - this.dragOffsetYnorm;
      } else if (this.currentAction === 'resizing' && this.selectedAnnotationIndex !== null && this.activeResizeHandle) {
         const ann = this.currentAnnotations[this.selectedAnnotationIndex];
         const deltaXnorm = normPos.x - this.lastKnownMouseXnorm;
         const deltaYnorm = normPos.y - this.lastKnownMouseYnorm;
         if (this.activeResizeHandle.includes('Left')) { ann.x += deltaXnorm; ann.width -= deltaXnorm; }
         if (this.activeResizeHandle.includes('Right')) { ann.width += deltaXnorm; }
         if (this.activeResizeHandle.includes('Top')) { ann.y += deltaYnorm; ann.height -= deltaYnorm; }
         if (this.activeResizeHandle.includes('Bottom')) { ann.height += deltaYnorm; }
      }
      this.lastKnownMouseXnorm = normPos.x;
      this.lastKnownMouseYnorm = normPos.y;
      this.drawCanvas();
    }
  }

  @HostListener('document:mouseup', ['$event'])
  onGlobalMouseUp(event: MouseEvent): void {
    if (this.currentAction === 'none' || !this.isImageLoadedAndCanvasReady) return;
    if (this.currentAction === 'drawing') {
      const normPos = this.getNormalizedMousePosition(event);
      const finalX = Math.min(this.startXnorm, normPos.x);
      const finalY = Math.min(this.startYnorm, normPos.y);
      const finalWidth = Math.abs(normPos.x - this.startXnorm);
      const finalHeight = Math.abs(normPos.y - this.startYnorm);
      if (finalWidth >= this.MIN_ANNOTATION_SIZE_NORM && finalHeight >= this.MIN_ANNOTATION_SIZE_NORM) {
        this.addAnnotation(finalX, finalY, finalWidth, finalHeight);
      }
    }
    if(this.currentAction === 'resizing' && this.selectedAnnotationIndex !== null){
        const ann = this.currentAnnotations[this.selectedAnnotationIndex];
        if (ann.width < 0) { ann.x += ann.width; ann.width = Math.abs(ann.width); }
        if (ann.height < 0) { ann.y += ann.height; ann.height = Math.abs(ann.height); }
    }
    this.currentAction = 'none';
    this.activeResizeHandle = null;
    this.drawCanvas();
    this.updateCursor(event);
  }

  private updateCursor(event?: MouseEvent | null): void {
    if (!this.isImageLoadedAndCanvasReady || !this.canvas) return;
    let cursorStyle = 'crosshair';
    if (event) {
        const normPos = this.getNormalizedMousePosition(event);
        if (this.selectedAnnotationIndex !== null) {
            const handle = this.getClickedResizeHandle(normPos.x, normPos.y, this.currentAnnotations[this.selectedAnnotationIndex]);
            if (handle) {
                if (handle.includes('Top') || handle.includes('Bottom')) cursorStyle = 'ns-resize';
                else if (handle.includes('Left') || handle.includes('Right')) cursorStyle = 'ew-resize';
                if ((handle.includes('Top') && handle.includes('Left')) || (handle.includes('Bottom') && handle.includes('Right'))) cursorStyle = 'nwse-resize';
                if ((handle.includes('Top') && handle.includes('Right')) || (handle.includes('Bottom') && handle.includes('Left'))) cursorStyle = 'nesw-resize';
            } else if (this.isPointInAnnotation(normPos.x, normPos.y, this.currentAnnotations[this.selectedAnnotationIndex])) {
                cursorStyle = 'move';
            }
        }
    }
    this.canvas.style.cursor = cursorStyle;
  }

  private getClickedResizeHandle(mouseXnorm: number, mouseYnorm: number, annotation: ImageAnnotation): ResizeHandleType | null {
    const handleSizeNormX = this.RESIZE_HANDLE_SIZE_PX / this.canvasRect.width;
    const handleSizeNormY = this.RESIZE_HANDLE_SIZE_PX / this.canvasRect.height;
    
    const handles = [
        { type: 'topLeft', x: annotation.x, y: annotation.y },
        { type: 'top', x: annotation.x + annotation.width / 2, y: annotation.y },
        { type: 'topRight', x: annotation.x + annotation.width, y: annotation.y },
        { type: 'left', x: annotation.x, y: annotation.y + annotation.height / 2 },
        { type: 'right', x: annotation.x + annotation.width, y: annotation.y + annotation.height / 2 },
        { type: 'bottomLeft', x: annotation.x, y: annotation.y + annotation.height },
        { type: 'bottom', x: annotation.x + annotation.width / 2, y: annotation.y + annotation.height },
        { type: 'bottomRight', x: annotation.x + annotation.width, y: annotation.y + annotation.height }
    ];

    for (const handle of handles) {
        if (Math.abs(mouseXnorm - handle.x) < handleSizeNormX / 2 && Math.abs(mouseYnorm - handle.y) < handleSizeNormY / 2) {
            return handle.type as ResizeHandleType;
        }
    }
    return null;
  }

  public addAnnotation(x = 0.1, y = 0.1, width = 0.2, height = 0.1): void {
    if (!this.isImageLoadedAndCanvasReady) return;
    const newAnnotation: ImageAnnotation = {
      sequence: this.currentAnnotations.length + 1,
      description: `Anotación ${this.currentAnnotations.length + 1}`,
      x, y, width, height,
      type: 'observation', // Default type
      imageFilename: this.currentImageFilename
    };
    this.currentAnnotations.push(newAnnotation);
    this.selectedAnnotationIndex = this.currentAnnotations.length - 1;
    this.drawCanvas();
    this.updateCursor();
    this.cdr.detectChanges();
  }

  public removeAnnotation(index: number): void {
    if (!this.isImageLoadedAndCanvasReady) return;
    if (index === this.selectedAnnotationIndex) { this.selectedAnnotationIndex = null; }
    else if (this.selectedAnnotationIndex !== null && index < this.selectedAnnotationIndex) { this.selectedAnnotationIndex--; }
    this.currentAnnotations.splice(index, 1);
    this.currentAnnotations.forEach((ann, i) => ann.sequence = i + 1);
    this.drawCanvas();
    this.updateCursor();
    this.cdr.detectChanges();
  }

  public selectAnnotation(index: number): void {
    this.selectedAnnotationIndex = index;
    this.drawCanvas();
    this.cdr.detectChanges();
  }

  public getAnnotatedImageDataUrl(): string | null {
    if (!this.isImageLoadedAndCanvasReady) return null;
    const previouslySelected = this.selectedAnnotationIndex;
    this.selectedAnnotationIndex = null;
    this.drawCanvas();
    const dataUrl = this.canvas.toDataURL(this.imageMimeType || 'image/png');
    this.selectedAnnotationIndex = previouslySelected;
    this.drawCanvas();
    return dataUrl;
  }
  
  public saveAnnotationsAndClose(): void {
    const annotatedImageDataUrl = this.getAnnotatedImageDataUrl();
    this.annotationsApplied.emit({
      annotations: JSON.parse(JSON.stringify(this.currentAnnotations)),
      annotatedImageDataUrl: annotatedImageDataUrl,
      originalImageFilename: this.currentImageFilename
    });
    this.editorClosed.emit();
  }

  public cancelAndClose(): void { this.editorClosed.emit(); }

  public annotateWithAI(index: number): void {
    if (this.isAnnotatingWithAI) return;
    const annotation = this.currentAnnotations[index];
    if (!annotation) return;
    this.isAnnotatingWithAI = true; this.annotatingAIIndex = index; this.aiAnnotationError = null;
    this.cdr.detectChanges();
    const cropCanvas = document.createElement('canvas');
    const cropCtx = cropCanvas.getContext('2d');
    if (!cropCtx) { this.aiAnnotationError = "Error al crear canvas."; this.isAnnotatingWithAI = false; return; }
    const sx = annotation.x * this.image.naturalWidth, sy = annotation.y * this.image.naturalHeight;
    const sWidth = annotation.width * this.image.naturalWidth, sHeight = annotation.height * this.image.naturalHeight;
    cropCanvas.width = sWidth; cropCanvas.height = sHeight;
    cropCtx.drawImage(this.image, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    const base64Data = cropCanvas.toDataURL(this.imageMimeType || 'image/png').split(',')[1];
    const mimeType = this.getMimeTypeFromDataUrl(cropCanvas.toDataURL(this.imageMimeType || 'image/png'));
    this.geminiService.analyzeAnnotationArea(base64Data, mimeType).pipe(
      catchError(error => { this.aiAnnotationError = error.message || 'Error con IA.'; return of(null); }),
      finalize(() => { this.isAnnotatingWithAI = false; this.annotatingAIIndex = null; this.cdr.detectChanges(); })
    ).subscribe((result) => {
      if (result) {
        const targetAnnotation = this.currentAnnotations[index];
        if (targetAnnotation) {
          targetAnnotation.elementType = result.elementType;
          targetAnnotation.elementValue = result.elementValue;
          if (!targetAnnotation.description || targetAnnotation.description.startsWith('Anotación')) {
            targetAnnotation.description = result.elementValue || result.elementType;
          }
          this.drawCanvas();
          this.cdr.detectChanges();
        }
      }
    });
  }

  private getMimeTypeFromDataUrl(dataUrl: string): string {
    const match = dataUrl.match(/^data:(.*?);base64,/);
    return match ? match[1] : 'image/png';
  }
}