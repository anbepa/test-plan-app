import { Injectable } from '@angular/core';
import { HUData } from '../../models/hu-data.model';
import { saveAs } from 'file-saver';

/**
 * Servicio para exportar datos en diferentes formatos
 */
@Injectable({
    providedIn: 'root'
})
export class ExportService {

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
