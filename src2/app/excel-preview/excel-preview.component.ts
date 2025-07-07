import { Component, Input, ViewChild, ElementRef, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import html2canvas from 'html2canvas';

@Component({
  selector: 'excel-preview',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './excel-preview.component.html',
  styleUrls: ['./excel-preview.component.css']
})
export class ExcelPreviewComponent {
  @Input() tableData: string[][] = [];
  @Input() tableStyles: any = {};
  @ViewChild('tableRef') tableRef!: ElementRef;
  @Output() imageReady = new EventEmitter<string>();
  public imageDataUrl: string | null = null;
  public showPreview = true;

  async captureTableAsImage() {
    if (!this.tableRef) return;
    // Aumentar la escala para mayor resolución
    const canvas = await html2canvas(this.tableRef.nativeElement, { scale: 2 });
    this.imageDataUrl = canvas.toDataURL('image/png');
    this.showPreview = false;
    this.imageReady.emit(this.imageDataUrl);
  }
}
