import { Injectable } from '@angular/core';
import { HUData, PlanExecution, ImageEvidence } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../core/execution-storage.service';
import { saveAs } from 'file-saver';
import {
    AlignmentType,
    BorderStyle,
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType,
    ImageRun,
    TableLayoutType
} from 'docx';

/**
 * Servicio para exportar datos en diferentes formatos
 */
@Injectable({
    providedIn: 'root'
})
export class ExportService {

    private readonly CUSTOM_PAGE_SIZE_TWIP = 31675; // 55.8 cm
    private readonly EVIDENCE_PLACEHOLDER = 'Imagen de la evidencias';

    constructor(private storageService: ExecutionStorageService) { }

    /**
     * Exporta una HU como matriz de ejecución en formato CSV
     */
    exportToCSV(hu: HUData): void {
        if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
            throw new Error('No hay casos de prueba para exportar');
        }

        const csvHeader = [
            "ID Caso",
            "Escenario de Prueba",
            "Precondiciones",
            "Paso a Paso",
            "Resultado Esperado"
        ];

        const csvRows = hu.detailedTestCases.map((tc, index) => {
            const stepsString = Array.isArray(tc.steps)
                ? tc.steps.map(step => `${step.numero_paso}. ${step.accion}`).join('\n')
                : 'Pasos no disponibles.';

            return [
                this.escapeCsvField(hu.id + '_CP' + (index + 1)),
                this.escapeCsvField(tc.title),
                this.escapeCsvField(tc.preconditions),
                this.escapeCsvField(stepsString),
                this.escapeCsvField(tc.expectedResults)
            ];
        });

        const csvFullContent = [
            csvHeader.join(','),
            ...csvRows.map(row => row.join(','))
        ].join('\r\n');

        const filename = `MatrizEjecucion_${this.escapeFilename(hu.id)}_${new Date().toISOString().split('T')[0]}.csv`;
        saveAs(
            new Blob(["\uFEFF" + csvFullContent], { type: 'text/csv;charset=utf-8;' }),
            filename
        );
    }

    /**
     * Exporta una HU como matriz de evidencias en formato DOCX
     * Reglas:
     * - Página personalizada: 55.8cm x 55.8cm
     * - 1 página por test case
     * - Título por página: "N. <escenario>"
     * - Tabla de 2 columnas con tantas filas como pasos
     *   - Columna 1: número de paso
     *   - Columna 2: espacio de evidencias
     */
    async exportToDOCX(hu: HUData): Promise<void> {
        if (!hu.detailedTestCases || hu.detailedTestCases.length === 0) {
            throw new Error('No hay casos de prueba para exportar');
        }

        const children: Array<Paragraph | Table> = [];

        hu.detailedTestCases.forEach((testCase, index) => {
            const scenarioNumber = index + 1;
            const scenarioTitle = testCase.title?.trim()
                ? `${scenarioNumber}. ${testCase.title.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            children.push(new Paragraph({
                text: scenarioTitle,
                heading: 'Heading1',
                pageBreakBefore: index > 0,
                spacing: { after: 240 }
            }));

            const validSteps = Array.isArray(testCase.steps) ? testCase.steps : [];

            const stepRows = (validSteps.length > 0 ? validSteps : [{ numero_paso: 1, accion: '' }]).map((step, stepIndex) => {
                const stepNumber = step?.numero_paso ?? (stepIndex + 1);
                const stepAction = step?.accion?.trim() || `Paso ${stepNumber}`;
                return new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            children: [
                                new Paragraph({
                                    text: `${stepNumber}. ${stepAction}`,
                                    alignment: AlignmentType.LEFT
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 75, type: WidthType.PERCENTAGE },
                            children: [
                                new Paragraph({
                                    alignment: AlignmentType.CENTER,
                                    spacing: { before: 120, after: 120 },
                                    children: [
                                        new TextRun({
                                            text: this.EVIDENCE_PLACEHOLDER,
                                            bold: true,
                                            underline: {}
                                        })
                                    ]
                                }),
                                new Paragraph('')
                            ]
                        })
                    ]
                });
            });

            const headerRow = new TableRow({
                children: [
                    new TableCell({
                        width: { size: 25, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                    new TextRun({
                                        text: 'Paso a paso',
                                        bold: true,
                                        underline: {}
                                    })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 75, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                    new TextRun({
                                        text: 'Evidencias',
                                        bold: true,
                                        underline: {}
                                    })
                                ]
                            })
                        ]
                    })
                ]
            });

            const rows = [headerRow, ...stepRows];

            children.push(new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows
            }));
        });

        const doc = new Document({
            sections: [
                {
                    properties: {
                        page: {
                            size: {
                                width: this.CUSTOM_PAGE_SIZE_TWIP,
                                height: this.CUSTOM_PAGE_SIZE_TWIP
                            }
                        }
                    },
                    children
                }
            ]
        });

        const blob = await Packer.toBlob(doc);
        const filename = `Matriz_Evidencias_${this.escapeFilename(hu.id)}_${new Date().toISOString().split('T')[0]}.docx`;
        saveAs(blob, filename);
    }

    /**
     * Exporta una ejecución del plan con evidencias en formato DOCX.
     * Mismo formato que exportToDOCX: página 55.8cm, tabla 25/75%, 1 página por escenario.
     * La columna de evidencias contiene las imágenes reales subidas por el usuario.
     */
    async exportExecutionToDOCX(execution: PlanExecution, hu: HUData | null): Promise<void> {
        if (!execution.testCases || execution.testCases.length === 0) {
            throw new Error('No hay casos de prueba para exportar');
        }

        // Obtener todas las imágenes reales (con base64) para esta ejecución
        const allImages = await this.storageService.getAllImages();
        const imageMap = new Map<string, ImageEvidence>();
        allImages.forEach(img => imageMap.set(img.id, img));

        const children: Array<Paragraph | Table> = [];

        for (let index = 0; index < execution.testCases.length; index++) {
            const testCase = execution.testCases[index];
            const scenarioNumber = index + 1;
            const scenarioTitle = testCase.title?.trim()
                ? `${scenarioNumber}. ${testCase.title.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            children.push(new Paragraph({
                text: scenarioTitle,
                heading: 'Heading1',
                pageBreakBefore: index > 0,
                spacing: { after: 240 }
            }));

            const validSteps = Array.isArray(testCase.steps) ? testCase.steps : [];
            const stepsToRender = validSteps.length > 0
                ? validSteps
                : [{ numero_paso: 1, accion: '', status: 'pending' as const, stepId: '', evidences: [], notes: '' }];

            const stepRows = stepsToRender.flatMap((step, stepIndex) => {
                const stepNumber = step.numero_paso ?? (stepIndex + 1);
                const stepAction = step.accion?.trim() || `Paso ${stepNumber}`;

                const cols = Math.max(1, Number((step as any).evidenceColumns) || 1);
                const rows = Math.max(1, Number((step as any).evidenceRows) || 1);
                const isGrid = cols > 1 || rows > 1;

                // Re-hidratar evidencias con base64 para este paso
                const hydratedEvidences = (step.evidences || []).map(ev => {
                    const realImg = imageMap.get(ev.id);
                    return realImg ? { ...ev, base64Data: realImg.base64Data } : ev;
                });

                const mainRow = new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            children: [
                                new Paragraph({
                                    text: `${stepNumber}. ${stepAction}`,
                                    alignment: AlignmentType.LEFT
                                })
                            ]
                        }),
                        new TableCell({
                            width: { size: 75, type: WidthType.PERCENTAGE },
                            margins: isGrid ? { top: 0, bottom: 0, left: 0, right: 0 } : undefined,
                            children: this.buildEvidenceGrid(hydratedEvidences, cols, rows, step.notes)
                        })
                    ]
                });

                return [mainRow];
            });

            // Encabezado de tabla — idéntico a exportToDOCX
            const headerRow = new TableRow({
                children: [
                    new TableCell({
                        width: { size: 25, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                    new TextRun({ text: 'Paso a paso', bold: true, underline: {} })
                                ]
                            })
                        ]
                    }),
                    new TableCell({
                        width: { size: 75, type: WidthType.PERCENTAGE },
                        children: [
                            new Paragraph({
                                alignment: AlignmentType.CENTER,
                                children: [
                                    new TextRun({ text: 'Evidencias', bold: true, underline: {} })
                                ]
                            })
                        ]
                    })
                ]
            });

            children.push(new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [headerRow, ...stepRows]
            }));
        }

        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        size: {
                            width: this.CUSTOM_PAGE_SIZE_TWIP,
                            height: this.CUSTOM_PAGE_SIZE_TWIP,
                        },
                    },
                },
                children: children,
            }],
        });

        const blob = await Packer.toBlob(doc);
        const filename = this.escapeFilename(`${hu?.id || 'HU'}_Ejecucion_${Date.now()}.docx`);
        saveAs(blob, filename);
    }

    /**
     * Construye un grid anidado (tabla) para las evidencias si el usuario ha configurado cols > 1 o rows > 1
     */
    private buildEvidenceGrid(evidences: any[], cols: number = 1, rows: number = 1, notes?: string): Array<Paragraph | Table> {
        if (!evidences || evidences.length === 0) {
            return this.buildEvidenceCellContent(evidences, notes);
        }

        const validCols = Math.max(1, cols || 1);
        const validRows = Math.max(1, rows || 1);

        if (validCols === 1 && validRows === 1) {
            return this.buildEvidenceCellContent(evidences, notes);
        }

        const paragraphs: Array<Paragraph | Table> = [];
        const tableRows: TableRow[] = [];
        let evIndex = 0;

        for (let r = 0; r < validRows; r++) {
            const tableCells: TableCell[] = [];
            for (let c = 0; c < validCols; c++) {
                const cellEvidences = (evIndex < evidences.length) ? [evidences[evIndex]] : [];
                tableCells.push(new TableCell({
                    width: { size: 100 / validCols, type: WidthType.PERCENTAGE },
                    children: this.buildEvidenceCellContent(cellEvidences, undefined, true, validCols)
                }));
                evIndex++;
            }
            tableRows.push(new TableRow({ children: tableCells }));
        }

        paragraphs.push(new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            layout: TableLayoutType.FIXED,
            borders: {
                top: { style: BorderStyle.NONE, size: 0, color: "auto" },
                bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
                left: { style: BorderStyle.NONE, size: 0, color: "auto" },
                right: { style: BorderStyle.NONE, size: 0, color: "auto" },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "auto" },
                insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "auto" }
            },
            rows: tableRows
        }));

        if (notes?.trim()) {
            paragraphs.push(new Paragraph({
                spacing: { before: 60, after: 60 },
                children: [
                    new TextRun({ text: 'Nota: ', bold: true }),
                    new TextRun({ text: notes, italics: true })
                ]
            }));
        }

        return paragraphs;
    }

    /**
     * Construye el contenido de la celda de evidencias.
     * Si hay imágenes, las incrusta; si no, muestra el placeholder.
     */
    private buildEvidenceCellContent(evidences: any[], notes?: string, isNestedCell: boolean = false, cols: number = 1): Paragraph[] {
        const paragraphs: Paragraph[] = [];

        if (!evidences || evidences.length === 0) {
            if (isNestedCell) {
                // Dejar espacio vacío, pero con un size o spacing para que la celda mantenga forma visible
                return [new Paragraph({
                    text: ' ',
                    spacing: { before: 200, after: 200 }
                })];
            } else {
                paragraphs.push(new Paragraph({
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 120, after: 120 },
                    children: [
                        new TextRun({
                            text: this.EVIDENCE_PLACEHOLDER,
                            bold: true,
                            underline: {}
                        })
                    ]
                }));
                paragraphs.push(new Paragraph(''));
            }
        } else {
            evidences.forEach((evidence) => {
                try {
                    const dataUrl: string = evidence.base64Data;

                    // Extraer mime type y datos base64 del data URL
                    const mimeMatch = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
                    if (!mimeMatch) throw new Error('Formato base64 inválido');

                    const mimeType = mimeMatch[1]; // ej: "image/png", "image/jpeg"
                    const base64Str = mimeMatch[2];

                    // Convertir base64 a Uint8Array (compatible con browser, sin Buffer)
                    const binaryStr = atob(base64Str);
                    const bytes = new Uint8Array(binaryStr.length);
                    for (let i = 0; i < binaryStr.length; i++) {
                        bytes[i] = binaryStr.charCodeAt(i);
                    }

                    // Tipo para docx: extraer "png", "jpg", etc.
                    const imgType = mimeType.split('/')[1]?.replace('jpeg', 'jpg') as any || 'png';

                    const dims = this.scaleImageDimensions(
                        evidence.naturalWidth || 1280,
                        evidence.naturalHeight || 720,
                        isNestedCell ? Math.max(100, 900 / cols) : 900,
                        isNestedCell ? 450 : 675
                    );

                    paragraphs.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 120, after: 120 },
                        children: [
                            new ImageRun({
                                data: bytes,
                                transformation: { width: dims.width, height: dims.height },
                                type: imgType
                            })
                        ]
                    }));
                } catch (err) {
                    console.error('Error al incrustar imagen en DOCX:', err);
                    paragraphs.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 120, after: 120 },
                        children: [
                            new TextRun({
                                text: this.EVIDENCE_PLACEHOLDER,
                                bold: true,
                                underline: {}
                            })
                        ]
                    }));
                    paragraphs.push(new Paragraph(''));
                }
            });
        }

        if (notes?.trim()) {
            paragraphs.push(new Paragraph({
                spacing: { before: 60, after: 60 },
                children: [
                    new TextRun({ text: 'Nota: ', bold: true }),
                    new TextRun({ text: notes, italics: true })
                ]
            }));
        }

        return paragraphs;
    }

    /**
     * Escala dimensiones manteniendo proporción dentro del máximo indicado.
     */
    private scaleImageDimensions(
        w: number, h: number, maxW: number, maxH: number
    ): { width: number; height: number } {
        if (w <= 0 || h <= 0) return { width: maxW, height: maxH };
        const ratio = Math.min(maxW / w, maxH / h, 1);
        return { width: Math.round(w * ratio), height: Math.round(h * ratio) };
    }
    private escapeCsvField(field: string | number | undefined | null): string {
        if (field === null || field === undefined) return '';

        const stringValue = String(field);
        if (
            stringValue.includes('"') ||
            stringValue.includes(',') ||
            stringValue.includes('\n') ||
            stringValue.includes('\r')
        ) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }

        return stringValue;
    }

    /**
     * Escapa un nombre de archivo
     */
    private escapeFilename(filename: string): string {
        return filename.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /**
     * Escapa HTML para exportación
     */
    escapeHtml(text: string | undefined | null): string {
        return text
            ? text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;')
            : '';
    }

    /**
     * Formatea títulos de escenarios simples
     */
    formatSimpleScenarioTitles(titles: string[]): string {
        if (!titles || titles.length === 0) {
            return 'No se generaron escenarios.';
        }
        return titles.map((title, index) => `${index + 1}. ${title}`).join('\n');
    }

    /**
     * Exporta contenido HTML a un archivo
     */
    exportToHTML(htmlContent: string, filename: string): void {
        const blob = new Blob(['\uFEFF', htmlContent], { type: 'text/html;charset=utf-8' });
        const safeFilename = `${this.escapeFilename(filename)}_Fallback.html`;
        saveAs(blob, safeFilename);
    }
}
