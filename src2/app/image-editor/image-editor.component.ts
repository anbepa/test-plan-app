import { Component, EventEmitter, Input, Output, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-image-editor',
  templateUrl: './image-editor.component.html',
  styleUrl: './image-editor.component.css',
  standalone: true,
  imports: [CommonModule]
})
export class ImageEditorComponent implements OnDestroy {
  @Input() imageData: string | null = null;
  @Input() visible: boolean = false;
  @Output() close = new EventEmitter<void>();
  @Output() save = new EventEmitter<string>();

  private editor: any;

  ngAfterViewInit() {
    if (this.visible && this.imageData) {
      this.initEditor();
    }
  }

  ngOnChanges() {
    if (this.visible && this.imageData) {
      setTimeout(() => this.initEditor(), 0);
    } else if (!this.visible) {
      this.destroyEditor();
    }
  }

  ngOnDestroy() {
    this.destroyEditor();
  }

  initEditor() {
    const container = document.getElementById('tui-image-editor-container');
    if (!container || !this.imageData) return;
    this.destroyEditor(); // Limpia cualquier instancia previa
    container.innerHTML = '';
    import('tui-image-editor').then((module) => {
      const ImageEditor = module.default;
      this.editor = new ImageEditor(container, {
        includeUI: {
          loadImage: { path: this.imageData || '', name: 'Evidencia' },
          theme: {},
          menu: ['draw', 'shape', 'icon', 'text', 'mask', 'filter', 'crop', 'flip', 'rotate'],
          initMenu: 'draw',
          uiSize: { width: '1000px', height: '700px' },
          menuBarPosition: 'bottom'
        },
        cssMaxWidth: 900,
        cssMaxHeight: 600,
        selectionStyle: { cornerSize: 20, rotatingPointOffset: 70 }
      });
    });
  }

  destroyEditor() {
    if (this.editor && this.editor.destroy) {
      this.editor.destroy();
      this.editor = null;
    }
    const container = document.getElementById('tui-image-editor-container');
    if (container) container.innerHTML = '';
  }

  onSave() {
    if (this.editor) {
      const dataUrl = this.editor.toDataURL();
      this.save.emit(dataUrl);
    }
  }

  onClose() {
    this.close.emit();
  }
}
