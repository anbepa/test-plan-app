import { Injectable } from '@angular/core';
import { HUData, PlanExecution, TestCaseExecution, ExecutionStep, AssetEvidence } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
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
    TableLayoutType,
    InternalHyperlink,
    HeadingLevel,
    BookmarkStart,
    BookmarkEnd,
    ShadingType
} from 'docx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

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

        const filename = this.escapeFilename(`${hu.id}_Matriz.csv`);
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

        // --- PRIMERA PÁGINA: TABLA DE ESCENARIOS (Normas APA) ---
        children.push(new Paragraph({
            text: `Nombre de hu: ${hu.title}`,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        children.push(new Paragraph({
            text: "Matriz de Escenarios de Prueba",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        const scenariosHeader = new TableRow({
            children: [
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "N°", bold: true })], alignment: AlignmentType.CENTER })]
                }),
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "Escenario de Prueba", bold: true })], alignment: AlignmentType.CENTER })]
                })
            ]
        });

        const scenariosRows = hu.detailedTestCases.map((tc, idx) => {
            const scenarioId = `Scenario_${idx + 1}`;
            return new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({ text: `${idx + 1}`, alignment: AlignmentType.CENTER })]
                    }),
                    new TableCell({
                        children: [
                            new Paragraph({
                                children: [
                                    new InternalHyperlink({
                                        children: [
                                            new TextRun({
                                                text: tc.title || `Escenario ${idx + 1}`,
                                                color: "2E74B5",
                                                bold: true
                                            })
                                        ],
                                        anchor: scenarioId
                                    })
                                ]
                            })
                        ]
                    })
                ]
            });
        });

        children.push(new Table({
            layout: TableLayoutType.AUTOFIT,
            alignment: AlignmentType.CENTER,
            rows: [scenariosHeader, ...scenariosRows]
        }));

        // --- CONTENIDO DE ESCENARIOS ---
        hu.detailedTestCases.forEach((testCase, index) => {
            const scenarioNumber = index + 1;
            const scenarioId = `Scenario_${scenarioNumber}`;
            const scenarioTitle = testCase.title?.trim()
                ? `${scenarioNumber}. ${testCase.title.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            children.push(new Paragraph({
                children: [
                    new BookmarkStart(scenarioId, index),
                    new TextRun({
                        text: scenarioTitle,
                        color: "2E74B5",
                        bold: true
                    }),
                    new BookmarkEnd(index)
                ],
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true,
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

            children.push(new Paragraph({
                spacing: { before: 200, after: 200 },
                children: [
                    new TextRun({ text: 'Resultado Esperado: ', bold: true }),
                    new TextRun({ text: testCase.expectedResults || 'N/A' })
                ]
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
        const filename = this.escapeFilename(`Matriz - ${hu.title}.docx`);
        saveAs(blob, filename);
    }

    /**
     * Exporta una ejecución del plan con evidencias en formato DOCX.
     * Mismo formato que exportToDOCX: página 55.8cm, tabla 25/75%, 1 página por escenario.
     * La columna de evidencias contiene las imágenes reales subidas por el usuario.
     */
    async exportExecutionToDOCX(
        execution: PlanExecution,
        hu: HUData | null,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        if (!execution.testCases || execution.testCases.length === 0) {
            throw new Error('No hay casos de prueba para exportar');
        }

        // Asegurar que el índice de Storage esté construido UNA sola vez antes del loop
        await this.storageService.buildStorageIndex();
        const total = execution.testCases.length;

        const children: Array<Paragraph | Table> = [];

        // --- PRIMERA PÁGINA: TABLA DE ESCENARIOS (Normas APA) ---
        children.push(new Paragraph({
            text: `Nombre de hu: ${hu?.title || execution.huTitle}`,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        children.push(new Paragraph({
            text: "Reporte de Ejecución de Pruebas",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        const scenariosHeader = new TableRow({
            children: [
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "N°", bold: true })], alignment: AlignmentType.CENTER })]
                }),
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "Escenario de Prueba", bold: true })], alignment: AlignmentType.CENTER })]
                })
            ]
        });

        const scenariosRows = execution.testCases.map((tc, idx) => {
            const scenarioId = `Exec_Scenario_${idx + 1}`;
            return new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({ text: `${idx + 1}`, alignment: AlignmentType.CENTER })]
                    }),
                    new TableCell({
                        children: [
                            new Paragraph({
                                children: [
                                    new InternalHyperlink({
                                        children: [
                                            new TextRun({
                                                text: tc.title || `Escenario ${idx + 1}`,
                                                color: "2E74B5",
                                                bold: true
                                            })
                                        ],
                                        anchor: scenarioId
                                    })
                                ]
                            })
                        ]
                    })
                ]
            });
        });

        children.push(new Table({
            layout: TableLayoutType.AUTOFIT,
            alignment: AlignmentType.CENTER,
            rows: [scenariosHeader, ...scenariosRows]
        }));

        // --- CONTENIDO DE ESCENARIOS ---
        for (let index = 0; index < execution.testCases.length; index++) {
            const testCase = execution.testCases[index];
            const scenarioNumber = index + 1;
            const scenarioId = `Exec_Scenario_${scenarioNumber}`;
            const scenarioTitle = testCase.title?.trim()
                ? `${scenarioNumber}. ${testCase.title.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            // ── Opción B: hidratar solo las evidencias de este test-case ──
            const allStepEvidences = testCase.steps.flatMap(s => s.evidences || []);
            if (allStepEvidences.length > 0) {
                await this.storageService.hydrateStepEvidence(allStepEvidences);
            }

            // Reportar progreso al componente
            onProgress?.(index + 1, total);

            children.push(new Paragraph({
                children: [
                    new BookmarkStart(scenarioId, index),
                    new TextRun({
                        text: scenarioTitle,
                        color: "2E74B5",
                        bold: true
                    }),
                    new BookmarkEnd(index)
                ],
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true,
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

                // Leer evidencias desde caché (ya hidratadas arriba)
                const hydratedEvidences = (step.evidences || []).map(ev => {
                    const cached = this.storageService.getCachedImage(ev.id);
                    return cached ? { ...ev, base64Data: cached.base64Data } : ev;
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

            children.push(new Paragraph({
                spacing: { before: 200, after: 200 },
                children: [
                    new TextRun({ text: 'Resultado Esperado: ', bold: true }),
                    new TextRun({ text: testCase.expectedResults || 'N/A' })
                ]
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
        const filename = this.escapeFilename(`Ejecución - ${hu?.title || execution.huTitle}.docx`);
        saveAs(blob, filename);
    }

    /**
     * Exporta reportes de análisis de evidencias a DOCX.
     * Mantiene el formato de Ejecución: página 55.8cm, tabla 25/75%, 1 página por escenario.
     */
    async exportEvidenceAnalysisToDOCX(
        reports: any[],
        huNumber: string,
        huTitle?: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        if (!reports || reports.length === 0) {
            throw new Error('No hay reportes para exportar');
        }

        const total = reports.length;
        const children: Array<Paragraph | Table> = [];

        // --- PRIMERA PÁGINA: TABLA DE ESCENARIOS ---
        children.push(new Paragraph({
            text: `Reporte de Evidencias - HU: ${huNumber}${huTitle ? ' | ' + huTitle : ''}`,
            heading: HeadingLevel.TITLE,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        children.push(new Paragraph({
            text: "Matriz de Escenarios y Evidencias",
            heading: HeadingLevel.HEADING_1,
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 }
        }));

        const scenariosHeader = new TableRow({
            children: [
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "N°", bold: true })], alignment: AlignmentType.CENTER })]
                }),
                new TableCell({
                    children: [new Paragraph({ children: [new TextRun({ text: "Escenario de Prueba", bold: true })], alignment: AlignmentType.CENTER })]
                })
            ]
        });

        const scenariosRows = reports.map((report, idx) => {
            const scenarioId = `Evid_Scenario_${idx + 1}`;
            return new TableRow({
                children: [
                    new TableCell({
                        children: [new Paragraph({ text: `${idx + 1}`, alignment: AlignmentType.CENTER })]
                    }),
                    new TableCell({
                        children: [
                            new Paragraph({
                                children: [
                                    new InternalHyperlink({
                                        children: [
                                            new TextRun({
                                                text: report.nombre_del_escenario || `Escenario ${idx + 1}`,
                                                color: "2E74B5",
                                                bold: true
                                            })
                                        ],
                                        anchor: scenarioId
                                    })
                                ]
                            })
                        ]
                    })
                ]
            });
        });

        children.push(new Table({
            layout: TableLayoutType.AUTOFIT,
            alignment: AlignmentType.CENTER,
            rows: [scenariosHeader, ...scenariosRows]
        }));

        // --- CONTENIDO DE ESCENARIOS ---
        for (let index = 0; index < reports.length; index++) {
            const report = reports[index];
            const scenarioNumber = index + 1;
            const scenarioId = `Evid_Scenario_${scenarioNumber}`;
            const scenarioTitle = report.nombre_del_escenario?.trim()
                ? `${scenarioNumber}. ${report.nombre_del_escenario.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            onProgress?.(index + 1, total);

            children.push(new Paragraph({
                children: [
                    new BookmarkStart(scenarioId, index),
                    new TextRun({
                        text: scenarioTitle,
                        color: "2E74B5",
                        bold: true
                    }),
                    new BookmarkEnd(index)
                ],
                heading: HeadingLevel.HEADING_1,
                pageBreakBefore: true,
                spacing: { after: 240 }
            }));

            const headerRow = new TableRow({
                children: [
                    new TableCell({
                        width: { size: 25, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Paso a paso', bold: true, underline: {} })] })]
                    }),
                    new TableCell({
                        width: { size: 75, type: WidthType.PERCENTAGE },
                        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: 'Evidencias', bold: true, underline: {} })] })]
                    })
                ]
            });

            const steps = report.test_scenario_steps || [];
            const stepRows = [];

            for (const step of steps) {
                const stepNumber = step.numero_paso;
                const stepAction = step.descripcion_accion_observada || `Paso ${stepNumber}`;

                // Buscar imágenes asociadas a este paso (todas)
                let stepImages = report.report_images?.filter((img: any) => img.step_id === step.id) || [];

                // FALLBACK: Si no hay imágenes por ID (común tras refinar), buscar por referencia/orden
                if (stepImages.length === 0 && step.imagen_referencia) {
                    const match = step.imagen_referencia.match(/\d+/);
                    if (match) {
                        const order = parseInt(match[0], 10);
                        const fallbackImg = report.report_images?.find((img: any) => img.image_order === order);
                        if (fallbackImg) stepImages = [fallbackImg];
                    }
                }
                
                const evidenceContent: (Paragraph | Table)[] = [];

                if (stepImages.length > 0) {
                    for (const imgData of stepImages) {
                        if (imgData.image_url) {
                            try {
                                const imgRes = await this.fetchImageAsUint8Array(imgData.image_url);
                                if (imgRes) {
                                    const dims = this.scaleImageDimensions(imgRes.width, imgRes.height, 900, 675);
                                    evidenceContent.push(new Paragraph({
                                        alignment: AlignmentType.CENTER,
                                        spacing: { before: 120, after: 120 },
                                        children: [
                                            new ImageRun({
                                                data: imgRes.bytes,
                                                transformation: { width: dims.width, height: dims.height },
                                                type: imgRes.type as any
                                            })
                                        ]
                                    }));
                                }
                            } catch (err) {}
                        }
                    }
                } else {
                    evidenceContent.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 120, after: 120 },
                        children: [new TextRun({ text: this.EVIDENCE_PLACEHOLDER, bold: true, underline: {} })]
                    }));
                }

                stepRows.push(new TableRow({
                    children: [
                        new TableCell({
                            width: { size: 25, type: WidthType.PERCENTAGE },
                            children: [new Paragraph({ text: `${stepNumber}. ${stepAction}`, alignment: AlignmentType.LEFT })]
                        }),
                        new TableCell({
                            width: { size: 75, type: WidthType.PERCENTAGE },
                            children: evidenceContent
                        })
                    ]
                }));
            }

            children.push(new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                rows: [headerRow, ...stepRows]
            }));

            children.push(new Paragraph({
                spacing: { before: 200, after: 200 },
                children: [
                    new TextRun({ text: 'Resultado Esperado: ', bold: true }),
                    new TextRun({ text: report.resultado_obtenido || 'Exitoso' })
                ]
            }));
        }

        const doc = new Document({
            sections: [{
                properties: {
                    page: {
                        size: { width: this.CUSTOM_PAGE_SIZE_TWIP, height: this.CUSTOM_PAGE_SIZE_TWIP },
                    },
                },
                children: children,
            }],
        });

        const blob = await Packer.toBlob(doc);
        const filename = this.escapeFilename(`Reporte_Evidencias_HU_${huNumber}.docx`);
        saveAs(blob, filename);
    }

    private async fetchImageAsUint8Array(url: string): Promise<{ bytes: Uint8Array, type: string, width: number, height: number } | null> {
        try {
            const response = await fetch(url);
            const buffer = await response.arrayBuffer();
            const contentType = response.headers.get('content-type') || 'image/png';
            const type = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'png';
            
            const bytes = new Uint8Array(buffer);
            
            // Get original dimensions to prevent pixelation on export
            const blob = new Blob([buffer], { type: contentType });
            const objUrl = URL.createObjectURL(blob);
            const dimensions = await new Promise<{width: number, height: number}>((resolve) => {
                const img = new Image();
                img.onload = () => {
                    resolve({ width: img.naturalWidth || 1280, height: img.naturalHeight || 720 });
                    URL.revokeObjectURL(objUrl);
                };
                img.onerror = () => {
                    resolve({ width: 1280, height: 720 });
                    URL.revokeObjectURL(objUrl);
                };
                img.src = objUrl;
            });

            return { bytes, type, width: dimensions.width, height: dimensions.height };
        } catch (e) {
            console.error('Error fetching image for DOCX:', e);
            return null;
        }
    }

    /**
     * Construye un grid anidado (tabla) para las evidencias si el usuario ha configurado cols > 1 o rows > 1
     */
    private buildEvidenceGrid(evidences: any[], cols: number = 1, rows: number = 1, notes?: string): Array<Paragraph | Table> {
        if (!evidences || evidences.length === 0) {
            return this.buildEvidenceCellContent(evidences, notes);
        }

        const validCols = Math.max(1, cols || 1);
        let validRows = Math.max(1, rows || 1);

        // Auto-calcular filas necesarias para no perder evidencias
        const requiredRows = Math.ceil(evidences.length / validCols);
        if (requiredRows > validRows) {
            validRows = requiredRows;
        }

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
                    children: this.buildEvidenceCellContent(cellEvidences, undefined, true, validCols) as any
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
                insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "000000" },
                insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "000000" }
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
    private buildEvidenceCellContent(evidences: any[], notes?: string, isNestedCell: boolean = false, cols: number = 1): (Paragraph | Table)[] {
        const paragraphs: (Paragraph | Table)[] = [];

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
                    if (evidence.type === 'csv' && evidence.tabularData) {
                        paragraphs.push(...this.buildTabularDataParagraphs(evidence));
                        return;
                    }

                    const dataUrl: string = evidence.base64Data;
                    if (!dataUrl) return;

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
                    console.error('Error al incrustar evidencia en DOCX:', err);
                    paragraphs.push(new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 120, after: 120 },
                        children: [
                            new TextRun({
                                text: `[Error al cargar ${evidence.type === 'csv' ? 'datos' : 'imagen'}]`,
                                bold: true,
                                color: "FF0000"
                            })
                        ]
                    }));
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
     * Crea una tabla de Word a partir de AssetEvidence de tipo CSV.
     */
    private buildTabularDataParagraphs(evidence: AssetEvidence): (Paragraph | Table)[] {
        if (!evidence.tabularData || evidence.tabularData.length === 0) return [];

        const hasHeader = evidence.csvConfig?.hasHeader ?? true;
        const rows: TableRow[] = [];

        evidence.tabularData.forEach((row, rIndex) => {
            const rowColor = (evidence.rowColors && evidence.rowColors[rIndex] && evidence.rowColors[rIndex] !== 'transparent')
                ? evidence.rowColors[rIndex].replace('#', '')
                : undefined;

            const cells: TableCell[] = row.map((cell) => {
                const fill = rowColor || ((hasHeader && rIndex === 0) ? "F1F5F9" : undefined);

                return new TableCell({
                    shading: fill ? { fill: fill.toUpperCase(), type: ShadingType.CLEAR } : undefined,
                    children: [
                        new Paragraph({
                            children: [
                                new TextRun({
                                    text: String(cell || ''),
                                    bold: (hasHeader && rIndex === 0),
                                    size: 16 // 8pt aprox
                                })
                            ],
                            alignment: AlignmentType.CENTER
                        })
                    ]
                });
            });
            rows.push(new TableRow({ children: cells }));
        });

        const wordTable = new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: rows,
            borders: {
                top: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                bottom: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                left: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                right: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" },
                insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "E2E8F0" }
            }
        });

        return [
            wordTable,
            new Paragraph('') // Espaciador
        ];
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
        // Reemplazar caracteres no permitidos en sistemas de archivos por guiones o espacios
        return filename.replace(/[\\/:*?"<>|]/g, '-').trim();
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


    /**
     * Exporta la ejecución completa a PDF, imitando el diseño de DOCX.
     */
    async exportExecutionToPDF(
        execution: PlanExecution,
        hu: HUData | null,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        if (!execution || !execution.testCases || execution.testCases.length === 0) {
            throw new Error('No hay casos de prueba para exportar');
        }

        // Asegurar que el índice de Storage esté construido una sola vez
        await this.storageService.buildStorageIndex();
        const total = execution.testCases.length;

        // Tamaño personalizado cuadrado: 1583.75 pt (55.8 cm)
        const pageSize = 1583.75;
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'pt',
            format: [pageSize, pageSize]
        });
        const margin = 72; // Margen de 1 pulgada (72 pt)

        // --- PRIMERA PÁGINA: TABLA DE ESCENARIOS (Normas APA) ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        const mainTitle = `Nombre de hu: ${hu?.title || execution.huTitle}`;
        const titleWidth = doc.getTextWidth(mainTitle);
        doc.text(mainTitle, (pageSize - titleWidth) / 2, margin + 50);

        doc.setFontSize(18);
        const subTitle = "Reporte de Ejecución de Pruebas";
        const subTitleWidth = doc.getTextWidth(subTitle);
        doc.text(subTitle, (pageSize - subTitleWidth) / 2, margin + 100);

        // Tabla de escenarios
        const summaryHeaders = [['N°', 'Escenario de Pruebas']];
        const summaryBody = execution.testCases.map((tc, idx) => [
            (idx + 1).toString(),
            tc.title || `Escenario ${idx + 1}`
        ]);

        autoTable(doc, {
            startY: margin + 160,
            margin: { left: margin, right: margin },
            head: summaryHeaders,
            body: summaryBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 116, 181], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            bodyStyles: { textColor: [0, 0, 0], font: 'helvetica', fontSize: 11 },
            columnStyles: {
                0: { cellWidth: 50, halign: 'center' },
                1: { cellWidth: 'auto' }
            },
            styles: {
                lineWidth: 0.5,
                lineColor: [0, 0, 0]
            }
        });

        // --- CONTENIDO DE ESCENARIOS ---
        for (let index = 0; index < execution.testCases.length; index++) {
            const testCase = execution.testCases[index];
            const scenarioNumber = index + 1;
            const scenarioTitle = testCase.title?.trim()
                ? `${scenarioNumber}. ${testCase.title.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            // Hydrate step evidences
            const allStepEvidences = testCase.steps.flatMap(s => s.evidences || []);
            if (allStepEvidences.length > 0) {
                await this.storageService.hydrateStepEvidence(allStepEvidences);
            }

            // Report progress
            onProgress?.(index + 1, total);

            // Add new page for each scenario
            doc.addPage();

            // Scenario Title at top left of new page — wrapped to avoid overflow
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(46, 116, 181); // #2E74B5
            const titleLines = doc.splitTextToSize(scenarioTitle, pageSize - 2 * margin);
            doc.text(titleLines, margin, margin + 20);

            // Reset text color
            doc.setTextColor(0, 0, 0);

            // Line height for font size 18 is ~22 pt; push table down if title wraps
            const titleBlockHeight = titleLines.length * 22;
            const tableStartY = margin + 20 + titleBlockHeight + 10;

            const validSteps = Array.isArray(testCase.steps) ? testCase.steps : [];
            const stepsToRender = validSteps.length > 0
                ? validSteps
                : [{ numero_paso: 1, accion: '', status: 'pending' as const, stepId: '', evidences: [], notes: '' }];

            const tableBody = [];
            const stepLayouts: any[] = []; // Guardar info de layout por fila
            
            const cellWidthCol1 = 359.94; // 25% of printable width
            const cellWidthCol2 = 1079.81; // 75% of printable width
            const innerPadding = 15;

            for (let sIdx = 0; sIdx < stepsToRender.length; sIdx++) {
                const step = stepsToRender[sIdx];
                const stepNumber = step.numero_paso ?? (sIdx + 1);
                const stepAction = step.accion?.trim() || `Paso ${stepNumber}`;

                const cols = Math.max(1, Number((step as any).evidenceColumns) || 1);
                const rowsConfig = Math.max(1, Number((step as any).evidenceRows) || 1);

                // Get hydrated evidences
                const hydratedEvidences = (step.evidences || []).map(ev => {
                    const cached = this.storageService.getCachedImage(ev.id);
                    return cached ? { ...ev, base64Data: cached.base64Data } : ev;
                });

                // Calculate layout details for evidences in column 2
                // Calculate grid size
                let validCols = cols;
                let validRows = rowsConfig;
                if (hydratedEvidences.length > 0) {
                    const reqRows = Math.ceil(hydratedEvidences.length / validCols);
                    if (reqRows > validRows) {
                        validRows = reqRows;
                    }
                }

                const colWidth = (cellWidthCol2 - (validCols + 1) * innerPadding) / validCols;
                const maxW = Math.min(colWidth, validCols === 1 ? 900 : 900 / validCols);
                const maxH = validCols === 1 
                    ? (validRows === 1 ? 675 : Math.min(675, 1100 / validRows))
                    : Math.min(450, 1100 / validRows);

                // Build grid arrays
                const grid: any[][] = [];
                const rowHeights: number[] = [];
                let evIndex = 0;

                if (hydratedEvidences.length === 0) {
                    // Empty evidence layout
                    rowHeights.push(40); // Height of placeholder text
                } else {
                    for (let r = 0; r < validRows; r++) {
                        let maxRowHeight = 0;
                        const gridRow = [];
                        for (let c = 0; c < validCols; c++) {
                            const ev = (evIndex < hydratedEvidences.length) ? hydratedEvidences[evIndex] : null;
                            gridRow.push(ev);
                            if (ev) {
                                let h = 0;
                                if (ev.type === 'csv') {
                                    h = (ev.tabularData?.length || 0) * 18 + 10;
                                } else {
                                    // image dimensions
                                    const imgW = ev.naturalWidth || 1280;
                                    const imgH = ev.naturalHeight || 720;
                                    const dims = this.scaleImageDimensions(imgW, imgH, maxW, maxH);
                                    h = dims.height;
                                }
                                if (h > maxRowHeight) maxRowHeight = h;
                            }
                            evIndex++;
                        }
                        grid.push(gridRow);
                        rowHeights.push(maxRowHeight);
                    }
                }

                const notesHeight = step.notes?.trim() ? 25 : 0;
                const totalCellHeight = rowHeights.reduce((sum, val) => sum + val, 0) + (rowHeights.length + 1) * innerPadding + notesHeight;

                tableBody.push([
                    { content: `${stepNumber}. ${stepAction}`, styles: { minCellHeight: totalCellHeight } },
                    { content: hydratedEvidences.length === 0 ? this.EVIDENCE_PLACEHOLDER : '', styles: { minCellHeight: totalCellHeight } }
                ]);

                stepLayouts.push({
                    rowIndex: sIdx,
                    evidences: hydratedEvidences,
                    grid,
                    rowHeights,
                    cols: validCols,
                    rows: validRows,
                    colWidth,
                    maxW,
                    maxH,
                    notes: step.notes
                });
            }

            autoTable(doc, {
                startY: tableStartY,
                margin: { left: margin, right: margin },
                head: [['Paso a paso', 'Evidencias']],
                body: tableBody,
                theme: 'grid',
                rowPageBreak: 'avoid',
                headStyles: { fillColor: [46, 116, 181], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
                styles: {
                    lineWidth: 0.5,
                    lineColor: [0, 0, 0],
                    textColor: [0, 0, 0],
                    font: 'helvetica',
                    fontSize: 11,
                    valign: 'top',
                    cellPadding: 8
                },
                columnStyles: {
                    0: { cellWidth: cellWidthCol1 },
                    1: { cellWidth: cellWidthCol2 }
                },
                didDrawCell: (data) => {
                    if (data.section === 'body' && data.column.index === 1) {
                        const layout = stepLayouts.find(l => l.rowIndex === data.row.index);
                        if (!layout) return;

                        const cellX = data.cell.x;
                        const cellY = data.cell.y;

                        if (layout.evidences.length === 0) {
                            // Draw placeholder text vertically centered in cell
                            doc.setFont('helvetica', 'bold');
                            doc.setFontSize(11);
                            // Draw text underlined
                            const textW = doc.getTextWidth(this.EVIDENCE_PLACEHOLDER);
                            const textX = cellX + (cellWidthCol2 - textW) / 2;
                            const textY = cellY + (data.cell.height + 11) / 2 - 3;
                            doc.text(this.EVIDENCE_PLACEHOLDER, textX, textY);
                            // Draw underline line
                            doc.setDrawColor(0);
                            doc.setLineWidth(0.5);
                            doc.line(textX, textY + 2, textX + textW, textY + 2);
                        } else {
                            // Draw grid of evidences
                            let currentY = cellY + innerPadding;
                            for (let r = 0; r < layout.rows; r++) {
                                const rowH = layout.rowHeights[r];
                                for (let c = 0; c < layout.cols; c++) {
                                    const currentX = cellX + innerPadding + c * (layout.colWidth + innerPadding);
                                    const ev = layout.grid[r]?.[c];

                                    // Draw grid cell border whenever grid has more than 1 slot
                                    if (layout.cols > 1 || layout.rows > 1) {
                                        doc.setDrawColor(0);
                                        doc.setLineWidth(0.5);
                                        doc.rect(currentX, currentY, layout.colWidth, rowH);
                                    }

                                    if (ev) {
                                        if (ev.type === 'csv') {
                                            // Draw subtable using autoTable nested.
                                            // IMPORTANT: do NOT use tableWidth — with many columns that
                                            // makes each column a few pt wide (headers split character-by-character).
                                            // Instead constrain via right margin so autoTable distributes
                                            // column widths proportionally within the available slot.
                                            const hasHeader = ev.csvConfig?.hasHeader ?? true;
                                            const csvRightMargin = pageSize - (currentX + layout.colWidth);
                                            autoTable(doc, {
                                                startY: currentY,
                                                margin: { left: currentX, right: Math.max(csvRightMargin, 0) },
                                                head: hasHeader ? [ev.tabularData[0]] : undefined,
                                                body: hasHeader ? ev.tabularData.slice(1) : ev.tabularData,
                                                theme: 'grid',
                                                styles: {
                                                    fontSize: 6,
                                                    cellPadding: 1.5,
                                                    lineWidth: 0.3,
                                                    lineColor: [226, 232, 240],
                                                    overflow: 'linebreak',
                                                    minCellWidth: 15
                                                },
                                                headStyles: {
                                                    fillColor: [241, 245, 249],
                                                    textColor: [0, 0, 0],
                                                    fontStyle: 'bold',
                                                    fontSize: 6
                                                },
                                                didParseCell: (cellData) => {
                                                    const rIdx = cellData.row.index + (hasHeader ? 1 : 0);
                                                    if (ev.rowColors && ev.rowColors[rIdx] && ev.rowColors[rIdx] !== 'transparent') {
                                                        const hex = ev.rowColors[rIdx].replace('#', '');
                                                        const rVal = parseInt(hex.substring(0, 2), 16);
                                                        const gVal = parseInt(hex.substring(2, 4), 16);
                                                        const bVal = parseInt(hex.substring(4, 6), 16);
                                                        cellData.cell.styles.fillColor = [rVal, gVal, bVal];
                                                    }
                                                }
                                            });

                                        } else if (ev.base64Data) {
                                            // Draw image
                                            try {
                                                const format = ev.base64Data.match(/data:image\/([a-zA-Z]+);/)?.[1] || 'PNG';
                                                const imgW = ev.naturalWidth || 1280;
                                                const imgH = ev.naturalHeight || 720;
                                                const dims = this.scaleImageDimensions(imgW, imgH, layout.maxW, layout.maxH);
                                                
                                                const imageX = currentX + (layout.colWidth - dims.width) / 2;
                                                const imageY = currentY + (rowH - dims.height) / 2;
                                                
                                                doc.addImage(ev.base64Data, format, imageX, imageY, dims.width, dims.height);
                                                
                                                // Draw border around image (only when no grid cell border already drawn)
                                                if (layout.cols === 1 && layout.rows === 1) {
                                                    doc.setDrawColor(0);
                                                    doc.setLineWidth(0.5);
                                                    doc.rect(imageX, imageY, dims.width, dims.height);
                                                }
                                            } catch (err) {
                                                console.error('Error drawing image inside autoTable cell:', err);
                                            }
                                        }
                                    }
                                }
                                currentY += rowH + innerPadding;
                            }

                            // Draw notes if any
                            if (layout.notes?.trim()) {
                                doc.setFont('helvetica', 'bold');
                                doc.setFontSize(10);
                                const notesX = cellX + innerPadding;
                                const notesY = currentY;
                                doc.text('Nota: ', notesX, notesY);
                                const labelW = doc.getTextWidth('Nota: ');
                                doc.setFont('helvetica', 'italic');
                                doc.text(layout.notes, notesX + labelW, notesY);
                            }
                        }
                    }
                }
            });

            // Expected Results
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            const expectedY = (doc as any).lastAutoTable.finalY + 30;
            doc.text('Resultado Esperado: ', margin, expectedY);
            const prefixW = doc.getTextWidth('Resultado Esperado: ');
            doc.setFont('helvetica', 'normal');
            doc.text(testCase.expectedResults || 'N/A', margin + prefixW, expectedY);
        }

        const filename = this.escapeFilename(`Ejecución - ${hu?.title || execution.huTitle}.pdf`);
        doc.save(filename);
    }

    /**
     * Exporta reportes de análisis de evidencias a PDF, imitando el diseño de DOCX.
     */
    async exportEvidenceAnalysisToPDF(
        reports: any[],
        huNumber: string,
        huTitle?: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        if (!reports || reports.length === 0) throw new Error('No hay reportes para exportar');

        // Tamaño personalizado cuadrado: 1583.75 pt (55.8 cm)
        const pageSize = 1583.75;
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'pt',
            format: [pageSize, pageSize]
        });
        const margin = 72; // Margen de 1 pulgada (72 pt)

        // --- PRIMERA PÁGINA: TABLA DE ESCENARIOS (Normas APA) ---
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(24);
        const mainTitle = `Reporte de Evidencias - HU: ${huNumber}${huTitle ? ' | ' + huTitle : ''}`;
        const titleWidth = doc.getTextWidth(mainTitle);
        doc.text(mainTitle, (pageSize - titleWidth) / 2, margin + 50);

        doc.setFontSize(18);
        const subTitle = "Matriz de Escenarios y Evidencias";
        const subTitleWidth = doc.getTextWidth(subTitle);
        doc.text(subTitle, (pageSize - subTitleWidth) / 2, margin + 100);

        // Tabla de escenarios
        const summaryHeaders = [['N°', 'Escenario de Prueba']];
        const summaryBody = reports.map((r, idx) => [
            (idx + 1).toString(),
            r.nombre_del_escenario || `Escenario ${idx + 1}`
        ]);

        autoTable(doc, {
            startY: margin + 160,
            margin: { left: margin, right: margin },
            head: summaryHeaders,
            body: summaryBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 116, 181], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
            bodyStyles: { textColor: [0, 0, 0], font: 'helvetica', fontSize: 11 },
            columnStyles: {
                0: { cellWidth: 50, halign: 'center' },
                1: { cellWidth: 'auto' }
            },
            styles: {
                lineWidth: 0.5,
                lineColor: [0, 0, 0]
            }
        });

        // --- CONTENIDO DE ESCENARIOS ---
        for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            const scenarioNumber = i + 1;
            const scenarioTitle = report.nombre_del_escenario?.trim()
                ? `${scenarioNumber}. ${report.nombre_del_escenario.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            onProgress?.(i + 1, reports.length);

            // Add new page for each scenario
            doc.addPage();

            // Scenario Title at top left of new page — wrapped to avoid overflow
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(18);
            doc.setTextColor(46, 116, 181); // #2E74B5
            const titleLinesEvid = doc.splitTextToSize(scenarioTitle, pageSize - 2 * margin);
            doc.text(titleLinesEvid, margin, margin + 20);

            // Reset text color
            doc.setTextColor(0, 0, 0);

            // Line height for font size 18 is ~22 pt; push table down if title wraps
            const titleBlockHeightEvid = titleLinesEvid.length * 22;
            const tableStartYEvid = margin + 20 + titleBlockHeightEvid + 10;

            const steps = report.test_scenario_steps || [];
            const tableBody = [];
            const stepLayouts: any[] = [];
            
            const cellWidthCol1 = 359.94; // 25% of printable width
            const cellWidthCol2 = 1079.81; // 75% of printable width
            const innerPadding = 15;

            for (let j = 0; j < steps.length; j++) {
                const step = steps[j];
                const stepAction = step.descripcion_accion_observada || `Paso ${step.numero_paso}`;

                // Filter report images for this step
                let stepImages = report.report_images?.filter((img: any) => img.step_id === step.id) || [];
                
                // Fallback
                if (stepImages.length === 0 && step.imagen_referencia) {
                    const match = step.imagen_referencia.match(/\d+/);
                    if (match) {
                        const order = parseInt(match[0], 10);
                        const fallbackImg = report.report_images?.find((img: any) => img.image_order === order);
                        if (fallbackImg) stepImages = [fallbackImg];
                    }
                }

                // Pre-fetch images to base64 with original dimensions
                const loadedImages = [];
                for (const img of stepImages) {
                    if (img.image_url) {
                        try {
                            const res = await this.fetchImageAsUint8Array(img.image_url);
                            if (res) {
                                const binary = Array.from(res.bytes).map(b => String.fromCharCode(b)).join('');
                                const b64 = window.btoa(binary);
                                loadedImages.push({
                                    base64Data: `data:image/${res.type};base64,${b64}`,
                                    type: res.type,
                                    width: res.width,
                                    height: res.height
                                });
                            }
                        } catch (err) {
                            console.error('Error loading evidence image for PDF:', err);
                        }
                    }
                }

                // Calculate vertical stack layout
                let totalCellHeight = 0;
                const scaledDimensions: any[] = [];

                if (loadedImages.length === 0) {
                    totalCellHeight = 40; // placeholder height
                } else {
                    const maxH = loadedImages.length === 1 ? 675 : Math.min(675, 1100 / loadedImages.length);
                    let imagesH = 0;
                    for (const img of loadedImages) {
                        const dims = this.scaleImageDimensions(img.width, img.height, 900, maxH);
                        scaledDimensions.push(dims);
                        imagesH += dims.height;
                    }
                    totalCellHeight = imagesH + (loadedImages.length + 1) * innerPadding;
                }

                tableBody.push([
                    { content: `${step.numero_paso}. ${stepAction}`, styles: { minCellHeight: totalCellHeight } },
                    { content: loadedImages.length === 0 ? this.EVIDENCE_PLACEHOLDER : '', styles: { minCellHeight: totalCellHeight } }
                ]);

                stepLayouts.push({
                    rowIndex: j,
                    images: loadedImages,
                    dims: scaledDimensions,
                    totalHeight: totalCellHeight
                });
            }

            if (tableBody.length > 0) {
                autoTable(doc, {
                    startY: tableStartYEvid,
                    margin: { left: margin, right: margin },
                    head: [['Paso a paso', 'Evidencias']],
                    body: tableBody,
                    theme: 'grid',
                    rowPageBreak: 'avoid',
                    headStyles: { fillColor: [46, 116, 181], textColor: [255, 255, 255], fontStyle: 'bold', halign: 'center' },
                    styles: {
                        lineWidth: 0.5,
                        lineColor: [0, 0, 0],
                        textColor: [0, 0, 0],
                        font: 'helvetica',
                        fontSize: 11,
                        valign: 'top',
                        cellPadding: 8
                    },
                    columnStyles: {
                        0: { cellWidth: cellWidthCol1 },
                        1: { cellWidth: cellWidthCol2 }
                    },
                    didDrawCell: (data) => {
                        if (data.section === 'body' && data.column.index === 1) {
                            const layout = stepLayouts.find(l => l.rowIndex === data.row.index);
                            if (!layout) return;

                            const cellX = data.cell.x;
                            const cellY = data.cell.y;

                            if (layout.images.length === 0) {
                                // Draw placeholder text
                                doc.setFont('helvetica', 'bold');
                                doc.setFontSize(11);
                                const textW = doc.getTextWidth(this.EVIDENCE_PLACEHOLDER);
                                const textX = cellX + (cellWidthCol2 - textW) / 2;
                                const textY = cellY + (data.cell.height + 11) / 2 - 3;
                                doc.text(this.EVIDENCE_PLACEHOLDER, textX, textY);
                                // Underline
                                doc.setDrawColor(0);
                                doc.setLineWidth(0.5);
                                doc.line(textX, textY + 2, textX + textW, textY + 2);
                            } else {
                                // Draw all images stacked vertically
                                let currentY = cellY + innerPadding;
                                for (let imgIdx = 0; imgIdx < layout.images.length; imgIdx++) {
                                    const img = layout.images[imgIdx];
                                    const dims = layout.dims[imgIdx];
                                    try {
                                        const format = img.type.toUpperCase() || 'PNG';
                                        const imageX = cellX + (cellWidthCol2 - dims.width) / 2;
                                        doc.addImage(img.base64Data, format, imageX, currentY, dims.width, dims.height);
                                        
                                        // Draw border
                                        doc.setDrawColor(0);
                                        doc.setLineWidth(0.5);
                                        doc.rect(imageX, currentY, dims.width, dims.height);
                                    } catch (err) {
                                        console.error('Error drawing image in analysis PDF:', err);
                                    }
                                    currentY += dims.height + innerPadding;
                                }
                            }
                        }
                    }
                });
            }

            // Expected Results
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(11);
            const expectedY = (doc as any).lastAutoTable.finalY + 30;
            doc.text('Resultado Esperado: ', margin, expectedY);
            const prefixW = doc.getTextWidth('Resultado Esperado: ');
            doc.setFont('helvetica', 'normal');
            doc.text(report.resultado_obtenido || 'Exitoso', margin + prefixW, expectedY);
        }

        const filename = this.escapeFilename(`Reporte_Evidencias_HU_${huNumber}.pdf`);
        doc.save(filename);
    }

}