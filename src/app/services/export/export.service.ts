import { Injectable } from '@angular/core';
import { saveAs } from 'file-saver';
import { HUData, PlanExecution } from '../../models/hu-data.model';
import { ExecutionStorageService } from '../database/execution-storage-supabase.service';
import { escapeCsvField, escapeFilename } from './export-utils';
import type { ExportEngine } from './export-engine';

type ProgressFn = (current: number, total: number) => void;

/**
 * Servicio para exportar datos en diferentes formatos.
 *
 * Las exportaciones DOCX, PDF y XLSX viven en ExportEngine, que se carga con
 * import() dinámico la primera vez que se usan. Así exceljs, docx y jspdf
 * solo se descargan cuando el usuario exporta.
 */
@Injectable({
    providedIn: 'root'
})
export class ExportService {

    private enginePromise?: Promise<ExportEngine>;

    constructor(private storageService: ExecutionStorageService) { }

    private engine(): Promise<ExportEngine> {
        if (!this.enginePromise) {
            this.enginePromise = import('./export-engine')
                .then(m => new m.ExportEngine(this.storageService))
                .catch(err => {
                    this.enginePromise = undefined;
                    throw err;
                });
        }
        return this.enginePromise;
    }

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
                escapeCsvField(hu.id + '_CP' + (index + 1)),
                escapeCsvField(tc.title),
                escapeCsvField(tc.preconditions),
                escapeCsvField(stepsString),
                escapeCsvField(tc.expectedResults)
            ];
        });

        const csvFullContent = [
            csvHeader.join(','),
            ...csvRows.map(row => row.join(','))
        ].join('\r\n');

        const filename = escapeFilename(`${hu.id}_Matriz.csv`);
        saveAs(
            new Blob(["﻿" + csvFullContent], { type: 'text/csv;charset=utf-8;' }),
            filename
        );
    }

    /**
     * Exporta los escenarios de UNA sola HU a PDF (matriz de ejecución).
     */
    async exportScenariosToPDF(hu: HUData, planTitle?: string): Promise<void> {
        if (!hu?.detailedTestCases || hu.detailedTestCases.length === 0) {
            throw new Error('No hay casos de prueba para exportar');
        }
        (await this.engine()).exportScenariosToPDF(hu, planTitle);
    }

    /**
     * Exporta la matriz de ejecución de una HU a DOCX.
     */
    async exportToDOCX(hu: HUData): Promise<void> {
        return (await this.engine()).exportToDOCX(hu);
    }

    /**
     * Exporta una ejecución del plan con evidencias en formato DOCX.
     */
    async exportExecutionToDOCX(
        execution: PlanExecution,
        hu: HUData | null,
        onProgress?: ProgressFn,
        returnBlob = false
    ): Promise<void | Blob> {
        return (await this.engine()).exportExecutionToDOCX(execution, hu, onProgress, returnBlob);
    }

    /**
     * Exporta la ejecución completa a PDF, imitando el diseño de DOCX.
     */
    async exportExecutionToPDF(
        execution: PlanExecution,
        hu: HUData | null,
        onProgress?: ProgressFn,
        returnBlob = false
    ): Promise<void | Blob> {
        return (await this.engine()).exportExecutionToPDF(execution, hu, onProgress, returnBlob);
    }

    /**
     * Exporta la ejecución completa a XLSX.
     */
    async exportExecutionToXLSX(
        execution: PlanExecution,
        hu: HUData | null,
        onProgress?: ProgressFn,
        returnBlob = false
    ): Promise<void | Blob> {
        return (await this.engine()).exportExecutionToXLSX(execution, hu, onProgress, returnBlob);
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
        const blob = new Blob(['﻿', htmlContent], { type: 'text/html;charset=utf-8' });
        const safeFilename = `${escapeFilename(filename)}_Fallback.html`;
        saveAs(blob, safeFilename);
    }
}
