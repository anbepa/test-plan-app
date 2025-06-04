// src/app/image-annotation-editor/image-annotation-editor.component.ts
import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageAnnotation } from '../models/hu-data.model';

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

  constructor(private cdr: ChangeDetectorRef) {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existingAnnotations']) {
      this.currentAnnotations = JSON.parse(JSON.stringify(changes['existingAnnotations'].currentValue || []));
      this.currentAnnotations.forEach(ann => {
        ann.imageFilename = this.currentImageFilename;
      });
      if (this.isImageLoadedAndCanvasReady) {
        this.drawCanvas();
      }
    }
    if (changes['imageUrl'] && changes['imageUrl'].currentValue) {
      this.isImageLoadedAndCanvasReady = false;
      this.loadImageAndSetupCanvas();
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
            if (this.imageUrl) {
              this.loadImageAndSetupCanvas();
            }
        } else {
            console.error('Failed to get 2D context from canvas');
        }
    } else {
        console.error('CanvasRef is not available in AfterViewInit');
    }
  }

  private loadImageAndSetupCanvas(): void {
    if (!this.imageUrl || !this.ctx) {
      this.isImageLoadedAndCanvasReady = false;
      if (this.ctx && this.canvas) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }
    this.isImageLoadedAndCanvasReady = false;
    this.image = new Image();
    this.image.onload = () => {
      if (!this.canvas) return;

      if (this.baseImageRef && this.baseImageRef.nativeElement) {
        this.canvas.width = this.baseImageRef.nativeElement.naturalWidth || this.baseImageRef.nativeElement.width || 300;
        this.canvas.height = this.baseImageRef.nativeElement.naturalHeight || this.baseImageRef.nativeElement.height || 150;
      } else {
        this.canvas.width = this.image.naturalWidth || 300;
        this.canvas.height = this.image.naturalHeight || 150;
      }
      if (this.canvas) {
        this.canvasRect = this.canvas.getBoundingClientRect();
      }
      this.isImageLoadedAndCanvasReady = true;
      this.drawCanvas();
      this.cdr.detectChanges();
    };
    this.image.onerror = (error) => {
      console.error('Error loading image for annotation editor:', error);
      this.isImageLoadedAndCanvasReady = false;
      if (this.ctx && this.canvas) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = '#ccc';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.fillStyle = 'black';
        this.ctx.textAlign = 'center';
        this.ctx.fillText('Error loading image', this.canvas.width / 2, this.canvas.height / 2);
      }
      this.cdr.detectChanges();
    };
    this.image.src = this.imageUrl as string;
  }

  public drawCanvas(): void {
    if (!this.isImageLoadedAndCanvasReady || !this.ctx || !this.canvas || !this.image) {
        return;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);

    this.currentAnnotations.forEach((ann, index) => {
      this.drawRectangle(ann, index === this.selectedAnnotationIndex);
    });
  }

  private drawRectangle(annotation: ImageAnnotation, isSelected: boolean = false): void {
    if (!this.ctx || !this.canvas) return;
    const { x, y, width, height, description, sequence } = annotation;

    const rectXpx = x * this.canvas.width;
    const rectYpx = y * this.canvas.height;
    const rectWidthPx = width * this.canvas.width;
    const rectHeightPx = height * this.canvas.height;

    this.ctx.strokeStyle = isSelected ? 'blue' : 'red';
    this.ctx.lineWidth = isSelected ? 3 : 2;
    this.ctx.strokeRect(rectXpx, rectYpx, rectWidthPx, rectHeightPx);

    this.ctx.fillStyle = 'white';
    const text = `${sequence}: ${description ? description.substring(0, 25) + (description.length > 25 ? '...' : '') : '(Sin desc.)'}`;
    this.ctx.font = '12px Arial';
    const textMetrics = this.ctx.measureText(text);
    const textBgPadding = 3;
    const textBgHeight = 16 + (2 * textBgPadding);
    let textBgY = rectYpx - textBgHeight - textBgPadding;
    if (textBgY < textBgPadding) {
      textBgY = rectYpx + rectHeightPx + textBgPadding;
      if (textBgY + textBgHeight > this.canvas.height - textBgPadding) {
        textBgY = rectYpx + textBgPadding;
      }
    }

    this.ctx.fillRect(rectXpx, textBgY, textMetrics.width + (2 * textBgPadding), textBgHeight);
    this.ctx.fillStyle = isSelected ? 'blue' : 'red';
    this.ctx.fillText(text, rectXpx + textBgPadding, textBgY + 14 + textBgPadding / 2 );

    if (isSelected) {
      this.drawResizeHandles(annotation);
    }
  }

  private drawResizeHandles(annotation: ImageAnnotation): void {
    if (!this.ctx || !this.canvas) return;
    const { x, y, width, height } = annotation;
    const handleSizePx = this.RESIZE_HANDLE_SIZE_PX;
    const halfHandle = handleSizePx / 2;

    const normX = x * this.canvas.width;
    const normY = y * this.canvas.height;
    const normWidth = width * this.canvas.width;
    const normHeight = height * this.canvas.height;

    const handles = [
      { type: 'topLeft',     px: normX,                 py: normY },
      { type: 'top',         px: normX + normWidth / 2, py: normY },
      { type: 'topRight',    px: normX + normWidth,     py: normY },
      { type: 'left',        px: normX,                 py: normY + normHeight / 2 },
      { type: 'right',       px: normX + normWidth,     py: normY + normHeight / 2 },
      { type: 'bottomLeft',  px: normX,                 py: normY + normHeight },
      { type: 'bottom',      px: normX + normWidth / 2, py: normY + normHeight },
      { type: 'bottomRight', px: normX + normWidth,     py: normY + normHeight },
    ];

    this.ctx.fillStyle = 'blue';
    this.ctx.strokeStyle = 'white';
    this.ctx.lineWidth = 1;
    handles.forEach(handle => {
      this.ctx.fillRect(handle.px - halfHandle, handle.py - halfHandle, handleSizePx, handleSizePx);
      this.ctx.strokeRect(handle.px - halfHandle, handle.py - halfHandle, handleSizePx, handleSizePx);
    });
  }

  private getNormalizedMousePosition(event: MouseEvent): { x: number, y: number } {
    if (!this.canvas || !this.canvasRect) return { x: 0, y: 0 };

    const clickXInCanvasElement = event.clientX - this.canvasRect.left;
    const clickYInCanvasElement = event.clientY - this.canvasRect.top;

    let normX = clickXInCanvasElement / this.canvasRect.width;
    let normY = clickYInCanvasElement / this.canvasRect.height;

    normX = Math.max(0, Math.min(1, normX));
    normY = Math.max(0, Math.min(1, normY));

    return { x: normX, y: normY };
  }

  // *** AÑADIDO EL MÉTODO FALTANTE ***
  private isPointInAnnotation(mouseXnorm: number, mouseYnorm: number, annotation: ImageAnnotation): boolean {
    return mouseXnorm >= annotation.x && mouseXnorm <= annotation.x + annotation.width &&
           mouseYnorm >= annotation.y && mouseYnorm <= annotation.y + annotation.height;
  }
  // ***********************************

  @HostListener('mousedown', ['$event'])
  onMouseDown(event: MouseEvent): void {
    if (!this.isImageLoadedAndCanvasReady || !this.canvas || !this.ctx || event.target !== this.canvas) return;
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
      const ann = this.currentAnnotations[i];
      if (this.isPointInAnnotation(normPos.x, normPos.y, ann)) { // Llamada correcta ahora
        this.selectedAnnotationIndex = i;
        this.currentAction = 'moving';
        this.dragOffsetXnorm = normPos.x - ann.x;
        this.dragOffsetYnorm = normPos.y - ann.y;
        this.updateCursor();
        this.drawCanvas();
        return;
      }
    }

    this.selectedAnnotationIndex = null;
    this.currentAction = 'drawing';
    this.startXnorm = normPos.x;
    this.startYnorm = normPos.y;
    this.updateCursor();
    this.drawCanvas();
  }

  @HostListener('document:mousemove', ['$event'])
  onGlobalMouseMove(event: MouseEvent): void {
    if (this.currentAction === 'none' || !this.isImageLoadedAndCanvasReady || !this.canvas) {
      if (this.canvas && event.target === this.canvas) this.updateCursor(event);
      return;
    }
    event.preventDefault();
    this.canvasRect = this.canvas.getBoundingClientRect();

    const normPos = this.getNormalizedMousePosition(event);

    if (this.currentAction === 'resizing' && this.selectedAnnotationIndex !== null && this.activeResizeHandle) {
      const ann = this.currentAnnotations[this.selectedAnnotationIndex];
      let originalX = ann.x;
      let originalY = ann.y;
      let originalWidth = ann.width;
      let originalHeight = ann.height;

      const deltaXnorm = normPos.x - this.lastKnownMouseXnorm;
      const deltaYnorm = normPos.y - this.lastKnownMouseYnorm;

      switch (this.activeResizeHandle) {
        case 'topLeft':
          ann.x += deltaXnorm; ann.y += deltaYnorm;
          ann.width -= deltaXnorm; ann.height -= deltaYnorm;
          break;
        case 'top':
          ann.y += deltaYnorm; ann.height -= deltaYnorm;
          break;
        case 'topRight':
          ann.y += deltaYnorm; ann.width += deltaXnorm;
          ann.height -= deltaYnorm;
          break;
        case 'left':
          ann.x += deltaXnorm; ann.width -= deltaXnorm;
          break;
        case 'right':
          ann.width += deltaXnorm;
          break;
        case 'bottomLeft':
          ann.x += deltaXnorm; ann.width -= deltaXnorm;
          ann.height += deltaYnorm;
          break;
        case 'bottom':
          ann.height += deltaYnorm;
          break;
        case 'bottomRight':
          ann.width += deltaXnorm; ann.height += deltaYnorm;
          break;
      }
      if (ann.width < this.MIN_ANNOTATION_SIZE_NORM) {
        if (this.activeResizeHandle.includes('Left')) ann.x = originalX + originalWidth - this.MIN_ANNOTATION_SIZE_NORM;
        ann.width = this.MIN_ANNOTATION_SIZE_NORM;
      }
      if (ann.height < this.MIN_ANNOTATION_SIZE_NORM) {
        if (this.activeResizeHandle.includes('Top')) ann.y = originalY + originalHeight - this.MIN_ANNOTATION_SIZE_NORM;
        ann.height = this.MIN_ANNOTATION_SIZE_NORM;
      }
      ann.x = Math.max(0, Math.min(1 - ann.width, ann.x));
      ann.y = Math.max(0, Math.min(1 - ann.height, ann.y));


    } else if (this.currentAction === 'moving' && this.selectedAnnotationIndex !== null) {
      const ann = this.currentAnnotations[this.selectedAnnotationIndex];
      ann.x = normPos.x - this.dragOffsetXnorm;
      ann.y = normPos.y - this.dragOffsetYnorm;
      ann.x = Math.max(0, Math.min(1 - ann.width, ann.x));
      ann.y = Math.max(0, Math.min(1 - ann.height, ann.y));

    } else if (this.currentAction === 'drawing') {
      this.drawCanvas();
      this.ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
      this.ctx.lineWidth = 2;
      const currentRectX = Math.min(this.startXnorm, normPos.x) * this.canvas.width;
      const currentRectY = Math.min(this.startYnorm, normPos.y) * this.canvas.height;
      const currentRectWidth = Math.abs(normPos.x - this.startXnorm) * this.canvas.width;
      const currentRectHeight = Math.abs(normPos.y - this.startYnorm) * this.canvas.height;
      this.ctx.strokeRect(currentRectX, currentRectY, currentRectWidth, currentRectHeight);
    }

    this.lastKnownMouseXnorm = normPos.x;
    this.lastKnownMouseYnorm = normPos.y;
    if (this.currentAction !== 'drawing') this.drawCanvas();
    if (this.canvas && event.target === this.canvas) this.updateCursor(event);
  }


  @HostListener('document:mouseup', ['$event'])
  onGlobalMouseUp(event: MouseEvent): void {
    if (this.currentAction === 'none' || !this.isImageLoadedAndCanvasReady || !this.canvas) return;
    event.preventDefault();
    this.canvasRect = this.canvas.getBoundingClientRect();

    if (this.currentAction === 'drawing') {
      const normPos = this.getNormalizedMousePosition(event);
      const finalX = Math.min(this.startXnorm, normPos.x);
      const finalY = Math.min(this.startYnorm, normPos.y);
      let finalWidth = Math.abs(normPos.x - this.startXnorm);
      let finalHeight = Math.abs(normPos.y - this.startYnorm);

      if (finalWidth >= this.MIN_ANNOTATION_SIZE_NORM && finalHeight >= this.MIN_ANNOTATION_SIZE_NORM) {
        const newAnnotation: ImageAnnotation = {
          sequence: this.currentAnnotations.length + 1,
          description: `Anotación ${this.currentAnnotations.length + 1}`,
          x: finalX, y: finalY, width: finalWidth, height: finalHeight,
          imageFilename: this.currentImageFilename
        };
        this.currentAnnotations.push(newAnnotation);
        this.selectedAnnotationIndex = this.currentAnnotations.length - 1;
      }
    } else if (this.currentAction === 'resizing' && this.selectedAnnotationIndex !== null) {
      const ann = this.currentAnnotations[this.selectedAnnotationIndex];
      ann.width = Math.max(this.MIN_ANNOTATION_SIZE_NORM, ann.width);
      ann.height = Math.max(this.MIN_ANNOTATION_SIZE_NORM, ann.height);
      ann.x = Math.max(0, Math.min(1 - ann.width, ann.x));
      ann.y = Math.max(0, Math.min(1 - ann.height, ann.y));
    }

    this.currentAction = 'none';
    this.activeResizeHandle = null;
    this.drawCanvas();
    this.updateCursor(this.canvas && event.target === this.canvas ? event : null);
  }

  private updateCursor(event?: MouseEvent | null): void {
    if (!this.isImageLoadedAndCanvasReady || !this.canvas) return;

    let cursorStyle = 'crosshair';

    if (this.currentAction === 'moving') {
      cursorStyle = 'move';
    } else if (this.currentAction === 'resizing' && this.activeResizeHandle) {
      switch (this.activeResizeHandle) {
        case 'topLeft': case 'bottomRight': cursorStyle = 'nwse-resize'; break;
        case 'topRight': case 'bottomLeft': cursorStyle = 'nesw-resize'; break;
        case 'top': case 'bottom': cursorStyle = 'ns-resize'; break;
        case 'left': case 'right': cursorStyle = 'ew-resize'; break;
        default: cursorStyle = 'default';
      }
    } else if (event && event.target === this.canvas) {
        this.canvasRect = this.canvas.getBoundingClientRect();
        const normPos = this.getNormalizedMousePosition(event);
        if (this.selectedAnnotationIndex !== null) {
            const selectedAnn = this.currentAnnotations[this.selectedAnnotationIndex];
            const hoveredHandle = this.getClickedResizeHandle(normPos.x, normPos.y, selectedAnn);
            if (hoveredHandle) {
                switch (hoveredHandle) {
                    case 'topLeft': case 'bottomRight': cursorStyle = 'nwse-resize'; break;
                    case 'topRight': case 'bottomLeft': cursorStyle = 'nesw-resize'; break;
                    case 'top': case 'bottom': cursorStyle = 'ns-resize'; break;
                    case 'left': case 'right': cursorStyle = 'ew-resize'; break;
                    default: cursorStyle = 'move';
                }
            } else if (this.isPointInAnnotation(normPos.x, normPos.y, selectedAnn)) { // Llamada correcta
                cursorStyle = 'move';
            }
        } else {
            let hoveredOnUnselected = false;
            for (const ann of this.currentAnnotations) {
                if (this.isPointInAnnotation(normPos.x, normPos.y, ann)) { // Llamada correcta
                    cursorStyle = 'pointer';
                    hoveredOnUnselected = true;
                    break;
                }
            }
            if (!hoveredOnUnselected) {
                cursorStyle = 'crosshair';
            }
        }
    }
    this.canvas.style.cursor = cursorStyle;
  }

  private getClickedResizeHandle(mouseXnorm: number, mouseYnorm: number, annotation: ImageAnnotation): ResizeHandleType | null {
    if (!this.canvas) return null;
    const { x, y, width, height } = annotation;
    const handleDetectionMarginNormX = (this.RESIZE_HANDLE_SIZE_PX * 1.5) / this.canvas.width;
    const handleDetectionMarginNormY = (this.RESIZE_HANDLE_SIZE_PX * 1.5) / this.canvas.height;

    const handlesDef = [
      { type: 'topLeft',     cx: x,           cy: y },
      { type: 'top',         cx: x + width/2, cy: y },
      { type: 'topRight',    cx: x + width,   cy: y },
      { type: 'left',        cx: x,           cy: y + height/2 },
      { type: 'right',       cx: x + width,   cy: y + height/2 },
      { type: 'bottomLeft',  cx: x,           cy: y + height },
      { type: 'bottom',      cx: x + width/2, cy: y + height },
      { type: 'bottomRight', cx: x + width,   cy: y + height },
    ];

    for (const handle of handlesDef) {
      if ( mouseXnorm >= handle.cx - handleDetectionMarginNormX && mouseXnorm <= handle.cx + handleDetectionMarginNormX &&
           mouseYnorm >= handle.cy - handleDetectionMarginNormY && mouseYnorm <= handle.cy + handleDetectionMarginNormY ) {
        return handle.type as ResizeHandleType;
      }
    }
    return null;
  }


  addAnnotation(): void {
    if (!this.isImageLoadedAndCanvasReady) return;
    const newAnnotation: ImageAnnotation = {
      sequence: this.currentAnnotations.length + 1,
      description: `Anotación ${this.currentAnnotations.length + 1}`,
      x: 0.1, y: 0.1, width: Math.max(this.MIN_ANNOTATION_SIZE_NORM, 0.2), height: Math.max(this.MIN_ANNOTATION_SIZE_NORM, 0.1),
      imageFilename: this.currentImageFilename
    };
    this.currentAnnotations.push(newAnnotation);
    this.selectedAnnotationIndex = this.currentAnnotations.length - 1;
    this.drawCanvas();
    this.updateCursor();
  }

  removeAnnotation(index: number): void {
    if (!this.isImageLoadedAndCanvasReady) return;
    if (index === this.selectedAnnotationIndex) {
        this.selectedAnnotationIndex = null;
    } else if (this.selectedAnnotationIndex !== null && index < this.selectedAnnotationIndex) {
        this.selectedAnnotationIndex--;
    }
    this.currentAnnotations.splice(index, 1);
    this.currentAnnotations.forEach((ann, i) => ann.sequence = i + 1);
    this.drawCanvas();
    this.updateCursor();
  }

  selectAnnotation(index: number): void {
    if (!this.isImageLoadedAndCanvasReady) return;
    this.selectedAnnotationIndex = index;
    this.drawCanvas();
    this.updateCursor();
  }

  getAnnotatedImageDataUrl(): string | null {
    if (!this.isImageLoadedAndCanvasReady || !this.canvas || !this.image) {
      return null;
    }
    const previouslySelected = this.selectedAnnotationIndex;
    this.selectedAnnotationIndex = null;
    this.drawCanvas();
    const dataUrl = this.canvas.toDataURL(this.imageMimeType || 'image/png');
    this.selectedAnnotationIndex = previouslySelected;
    this.drawCanvas();
    return dataUrl;
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