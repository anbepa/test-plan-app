import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { GeminiService, CoTStepResult } from './gemini.service';
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
            console.warn('[AI Unified] No hay proveedor activo, usando Gemini por defecto');
            return this.geminiService;
        }

        console.log(`[AI Unified] Usando proveedor: ${activeProvider.name}`);

        switch (activeProvider.id) {
            case 'deepseek':
                return this.deepSeekService;
            case 'gemini':
            default:
                return this.geminiService;
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
     * Generar casos de prueba con Chain of Thought
     */
    public generateTestCasesCoT(
        description: string,
        acceptanceCriteria: string,
        technique: string,
        additionalContext?: string
    ): Observable<CoTStepResult> {
        const service = this.getActiveService();
        return service.generateTestCasesCoT(description, acceptanceCriteria, technique, additionalContext);
    }

    /**
     * Generar casos de prueba con generación DIRECTA (sin CoT)
     * Más rápido y conciso - ideal para DeepSeek
     */
    public generateTestCasesDirect(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const service = this.getActiveService();

        // Solo DeepSeek tiene modo directo implementado
        if (service instanceof DeepSeekService) {
            return service.generateTestCasesDirect(description, acceptanceCriteria, technique);
        }

        // Fallback: usar CoT para Gemini
        console.warn('[AI Unified] Modo directo no disponible para Gemini, usando CoT');
        return service.generateTestCasesCoT(description, acceptanceCriteria, technique);
    }

    /**
     * Refinar casos de prueba con Chain of Thought
     */
    public refineTestCasesCoT(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<CoTStepResult> {
        const service = this.getActiveService();
        return service.refineTestCasesCoT(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);
    }

    /**
     * Refinar casos de prueba con refinamiento DIRECTO (sin CoT)
     * Más rápido y conciso - ideal para DeepSeek
     */
    public refineTestCasesDirect(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<any> {
        const service = this.getActiveService();

        // Solo DeepSeek tiene modo directo implementado
        if (service instanceof DeepSeekService) {
            return service.refineTestCasesDirect(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);
        }

        // Fallback: usar CoT para Gemini
        console.warn('[AI Unified] Refinamiento directo no disponible para Gemini, usando CoT');
        return service.refineTestCasesCoT(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);
    }

    /**
     * Obtener nombre del proveedor activo
     */
    public getActiveProviderName(): string {
        const activeProvider = this.providersService.getActiveProvider();
        return activeProvider?.displayName || 'Gemini (por defecto)';
    }
}
