import { Injectable } from '@angular/core';
import { HUData } from '../../models/hu-data.model';
import { saveAs } from 'file-saver';
import {
    AlignmentType,
    Document,
    Packer,
    Paragraph,
    Table,
    TableCell,
    TableRow,
    TextRun,
    WidthType
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
     * Exporta una HU como matriz de evidencias en formato DOXC
     * Reglas:
     * - Página personalizada: 55.8cm x 55.8cm
     * - 1 página por test case
     * - Título por página: "N. <escenario>"
     * - Tabla de 2 columnas con tantas filas como pasos
     *   - Columna 1: número de paso
     *   - Columna 2: espacio de evidencias
     */
    async exportToDOXC(hu: HUData): Promise<void> {
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

            const rows = (validSteps.length > 0 ? validSteps : [{ numero_paso: 1, accion: '' }]).map((step, stepIndex) => {
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
        const filename = `Matriz_Evidencias_${this.escapeFilename(hu.id)}_${new Date().toISOString().split('T')[0]}.doxc`;
        saveAs(blob, filename);
    }

    /**
     * Escapa un campo para formato CSV
     */
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
