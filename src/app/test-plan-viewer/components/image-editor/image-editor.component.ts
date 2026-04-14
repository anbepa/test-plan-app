import { Component, EventEmitter, Input, Output, ViewChild, ElementRef, AfterViewInit, HostListener, DoCheck, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
declare const fabric: any;

type ToolName = 'pen' | 'circle' | 'line' | 'rectangle' | 'arrow' | 'text' | 'eraser';

interface DrawingTool {
  name: ToolName;
  label: string;
}

@Component({
  selector: 'app-image-editor',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './image-editor.component.html',
  styleUrls: ['./image-editor.component.css']
})
export class ImageEditorComponent implements AfterViewInit, DoCheck, OnDestroy {
  @Input() imageBase64: string = '';
  @Input() clearBase64: string = '';
  @Input() editorStateJson?: string;
  @Output() imageSaved = new EventEmitter<{ base64: string, stateJson: string }>();

  @ViewChild('canvasContainer') canvasContainerRef!: ElementRef<HTMLDivElement>;

  private canvas!: any;
  currentZoom: number = 1;
  private isDrawing = false;
  private origX = 0;
  private origY = 0;
  private activeShape: any = null;
  private arrowLine: any = null;
  private arrowHead: any = null;

  selectedTool: ToolName = 'pen';
  strokeColor = '#FF0000';
  strokeWidth = 3;

  drawingTools: DrawingTool[] = [
    { name: 'pen', label: 'Bolígrafo' },
    { name: 'line', label: 'Línea' },
    { name: 'arrow', label: 'Flecha' },
    { name: 'circle', label: 'Círculo' },
    { name: 'rectangle', label: 'Rectángulo' },
    { name: 'text', label: 'Texto' },
    { name: 'eraser', label: 'Editar/Borrar' },
  ];

  ngAfterViewInit(): void {
    this.canvas = new fabric.Canvas('fabricCanvas', {
      selection: false,
      preserveObjectStacking: true
    });

    this.setupEvents();
    this.setupTool();

    if (this.imageBase64) {
      this.loadImage(this.imageBase64);
    } else {
      this.canvas.setWidth(800);
      this.canvas.setHeight(600);
      this.canvas.backgroundColor = '#ffffff';
      this.canvas.renderAll();
    }
  }

  ngOnDestroy(): void {
    if (this.canvas) {
      this.canvas.dispose();
    }
  }

  ngDoCheck() {
    if (this.canvas && this.canvas.freeDrawingBrush) {
      this.canvas.freeDrawingBrush.color = this.strokeColor;
      this.canvas.freeDrawingBrush.width = this.strokeWidth;
    }
  }

  onColorChange() {
    if (this.selectedTool !== 'eraser' || !this.canvas) return;
    const objs = this.canvas.getActiveObjects();
    objs.forEach((obj: any) => {
      if (obj.type === 'i-text') {
        obj.set({ fill: this.strokeColor });
      } else {
        obj.set({ stroke: this.strokeColor });
      }
    });
    if (objs.length) this.canvas.renderAll();
  }

  onSizeChange() {
    if (this.selectedTool !== 'eraser' || !this.canvas) return;
    const objs = this.canvas.getActiveObjects();
    objs.forEach((obj: any) => {
      if (obj.type !== 'i-text') {
        obj.set({ strokeWidth: this.strokeWidth });
      } else {
        obj.set({ fontSize: Math.max(14, this.strokeWidth * 6) });
      }
    });
    if (objs.length) this.canvas.renderAll();
  }

  private loadImage(base64: string): void {
    fabric.Image.fromURL(base64, (img: any) => {
      this.canvas.setBackgroundImage(img, this.canvas.renderAll.bind(this.canvas));

      const containerWidth = this.canvasContainerRef?.nativeElement?.clientWidth || 800;
      const containerHeight = window.innerHeight * 0.6; // Max 60vh approx

      // Auto-scale to fit container nicely if it's too big
      let scale = 1;
      if (img.width > containerWidth || img.height > containerHeight) {
        const scaleX = (containerWidth - 40) / img.width;
        const scaleY = containerHeight / img.height;
        scale = Math.min(scaleX, scaleY);
      }

      this.currentZoom = scale;
      this.canvas.setWidth(img.width * scale);
      this.canvas.setHeight(img.height * scale);
      this.canvas.setZoom(scale);

      if (this.editorStateJson) {
        this.canvas.loadFromJSON(this.editorStateJson, () => {
          this.canvas.renderAll();
        });
      }
    });

    // Add mouse wheel zoom support
    this.canvas.on('mouse:wheel', (opt: any) => {
      const delta = opt.e.deltaY;
      let zoom = this.canvas.getZoom();
      zoom *= 0.999 ** delta;

      if (zoom > 20) zoom = 20;
      if (zoom < 0.01) zoom = 0.01;

      this.currentZoom = zoom;

      // Zoom keeping current center
      this.canvas.zoomToPoint({ x: opt.e.offsetX, y: opt.e.offsetY }, zoom);

      // Adjust canvas dimensions dynamically
      const bgImage = this.canvas.backgroundImage as any;
      if (bgImage) {
        this.canvas.setWidth(bgImage.width * zoom);
        this.canvas.setHeight(bgImage.height * zoom);
      }

      opt.e.preventDefault();
      opt.e.stopPropagation();
    });
  }

  setZoom(zoomLevel: number): void {
    const bgImage = this.canvas.backgroundImage as any;
    if (!bgImage) return;

    this.currentZoom = zoomLevel;

    // Zoom from top left center
    this.canvas.setZoom(zoomLevel);
    this.canvas.setWidth(bgImage.width * zoomLevel);
    this.canvas.setHeight(bgImage.height * zoomLevel);
    this.canvas.renderAll();
  }

  selectTool(tool: ToolName): void {
    this.selectedTool = tool;
    this.setupTool();
  }

  private setupTool() {
    this.canvas.isDrawingMode = (this.selectedTool === 'pen');
    if (this.canvas.isDrawingMode) {
      this.canvas.freeDrawingBrush = new fabric.PencilBrush(this.canvas);
      this.canvas.freeDrawingBrush.color = this.strokeColor;
      this.canvas.freeDrawingBrush.width = this.strokeWidth;
    }

    if (this.selectedTool === 'eraser') {
      this.canvas.selection = true;
      this.canvas.defaultCursor = 'default';
      this.canvas.forEachObject((o: any) => { o.selectable = true; o.evented = true; });
    } else {
      this.canvas.selection = false;
      this.canvas.defaultCursor = 'crosshair';
      this.canvas.forEachObject((o: any) => {
        if (this.selectedTool !== 'text' || o.type !== 'i-text') {
          o.selectable = false;
          o.evented = false;
        }
      });
    }
  }

  private setupEvents(): void {
    this.canvas.on('mouse:down', (o: any) => {
      if (this.selectedTool === 'eraser' || this.selectedTool === 'pen') return;

      const pointer = this.canvas.getPointer(o.e);
      this.origX = pointer.x;
      this.origY = pointer.y;
      this.isDrawing = true;

      // Desactivar selecciones si hacemos click para dibujar algo nuevo
      this.canvas.discardActiveObject();

      if (this.selectedTool === 'text') {
        if (o.target && o.target.type === 'i-text') return;

        const text = new fabric.IText('Texto', {
          left: this.origX,
          top: this.origY,
          fill: this.strokeColor,
          fontSize: Math.max(14, this.strokeWidth * 6),
          fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif'
        });
        this.canvas.add(text);
        this.canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        this.isDrawing = false;
        return;
      }

      if (this.selectedTool === 'rectangle') {
        this.activeShape = new fabric.Rect({
          left: this.origX,
          top: this.origY,
          width: 0,
          height: 0,
          fill: 'transparent',
          stroke: this.strokeColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          rx: 4, ry: 4
        });
        this.canvas.add(this.activeShape!);
      } else if (this.selectedTool === 'circle') {
        this.activeShape = new fabric.Circle({
          left: this.origX,
          top: this.origY,
          radius: 0,
          fill: 'transparent',
          stroke: this.strokeColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          originX: 'center',
          originY: 'center'
        });
        this.canvas.add(this.activeShape!);
      } else if (this.selectedTool === 'line') {
        this.activeShape = new fabric.Line([this.origX, this.origY, this.origX, this.origY], {
          stroke: this.strokeColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          strokeLineCap: 'round'
        });
        this.canvas.add(this.activeShape!);
      } else if (this.selectedTool === 'arrow') {
        this.arrowLine = new fabric.Line([this.origX, this.origY, this.origX, this.origY], {
          stroke: this.strokeColor,
          strokeWidth: this.strokeWidth,
          selectable: false,
          strokeLineCap: 'round'
        });
        this.arrowHead = new fabric.Triangle({
          left: this.origX,
          top: this.origY,
          width: Math.max(12, this.strokeWidth * 6),
          height: Math.max(12, this.strokeWidth * 6),
          fill: this.strokeColor,
          selectable: false,
          originX: 'center',
          originY: 'center'
        });
        this.canvas.add(this.arrowLine!, this.arrowHead!);
      }
    });

    this.canvas.on('mouse:move', (o: any) => {
      if (!this.isDrawing) return;
      const pointer = this.canvas.getPointer(o.e);

      if (this.selectedTool === 'rectangle' && this.activeShape) {
        this.activeShape.set({
          width: Math.abs(pointer.x - this.origX),
          height: Math.abs(pointer.y - this.origY)
        });
        if (pointer.x < this.origX) this.activeShape.set({ left: pointer.x });
        if (pointer.y < this.origY) this.activeShape.set({ top: pointer.y });
      } else if (this.selectedTool === 'circle' && this.activeShape) {
        const radius = Math.sqrt(Math.pow(pointer.x - this.origX, 2) + Math.pow(pointer.y - this.origY, 2));
        (this.activeShape as any).set({ radius });
      } else if (this.selectedTool === 'line' && this.activeShape) {
        (this.activeShape as any).set({ x2: pointer.x, y2: pointer.y });
      } else if (this.selectedTool === 'arrow' && this.arrowLine && this.arrowHead) {
        this.arrowLine.set({ x2: pointer.x, y2: pointer.y });

        const angle = Math.atan2(pointer.y - this.origY, pointer.x - this.origX);
        this.arrowHead.set({
          left: pointer.x,
          top: pointer.y,
          angle: (angle * 180 / Math.PI) + 90
        });
      }
      this.canvas.renderAll();
    });

    this.canvas.on('mouse:up', () => {
      this.isDrawing = false;
      this.activeShape = null;
      if (this.arrowLine && this.arrowHead) {
        // Optionally group arrow line and head
      }
      this.arrowLine = null;
      this.arrowHead = null;
    });
  }

  @HostListener('document:keydown', ['$event'])
  handleKeyboardEvent(event: KeyboardEvent) {
    // Si estás escribiendo en una caja de texto, no borres el objeto.
    const activeObj = this.canvas.getActiveObject();
    if (activeObj && activeObj.type === 'i-text' && (activeObj as any).isEditing) {
      return;
    }

    if (this.selectedTool === 'eraser' && (event.key === 'Delete' || event.key === 'Backspace')) {
      const activeObjects = this.canvas.getActiveObjects();
      if (activeObjects.length) {
        activeObjects.forEach((obj: any) => {
          this.canvas.remove(obj);
        });
        this.canvas.discardActiveObject();
      }
    }
  }

  clearCanvas(): void {
    this.canvas.clear();
    const baseToClear = this.clearBase64 || this.imageBase64;
    if (baseToClear) {
      this.loadImage(baseToClear);
    } else {
      this.canvas.backgroundColor = '#ffffff';
    }
  }

  saveCanvas(): void {
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    const base64 = this.canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 / this.currentZoom });
    const stateJson = JSON.stringify(this.canvas.toJSON());
    this.imageSaved.emit({ base64, stateJson });
  }

  downloadImage(): void {
    this.canvas.discardActiveObject();
    this.canvas.renderAll();
    const link = document.createElement('a');
    link.href = this.canvas.toDataURL({ format: 'png', quality: 1, multiplier: 1 / this.currentZoom });
    link.download = `evidencia_${Date.now()}.png`;
    link.click();
  }
}
