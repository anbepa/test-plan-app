// src/app/image-annotation-editor/image-annotation-editor.component.ts
import { Component, Input, Output, EventEmitter, ViewChild, ElementRef, AfterViewInit, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ImageAnnotation } from '../models/hu-data.model';

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
  @Output() annotationsChanged = new EventEmitter<ImageAnnotation[]>();
  @Output() editorClosed = new EventEmitter<void>();

  @ViewChild('canvasElement') canvasRef!: ElementRef<HTMLCanvasElement>;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private image!: HTMLImageElement;

  currentAnnotations: ImageAnnotation[] = [];
  selectedAnnotationIndex: number | null = null;
  isDrawing: boolean = false;
  startX!: number;
  startY!: number;

  constructor() {}

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['existingAnnotations'] && changes['existingAnnotations'].currentValue) {
      // Deep copy to ensure we work on a mutable array
      this.currentAnnotations = JSON.parse(JSON.stringify(changes['existingAnnotations'].currentValue));
      this.drawCanvas();
    }
    if (changes['imageUrl'] && changes['imageUrl'].currentValue) {
      this.loadImage();
    }
  }

  ngAfterViewInit(): void {
    this.canvas = this.canvasRef.nativeElement;
    this.ctx = this.canvas.getContext('2d')!;
    this.loadImage();

    this.canvas.addEventListener('mousedown', this.onMouseDown.bind(this));
    this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
    this.canvas.addEventListener('mouseup', this.onMouseUp.bind(this));
    this.canvas.addEventListener('mouseout', this.onMouseUp.bind(this));
  }

  loadImage(): void {
    if (!this.imageUrl) {
      return;
    }
    this.image = new Image();
    this.image.onload = () => {
      this.canvas.width = this.image.width;
      this.canvas.height = this.image.height;
      this.drawCanvas();
    };
    this.image.src = this.imageUrl as string;
  }

  drawCanvas(): void {
    if (!this.ctx || !this.image) return;

    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.image, 0, 0, this.canvas.width, this.canvas.height);

    this.currentAnnotations.forEach((ann, index) => {
      this.drawRectangle(ann, index === this.selectedAnnotationIndex);
    });
  }

  drawRectangle(annotation: ImageAnnotation, isSelected: boolean = false): void {
    const { x, y, width, height, description, sequence } = annotation;
    const rectX = x * this.canvas.width;
    const rectY = y * this.canvas.height;
    const rectWidth = width * this.canvas.width;
    const rectHeight = height * this.canvas.height;

    this.ctx.strokeStyle = isSelected ? 'blue' : 'red';
    this.ctx.lineWidth = 2;
    this.ctx.strokeRect(rectX, rectY, rectWidth, rectHeight);

    this.ctx.fillStyle = isSelected ? 'blue' : 'red';
    this.ctx.font = '14px Arial';
    this.ctx.fillText(`${sequence}: ${description.substring(0, 20)}...`, rectX, rectY - 5);
  }

  onMouseDown(event: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    this.startX = (event.clientX - rect.left) / this.canvas.width;
    this.startY = (event.clientY - rect.top) / this.canvas.height;
    this.isDrawing = true;
    this.selectedAnnotationIndex = null;

    // Check if clicking on an existing annotation
    this.currentAnnotations.forEach((ann, index) => {
      const annX = ann.x * this.canvas.width;
      const annY = ann.y * this.canvas.height;
      const annWidth = ann.width * this.canvas.width;
      const annHeight = ann.height * this.canvas.height;

      if (event.offsetX >= annX && event.offsetX <= annX + annWidth &&
          event.offsetY >= annY && event.offsetY <= annY + annHeight) {
        this.selectedAnnotationIndex = index;
        this.isDrawing = false; // Not drawing, but moving existing
      }
    });
    this.drawCanvas();
  }

  onMouseMove(event: MouseEvent): void {
    if (!this.isDrawing && this.selectedAnnotationIndex === null) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentX = (event.clientX - rect.left) / this.canvas.width;
    const currentY = (event.clientY - rect.top) / this.canvas.height;

    if (this.isDrawing) {
      // Logic for drawing new rectangle
      this.drawCanvas(); // Redraw to clear previous temporary rect
      this.ctx.strokeStyle = 'red';
      this.ctx.lineWidth = 2;
      this.ctx.strokeRect(this.startX * this.canvas.width, this.startY * this.canvas.height,
                          (currentX - this.startX) * this.canvas.width, (currentY - this.startY) * this.canvas.height);
    } else if (this.selectedAnnotationIndex !== null) {
      // Logic for moving existing rectangle (simplified: move by delta)
      const dx = currentX - this.startX;
      const dy = currentY - this.startY;
      const ann = this.currentAnnotations[this.selectedAnnotationIndex];
      ann.x += dx;
      ann.y += dy;
      this.startX = currentX;
      this.startY = currentY;
      this.drawCanvas();
    }
  }

  onMouseUp(event: MouseEvent): void {
    if (this.isDrawing) {
      const rect = this.canvas.getBoundingClientRect();
      const endX = (event.clientX - rect.left) / this.canvas.width;
      const endY = (event.clientY - rect.top) / this.canvas.height;

      const newWidth = Math.abs(endX - this.startX);
      const newHeight = Math.abs(endY - this.startY);
      const newX = Math.min(this.startX, endX);
      const newY = Math.min(this.startY, endY);

      if (newWidth > 0.01 && newHeight > 0.01) { // Avoid tiny clicks
        this.currentAnnotations.push({
          sequence: this.currentAnnotations.length + 1,
          description: '', // User will fill this
          x: newX,
          y: newY,
          width: newWidth,
          height: newHeight
        });
      }
    }
    this.isDrawing = false;
    this.selectedAnnotationIndex = null; // Deselect after move/draw
    this.drawCanvas();
  }

  addAnnotation(): void {
    this.currentAnnotations.push({
      sequence: this.currentAnnotations.length + 1,
      description: '',
      x: 0.1, // Default position
      y: 0.1,
      width: 0.2,
      height: 0.1
    });
    this.drawCanvas();
  }

  removeAnnotation(index: number): void {
    this.currentAnnotations.splice(index, 1);
    this.currentAnnotations.forEach((ann, i) => ann.sequence = i + 1); // Re-sequence
    this.drawCanvas();
  }

  saveAnnotations(): void {
    this.annotationsChanged.emit(this.currentAnnotations);
    this.editorClosed.emit();
  }

  closeEditor(): void {
    this.editorClosed.emit();
  }
}