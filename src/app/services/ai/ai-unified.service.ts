import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GeminiService } from './gemini.service';
import { DeepSeekService } from './deepseek.service';
import { AiProvidersService } from './ai-providers.service';
import { DetailedTestCase, HUData } from '../../models/hu-data.model';

/**
 * Servicio unificado que delega las llamadas al proveedor de IA activo
 * (Gemini o DeepSeek)
 */
@Injectable({
    providedIn: 'root'
})
export class AiUnifiedService {

    constructor(
        private geminiService: GeminiService,
        private deepSeekService: DeepSeekService,
        private providersService: AiProvidersService
    ) { }

    /**
     * Obtiene el servicio activo según la configuración
     */
    private getActiveService(): GeminiService | DeepSeekService {
        const activeProvider = this.providersService.getActiveProvider();

        if (!activeProvider) {
            console.warn('[AI Unified] No hay proveedor activo, usando DeepSeek por defecto');
            return this.deepSeekService;
        }

        console.log(`[AI Unified] Usando proveedor: ${activeProvider.name}`);

        switch (activeProvider.id) {
            case 'deepseek':
                return this.deepSeekService;
            case 'gemini':
                return this.geminiService;
            default:
                return this.deepSeekService;
        }
    }

    /**
     * Generar secciones del plan de pruebas
     */
    public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
        const service = this.getActiveService();
        return service.generateTestPlanSections(description, acceptanceCriteria);
    }

    /**
     * Mejorar contenido de sección estática
     */
    public generateEnhancedStaticSectionContent(
        sectionName: string,
        existingContent: string,
        huSummary: string
    ): Observable<string> {
        const service = this.getActiveService();
        return service.generateEnhancedStaticSectionContent(sectionName, existingContent, huSummary);
    }

    /**
     * Generar casos de prueba usando el flujo directo del proveedor activo
     */
    public generateTestCasesDirect(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const service = this.getActiveService();

        if ('generateTestCasesDirect' in service) {
            return (service as any).generateTestCasesDirect(description, acceptanceCriteria, technique);
        }

        console.warn('[AI Unified] El proveedor activo no soporta generación directa, usando DeepSeek');
        return this.deepSeekService.generateTestCasesDirect(description, acceptanceCriteria, technique);
    }

    /**
     * Refinar casos de prueba usando el flujo directo del proveedor activo
     */
    public refineTestCasesDirect(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<any> {
        const service = this.getActiveService();

        if ('refineTestCasesDirect' in service) {
            return (service as any).refineTestCasesDirect(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);
        }

        console.warn('[AI Unified] El proveedor activo no soporta refinamiento directo, usando DeepSeek');
        return this.deepSeekService.refineTestCasesDirect(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);
    }

    /**
     * Obtener nombre del proveedor activo
     */
    public getActiveProviderName(): string {
        const activeProvider = this.providersService.getActiveProvider();
        return activeProvider?.displayName || 'DeepSeek (por defecto)';
    }
}
