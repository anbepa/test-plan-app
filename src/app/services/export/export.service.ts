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
     * Exporta la ejecución actual a PDF, imitando el diseño de DOCX.
     */
    async exportExecutionToPDF(execution: any, activeTestCaseIndex: number = 0, onProgress?: (current: number, total: number) => void): Promise<void> {
        if (!execution || !execution.testCases) return;

        const testCase = execution.testCases[activeTestCaseIndex];
        if (!testCase) return;

        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const margin = 40;
        
        // Portada o Encabezado
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(`Ejecución - ${execution.huTitle}`, margin, margin);
        
        doc.setFontSize(12);
        doc.text(`Escenario: ${testCase.title}`, margin, margin + 25);
        
        doc.setFontSize(10);
        doc.setFont('helvetica', 'normal');
        doc.text(`Precondiciones: ${testCase.preconditions || 'Ninguna'}`, margin, margin + 45);
        
        // Hidratar evidencias antes de construir tabla
        const allStepEvidences = testCase.steps.flatMap((s: any) => s.evidences || []);
        if (allStepEvidences.length > 0) {
            await this.storageService.hydrateStepEvidence(allStepEvidences);
        }

        const tableBody = [];
        const imagesToDraw: any[] = []; // { x, y, w, h, data }
        
        let rowCounter = 0;

        for (let i = 0; i < testCase.steps.length; i++) {
            const step = testCase.steps[i];
            const stepNumber = step.numero_paso ?? (i + 1);
            const stepAction = step.accion?.trim() || `Paso ${stepNumber}`;
            
            const cols = Math.max(1, Number(step.evidenceColumns) || 1);
            const rowsConfig = Math.max(1, Number(step.evidenceRows) || 1);
            
            const hydratedEvidences = (step.evidences || []).map((ev: any) => {
                const cached = this.storageService.getCachedImage(ev.id);
                return cached ? { ...ev, base64Data: cached.base64Data } : ev;
            });

            // En autotable no es facil hacer grids complejos en una celda de imagen dinamicamente, 
            // así que dibujaremos las imagenes manualmente en el hook didDrawCell.
            // Necesitamos guardar un placeholder en la tabla para que autotable reserve el espacio.
            
            // Calculamos altura de fila requerida segun evidencias
            let reqRows = Math.ceil(hydratedEvidences.length / cols);
            if(reqRows === 0) reqRows = 1;
            const minHeight = reqRows * 150; // 150pt por cada fila de imagenes

            tableBody.push([
                { content: `${stepNumber}. ${stepAction}`, styles: { minCellHeight: minHeight } },
                { content: hydratedEvidences.length === 0 ? this.EVIDENCE_PLACEHOLDER : '', styles: { minCellHeight: minHeight } }
            ]);

            // Guardamos referencias para dibujar despues
            imagesToDraw.push({ rowIndex: rowCounter, evidences: hydratedEvidences, cols, rowsConfig });
            rowCounter++;
            
            onProgress?.(i + 1, testCase.steps.length);
        }

        autoTable(doc, {
            startY: margin + 70,
            head: [['Paso a paso', 'Evidencias']],
            body: tableBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 116, 181], textColor: 255, fontStyle: 'bold' },
            columnStyles: {
                0: { cellWidth: 150 },
                1: { cellWidth: 'auto' }
            },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 1) {
                    const rowInfo = imagesToDraw.find(img => img.rowIndex === data.row.index);
                    if (rowInfo && rowInfo.evidences.length > 0) {
                        const cellWidth = data.cell.width;
                        const cellHeight = data.cell.height;
                        const pad = 5;
                        
                        const eCols = rowInfo.cols;
                        const eRows = Math.ceil(rowInfo.evidences.length / eCols);
                        
                        const imgW = (cellWidth - (pad * (eCols + 1))) / eCols;
                        const imgH = (cellHeight - (pad * (eRows + 1))) / eRows;
                        
                        let eIdx = 0;
                        for(let r=0; r<eRows; r++){
                            for(let c=0; c<eCols; c++){
                                if(eIdx < rowInfo.evidences.length){
                                    const ev = rowInfo.evidences[eIdx];
                                    if(ev.base64Data){
                                        try {
                                            const format = ev.base64Data.match(/data:image\/([a-zA-Z]+);/)?.[1] || 'PNG';
                                            const x = data.cell.x + pad + (c * (imgW + pad));
                                            const y = data.cell.y + pad + (r * (imgH + pad));
                                            doc.addImage(ev.base64Data, format, x, y, imgW, imgH);
                                            doc.setDrawColor(0);
                                            doc.rect(x, y, imgW, imgH);
                                        }catch(err){}
                                    }
                                }
                                eIdx++;
                            }
                        }
                    }
                }
            }
        });

        const filename = this.escapeFilename(`Ejecución - ${execution.huTitle}.pdf`);
        doc.save(filename);
    }

    /**
     * Exporta reportes de análisis de evidencias a PDF.
     */
    async exportEvidenceAnalysisToPDF(
        reports: any[],
        huNumber: string,
        huTitle?: string,
        onProgress?: (current: number, total: number) => void
    ): Promise<void> {
        if (!reports || reports.length === 0) throw new Error('No hay reportes para exportar');

        const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
        const margin = 40;
        
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(16);
        doc.text(`Reporte de Evidencias - HU: ${huNumber}${huTitle ? ' | ' + huTitle : ''}`, margin, margin);
        
        const summaryBody = reports.map((r, i) => [
            (i + 1).toString(),
            r.nombre_del_escenario || `Escenario ${i + 1}`
        ]);

        autoTable(doc, {
            startY: margin + 30,
            head: [['N°', 'Escenario de Prueba']],
            body: summaryBody,
            theme: 'grid',
            headStyles: { fillColor: [46, 116, 181], textColor: 255 }
        });

        for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            const scenarioNumber = i + 1;
            const scenarioTitle = report.nombre_del_escenario?.trim()
                ? `${scenarioNumber}. ${report.nombre_del_escenario.trim()}`
                : `${scenarioNumber}. Escenario ${scenarioNumber}`;

            doc.addPage();
            doc.setFontSize(14);
            doc.text(scenarioTitle, margin, margin);

            const steps = report.test_scenario_steps || [];
            const tableBody = [];
            const imagesToDraw: any[] = [];
            let rowCounter = 0;

            for (let j = 0; j < steps.length; j++) {
                const step = steps[j];
                const stepAction = step.descripcion_accion_observada || `Paso ${step.numero_paso}`;
                
                let stepImages = report.report_images?.filter((img: any) => img.step_id === step.id) || [];
                if (stepImages.length === 0 && step.imagen_referencia) {
                    const match = step.imagen_referencia.match(/\d+/);
                    if (match) {
                        const order = parseInt(match[0], 10);
                        const fallbackImg = report.report_images?.find((img: any) => img.image_order === order);
                        if (fallbackImg) stepImages = [fallbackImg];
                    }
                }

                // pre-fetch images to base64 for PDF
                const loadedImages = [];
                for(const img of stepImages){
                    if(img.image_url){
                        const res = await this.fetchImageAsUint8Array(img.image_url);
                        if(res){
                            // convert Uint8Array back to base64
                            const binary = Array.from(res.bytes).map(b => String.fromCharCode(b)).join('');
                            const b64 = window.btoa(binary);
                            loadedImages.push({
                                base64Data: `data:image/${res.type};base64,${b64}`,
                                type: res.type
                            });
                        }
                    }
                }

                const minHeight = loadedImages.length > 0 ? 250 : 50;

                tableBody.push([
                    { content: `${step.numero_paso}. ${stepAction}`, styles: { minCellHeight: minHeight } },
                    { content: loadedImages.length === 0 ? this.EVIDENCE_PLACEHOLDER : '', styles: { minCellHeight: minHeight } }
                ]);

                imagesToDraw.push({ rowIndex: rowCounter, images: loadedImages });
                rowCounter++;
            }
            
            if(tableBody.length > 0) {
                autoTable(doc, {
                    startY: margin + 30,
                    head: [['Paso a paso', 'Evidencias']],
                    body: tableBody,
                    theme: 'grid',
                    headStyles: { fillColor: [46, 116, 181], textColor: 255 },
                    columnStyles: { 0: { cellWidth: 150 }, 1: { cellWidth: 'auto' } },
                    didDrawCell: (data) => {
                        if (data.section === 'body' && data.column.index === 1) {
                            const rowInfo = imagesToDraw.find(img => img.rowIndex === data.row.index);
                            if (rowInfo && rowInfo.images.length > 0) {
                                const pad = 10;
                                const imgW = data.cell.width - (pad * 2);
                                const imgH = data.cell.height - (pad * 2);
                                // For simplicity, draw the first image centered and fit
                                // If multiple images, they should be arranged, but we simplify to 1 main image for analysis
                                const ev = rowInfo.images[0];
                                const format = ev.type.toUpperCase() || 'PNG';
                                const x = data.cell.x + pad;
                                const y = data.cell.y + pad;
                                doc.addImage(ev.base64Data, format, x, y, imgW, imgH);
                            }
                        }
                    }
                });
            }

            onProgress?.(i + 1, reports.length);
        }

        const filename = this.escapeFilename(`Reporte_Evidencias_HU_${huNumber}.pdf`);
        doc.save(filename);
    }

}