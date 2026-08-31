import { Injectable } from '@angular/core';
import { Observable, catchError, of, map } from 'rxjs';
import { GeminiService } from './gemini.service';
import { DeepSeekService } from './deepseek.service';
import { GitHubModelsService } from './github-models.service';
import { AiProvidersService } from './ai-providers.service';
import { DetailedTestCase, HUData } from '../../models/hu-data.model';
import { StreamEvent } from './deepseek-client.service';

/**
 * Servicio unificado que delega las llamadas al proveedor de IA activo
 * (Gemini, GitHub Models/Copilot o DeepSeek).
 *
 * DeepSeek actúa como proveedor por defecto Y como fallback global: si el
 * proveedor activo es "github-models" y la llamada falla (p. ej. 410 por
 * retirement brownout, 404 sin Copilot, o error de red), la operación se
 * reintenta automáticamente contra DeepSeek de forma transparente.
 */
@Injectable({
    providedIn: 'root'
})
export class AiUnifiedService {

    constructor(
        private geminiService: GeminiService,
        private deepSeekService: DeepSeekService,
        private githubModelsService: GitHubModelsService,
        private providersService: AiProvidersService
    ) { }

    /**
     * Obtiene el servicio activo según la configuración.
     * Nota: "github-models" no tiene un servicio de cliente propio en el
     * frontend (se resuelve vía backend proxy). Para las operaciones de
     * generación de casos delegamos en DeepSeek como motor efectivo, salvo
     * que en el futuro se añada un GitHubModelsService dedicado.
     */
    private getActiveService(): GeminiService | DeepSeekService | GitHubModelsService {
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
            case 'github-models':
                // Cliente dedicado: llama al backend de inferencia de GitHub Models.
                // Si falla, withDeepSeekFallback reintenta contra DeepSeek.
                console.log('[AI Unified] GitHub Models activo — motor efectivo: GitHubModelsService (con fallback a DeepSeek)');
                return this.githubModelsService;
            default:
                return this.deepSeekService;
        }
    }

    /** Indica si el proveedor activo es GitHub Models (para aplicar fallback explícito). */
    private isGitHubModelsActive(): boolean {
        return this.providersService.getActiveProviderId() === 'github-models';
    }

    /**
     * Envuelve un Observable con fallback automático a DeepSeek cuando el
     * proveedor activo es GitHub Models y la llamada primaria falla.
     */
    private withDeepSeekFallback<T>(
        primary: Observable<T>,
        deepSeekCall: () => Observable<T>
    ): Observable<T> {
        // Cuando "Usar GitHub Models como proveedor" está activo, NO se debe
        // llamar a DeepSeek bajo ninguna circunstancia: el error del proveedor
        // activo debe propagarse tal cual para que el usuario lo vea. El fallback
        // silencioso a deepseek-proxy queda deshabilitado a propósito.
        return primary;
    }

    /**
     * Generar secciones del plan de pruebas
     */
    public generateTestPlanSections(description: string, acceptanceCriteria: string): Observable<string> {
        const service = this.getActiveService();
        return this.withDeepSeekFallback(
            service.generateTestPlanSections(description, acceptanceCriteria),
            () => this.deepSeekService.generateTestPlanSections(description, acceptanceCriteria)
        );
    }

    /**
     * Mejorar contenido de sección estática
     */
    public generateEnhancedStaticSectionContent(
        sectionName: string,
        existingContent: string,
        huSummary: string,
        huCount: number = 1
    ): Observable<string> {
        const service = this.getActiveService();
        return this.withDeepSeekFallback(
            service.generateEnhancedStaticSectionContent(sectionName, existingContent, huSummary, huCount),
            () => this.deepSeekService.generateEnhancedStaticSectionContent(sectionName, existingContent, huSummary, huCount)
        );
    }

    /**
     * Generar item de riesgos para la estrategia de pruebas
     */
    public generateRiskStrategy(huSummary: string, availableScenarios: string[], huCount: number = 1): Observable<any> {
        const service = this.getActiveService();

        const primary = ('generateRiskStrategy' in service)
            ? (service as any).generateRiskStrategy(huSummary, availableScenarios, huCount)
            : this.deepSeekService.generateRiskStrategy(huSummary, availableScenarios, huCount);

        return this.withDeepSeekFallback(
            primary,
            () => this.deepSeekService.generateRiskStrategy(huSummary, availableScenarios, huCount)
        );
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

        const primary = ('generateTestCasesDirect' in service)
            ? (service as any).generateTestCasesDirect(description, acceptanceCriteria, technique)
            : this.deepSeekService.generateTestCasesDirect(description, acceptanceCriteria, technique);

        return this.withDeepSeekFallback(
            primary,
            () => this.deepSeekService.generateTestCasesDirect(description, acceptanceCriteria, technique)
        );
    }

    /**
     * Generación inteligente con continuación automática si la respuesta es truncada.
     * Usa este método para HUs complejas con muchos escenarios.
     */
    public generateTestCasesSmart(
        description: string,
        acceptanceCriteria: string,
        technique: string
    ): Observable<any> {
        const service = this.getActiveService();

        const primary = ('generateTestCasesSmart' in service)
            ? (service as any).generateTestCasesSmart(description, acceptanceCriteria, technique)
            : this.deepSeekService.generateTestCasesSmart(description, acceptanceCriteria, technique);

        return this.withDeepSeekFallback(
            primary,
            () => this.deepSeekService.generateTestCasesSmart(description, acceptanceCriteria, technique)
        );
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

        const primary = ('refineTestCasesDirect' in service)
            ? (service as any).refineTestCasesDirect(originalHuInput, editedTestCases, newTechnique, userReanalysisContext)
            : this.deepSeekService.refineTestCasesDirect(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);

        return this.withDeepSeekFallback(
            primary,
            () => this.deepSeekService.refineTestCasesDirect(originalHuInput, editedTestCases, newTechnique, userReanalysisContext)
        );
    }

    /**
     * Obtener nombre del proveedor activo
     */
    public getActiveProviderName(): string {
        const activeProvider = this.providersService.getActiveProvider();
        return activeProvider?.displayName || 'DeepSeek (por defecto)';
    }

    /**
     * Generación de casos de prueba en modo STREAM — emite tokens en tiempo real.
     * Solo soportado por DeepSeek (deepseek-reasoner).
     */
    public generateTestCasesSmartStream(
        description: string,
        acceptanceCriteria: string,
        technique: string,
        userRequest: string = ''
    ): Observable<StreamEvent> {
        // GitHub Models (Copilot) ahora soporta streaming real (SSE), igual que
        // DeepSeek. NO se hace fallback a DeepSeek: el error del proveedor activo
        // se propaga tal cual.
        if (this.isGitHubModelsActive()) {
            console.log('[AI Unified Stream] GitHub Models activo — generación con streaming (SSE)');
            return this.githubModelsService
                .generateTestCasesSmartStream(description, acceptanceCriteria, technique, userRequest);
        }
        console.log('[AI Unified Stream] Usando DeepSeek para generación con streaming');
        return this.deepSeekService.generateTestCasesSmartStream(description, acceptanceCriteria, technique, userRequest);
    }

    /**
     * Refinamiento de casos de prueba en modo STREAM — emite tokens en tiempo real.
     * Solo soportado por DeepSeek (deepseek-reasoner).
     */
    public refineTestCasesDirectStream(
        originalHuInput: HUData['originalInput'],
        editedTestCases: DetailedTestCase[],
        newTechnique: string,
        userReanalysisContext: string
    ): Observable<StreamEvent> {
        // GitHub Models (Copilot) con streaming real (SSE). Sin fallback a DeepSeek.
        if (this.isGitHubModelsActive()) {
            console.log('[AI Unified Stream] GitHub Models activo — refinamiento con streaming (SSE)');
            return this.githubModelsService
                .refineTestCasesDirectStream(originalHuInput, editedTestCases, newTechnique, userReanalysisContext);
        }
        console.log('[AI Unified Stream] Usando DeepSeek para refinamiento con streaming');
        return this.deepSeekService.refineTestCasesDirectStream(
            originalHuInput, editedTestCases, newTechnique, userReanalysisContext
        );
    }

    /**
     * Adapta un resultado ya parseado (JSON con testCases) al formato StreamEvent
     * que esperan los componentes que consumen los métodos ...Stream.
     * Emite el contenido como un único evento final (done=true).
     */
    private toStreamEvent(parsed: any): StreamEvent {
        return {
            reasoning: '',
            content: JSON.stringify(parsed ?? {}),
            done: true
        };
    }
}
