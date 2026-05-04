import { Component, EventEmitter, Input, OnInit, Output, ViewChild, ElementRef, AfterViewInit, OnDestroy, NgZone, ChangeDetectorRef, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
    selector: 'app-data-editor',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './data-editor.component.html',
    styleUrls: ['./data-editor.component.css'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: [`
        :host {
            display: flex;
            flex-direction: column;
            flex: 1;
            height: 100%;
            min-height: 0;
            width: 100%;
        }
    `]
})
export class DataEditorComponent implements OnInit, AfterViewInit, OnDestroy {
    @Input() data: any[][] = [];
    @Input() hasHeader: boolean = true;
    @Input() rowColors?: string[];
    @Output() save = new EventEmitter<{ data: any[][], hasHeader: boolean, rowColors?: string[] }>();
    @Output() cancel = new EventEmitter<void>();

    @ViewChild('tableScrollContainer') tableScrollContainer!: ElementRef<HTMLDivElement>;

    localData: any[][] = [];
    virtualRows: { data: any[], index: number }[] = [];
    topSpacerHeight: number = 0;
    bottomSpacerHeight: number = 0;
    localRowColors: string[] = [];
    isLoading: boolean = true;
    private resizeObserver!: ResizeObserver;

    selectedColor: string = '#fef08a'; // Default yellow highlight
    readonly ROW_HEIGHT = 32;

    highlightColors = [
        { name: 'Ninguno', value: 'transparent' },
        { name: 'Amarillo', value: '#fef08a' },
        { name: 'Rojo', value: '#fee2e2' },
        { name: 'Verde', value: '#dcfce7' },
        { name: 'Azul', value: '#dbeafe' },
        { name: 'Gris', value: '#f1f5f9' }
    ];

    constructor(private ngZone: NgZone, private cdr: ChangeDetectorRef) { }

    ngOnInit() {
        try {
            if (this.data && Array.isArray(this.data)) {
                this.localData = JSON.parse(JSON.stringify(this.data));
            } else {
                this.localData = [['', ''], ['', '']];
            }

            // Initialize or copy row colors
            if (this.rowColors && this.rowColors.length === this.localData.length) {
                this.localRowColors = [...this.rowColors];
            } else {
                this.localRowColors = new Array(this.localData.length).fill('transparent');
            }

            this.updateVirtualRows();
        } catch (e) {
            console.error('Error parsing data in DataEditor', e);
            this.localData = [['', ''], ['', '']];
            this.localRowColors = ['transparent', 'transparent'];
            this.updateVirtualRows();
        } finally {
            this.isLoading = false;
        }
    }

    ngAfterViewInit() {
        this.ngZone.runOutsideAngular(() => {
            this.resizeObserver = new ResizeObserver(() => {
                this.ngZone.run(() => {
                    this.updateVirtualRows();
                    this.cdr.detectChanges();
                });
            });

            if (this.tableScrollContainer) {
                this.resizeObserver.observe(this.tableScrollContainer.nativeElement);
            }
        });

        setTimeout(() => {
            this.updateVirtualRows();
            this.cdr.detectChanges();
        }, 500);
    }

    ngOnDestroy() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
    }

    onTableScroll() {
        this.updateVirtualRows();
    }

    private updateVirtualRows() {
        if (!this.tableScrollContainer) return;
        const container = this.tableScrollContainer.nativeElement;
        const scrollTop = container.scrollTop;
        const viewportHeight = container.clientHeight || 500; // Fallback to 500 if 0

        const startIndex = Math.max(0, Math.floor(scrollTop / this.ROW_HEIGHT) - 10);
        const visibleCount = Math.ceil(viewportHeight / this.ROW_HEIGHT) + 20;
        const endIndex = Math.min(this.localData.length, startIndex + visibleCount);

        const newVirtualRows = [];
        for (let i = startIndex; i < endIndex; i++) {
            newVirtualRows.push({ data: this.localData[i], index: i });
        }

        this.virtualRows = newVirtualRows;
        this.topSpacerHeight = startIndex * this.ROW_HEIGHT;
        this.bottomSpacerHeight = (this.localData.length - endIndex) * this.ROW_HEIGHT;
        this.cdr.markForCheck();
    }

    applyColorToRow(index: number) {
        this.localRowColors[index] = this.selectedColor;
        this.cdr.markForCheck();
    }

    onSave() {
        this.save.emit({
            data: this.localData,
            hasHeader: this.hasHeader,
            rowColors: this.localRowColors
        });
    }

    onCancel() {
        this.cancel.emit();
    }

    trackByFn(index: number, item: any) {
        return index;
    }

    isNumericColumn(colIndex: number): boolean {
        // Check data rows (skip header row 0 if hasHeader)
        const startRow = this.hasHeader ? 1 : 0;
        const sampleRows = this.localData.slice(startRow, startRow + 10);
        if (sampleRows.length === 0) return false;
        return sampleRows.every(row => {
            const val = (row[colIndex] ?? '').toString().trim();
            return val === '' || !isNaN(Number(val.replace(/[,\.]/g, '')));
        });
    }

    addRow() {
        const cols = (this.localData[0] || []).length || 2;
        this.localData.push(new Array(cols).fill(''));
        this.localRowColors.push('transparent');
        this.updateVirtualRows();
    }

    removeRow(index: number) {
        if (this.localData.length > 1) {
            this.localData.splice(index, 1);
            this.localRowColors.splice(index, 1);
            this.updateVirtualRows();
        }
    }

    addColumn() {
        if (this.localData.length === 0) this.localData = [[]];
        this.localData.forEach(row => row.push(''));
        this.updateVirtualRows();
    }

    removeColumn(index: number) {
        if (this.localData[0] && this.localData[0].length > 1) {
            this.localData.forEach(row => row.splice(index, 1));
            this.updateVirtualRows();
        }
    }
}
