import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
    selector: 'app-confirmation-modal',
    standalone: true,
    imports: [CommonModule],
    templateUrl: './confirmation-modal.component.html',
    styleUrls: ['./confirmation-modal.component.css']
})
export class ConfirmationModalComponent {
    @Input() isOpen = false;
    @Input() title = 'Confirmación';
    @Input() message = '¿Estás seguro?';
    @Input() confirmText = 'Confirmar';
    @Input() cancelText = 'Cancelar';
    @Input() type: 'danger' | 'warning' | 'info' = 'info';
    @Input() mode: 'confirm' | 'progress' = 'confirm';
    @Input() progressHint = 'Este proceso puede tardar unos segundos.';
    @Input() progressStep = 'Procesando...';
    @Input() showProgressBar = true;
    @Input() allowBackdropClose = true;
    /** Texto de razonamiento interno (CoT) del modelo recibido vía stream */
    @Input() streamingReasoning: string = '';
    /** Contenido JSON generándose en tiempo real vía stream */
    @Input() streamingContent: string = '';
    /** Índices de escenarios ya "aceptados" para la animación de validación */
    @Input() acceptedScenarioIndices: number[] = [];
    /** Indica si estamos en fase de aceptación visual de escenarios */
    @Input() isAcceptancePhase: boolean = false;
    /** Datos del plan de pruebas para contexto de análisis */
    @Input() testPlanData: any = null;

    /** Calcula el porcentaje de progreso basado en las fases del stream */
    get streamProgress(): number {
        if (this.streamingPhase === 'idle') return 0;
        if (this.streamingPhase === 'thinking') {
            // 0-40% mientras está pensando (razonamiento CoT)
            return Math.min(40, 5 + (this.streamingReasoning?.length ?? 0) / 100);
        }
        if (this.streamingPhase === 'generating') {
            // 40-95% mientras genera contenido (JSON)
            return Math.min(95, 40 + (this.streamingContent?.length ?? 0) / 200);
        }
        return 0;
    }

    /** Porcentaje redondeado sin decimales */
    get streamProgressPercent(): number {
        return Math.round(this.streamProgress);
    }

    /** Fase actual del stream: pensando (CoT), generando (JSON) o inactivo */
    get streamingPhase(): 'idle' | 'thinking' | 'generating' {
        if (this.streamingContent?.trim()) return 'generating';
        if (this.streamingReasoning?.trim()) return 'thinking';
        return 'idle';
    }

    /** Mensaje amigable según la fase */
    get streamingPhaseLabel(): string {
        if (this.streamingPhase === 'thinking') {
            return 'Me encuentro analizando criterios de aceptación y diseñando escenarios…';
        }
        if (this.streamingPhase === 'generating') {
            return 'Estoy construyendo los casos de prueba…';
        }
        return '';
    }

    /** Traducciones rápidas inglés → español para insights */
    private translateInsight(text: string): string {
        const replacements: [RegExp, string][] = [
            [/\bwe need to\b/gi, 'necesitamos'],
            [/\bwe('ll| will) (also )?/gi, 'se '],
            [/\bwe must\b/gi, 'debemos'],
            [/\bwe should\b/gi, 'debemos'],
            [/\bwe can\b/gi, 'podemos'],
            [/\bwe have\b/gi, 'tenemos'],
            [/\bwe\b/gi, 'se'],
            [/\bgenerate\b/gi, 'generar'],
            [/\bgenerating\b/gi, 'generando'],
            [/\bat least\b/gi, 'al menos'],
            [/\btest cases?\b/gi, 'casos de prueba'],
            [/\btest\b/gi, 'prueba'],
            [/\bcases?\b/gi, 'casos'],
            [/\bconsider(ing)?\b/gi, 'considerando'],
            [/\btechnique\b/gi, 'técnica'],
            [/\bvalid\b/gi, 'válido'],
            [/\binvalid\b/gi, 'inválido'],
            [/\bboundary\b/gi, 'límite'],
            [/\berror\b/gi, 'error'],
            [/\bsuccess\b/gi, 'éxito'],
            [/\bempty\b/gi, 'vacío'],
            [/\buser(name)?\b/gi, 'usuario'],
            [/\bpassword\b/gi, 'contraseña'],
            [/\bscenarios?\b/gi, 'escenarios'],
            [/\bcombination\b/gi, 'combinación'],
            [/\bidentify\b/gi, 'identificar'],
            [/\bidentifying\b/gi, 'identificando'],
            [/\bclasses\b/gi, 'clases'],
            [/\beach\b/gi, 'cada'],
            [/\bavoid(ing)?\b/gi, 'evitar'],
            [/\bunrealistic\b/gi, 'irrealistas'],
            [/\blimits?\b/gi, 'límites'],
            [/\binvent(ing)?\b/gi, 'inventar'],
            [/\bbut\b/gi, 'pero'],
            [/\balso\b/gi, 'también'],
            [/\bso\b/gi, 'así que'],
            [/\band\b/gi, 'y'],
            [/\bfor\b/gi, 'para'],
            [/\bthat\b/gi, 'que'],
            [/\bthe\b/gi, 'el/la'],
            [/\bis\b/gi, 'es'],
            [/\bany\b/gi, 'cualquier'],
            [/\bcomplexity\b/gi, 'complejidad'],
            [/\blow\b/gi, 'baja'],
            [/\bmedium\b/gi, 'media'],
            [/\bhigh\b/gi, 'alta'],
            [/\bvery\b/gi, 'muy'],
            [/\bEquivalent Partitioning\b/gi, 'Partición Equivalente'],
            [/\bBoundary Value Analysis\b/gi, 'Análisis de Valores Límite'],
            [/\bDecision Table\b/gi, 'Tabla de Decisión'],
            [/\bState Transition\b/gi, 'Transición de Estado'],
            [/\bvalidation\b/gi, 'validación'],
            [/\bsystem\b/gi, 'sistema'],
            [/\bdisplay\b/gi, 'mostrar'],
            [/\bshould\b/gi, 'debería'],
            [/\bif\b/gi, 'si'],
            [/\bnot\b/gi, 'no'],
            [/\bregistered\b/gi, 'registrado'],
            [/\bfield\b/gi, 'campo'],
            [/\binput\b/gi, 'entrada'],
            [/\boutput\b/gi, 'salida'],
            [/\brequirement\b/gi, 'requerimiento'],
            [/\banalyzing\b/gi, 'analizando'],
            [/\bcreating\b/gi, 'creando'],
            [/\bdesigning\b/gi, 'diseñando'],
            [/\bmapping\b/gi, 'mapeando'],
            [/\bcoverage\b/gi, 'cobertura'],
            [/\bchecking\b/gi, 'verificando'],
            [/\bneeds\b/gi, 'necesita'],
            [/\bmust\b/gi, 'debe'],
            [/\bwill\b/gi, 'va a'],
            [/\bis like\b/gi, 'es similar a'],
            [/\blike\b/gi, 'como'],
            [/\bspecial characters?\b/gi, 'caracteres especiales'],
            [/\bnot allowed\b/gi, 'no permitidos'],
            [/\ballowed\b/gi, 'permitidos'],
            [/\bcase insensitive\b/gi, 'ignora mayúsculas/minúsculas'],
            [/\binsensitive\b/gi, 'ignora mayúsculas/minúsculas'],
            [/\bcase sensitive\b/gi, 'distingue mayúsculas/minúsculas'],
            [/\buppercase\b/gi, 'mayúsculas'],
            [/\blowercase\b/gi, 'minúsculas'],
            [/\bvs\.?\b/gi, 'contra'],
        ];
        let result = text;
        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }
        return result;
    }

    /** Extrae datos estructurados del razonamiento para tabular */
    get reasoningMetadata() {
        const text = this.streamingReasoning || '';
        const isThinking = this.streamingPhase === 'thinking';
        
        // Si ya no estamos pensando, devolver los últimos datos guardados
        if (!isThinking) {
            if (!this.lastComplexity && !this.lastTechnique) return null;
            return {
                complexity: this.lastComplexity || 'FINALIZADO',
                technique: this.lastTechnique || 'COMPLETADO',
                coverage: this.lastCoverage || [],
                rules: this.lastRules || []
            };
        }

        // 1. Complejidad (Mejorado)
        const compMatch = text.match(/(complejidad|complexity)\s*(is|es|detectada|identificada)?\s*(baja|media|alta|muy\s+alta|low|medium|high|very\s+high)/i);
        const complexity = compMatch ? this.translateInsight(compMatch[3]) : null;

        // 2. Técnica (Mejorado: Whitelist estricta)
        const commonTechniques = [
            { key: 'partición', label: 'Partición Equivalente' },
            { key: 'equivalen', label: 'Partición Equivalente' },
            { key: 'límite', label: 'Análisis de Valores Límite' },
            { key: 'boundary', label: 'Análisis de Valores Límite' },
            { key: 'decisión', label: 'Tabla de Decisión' },
            { key: 'decision', label: 'Tabla de Decisión' },
            { key: 'transición', label: 'Transición de Estados' },
            { key: 'state', label: 'Transición de Estados' },
            { key: 'error', label: 'Adivinación de Errores' },
            { key: 'guerrilla', label: 'Pruebas de Guerrilla' },
            { key: 'combinatori', label: 'Pruebas Combinatorias' }
        ];

        let technique = null;
        for (const t of commonTechniques) {
            if (text.toLowerCase().includes(t.key)) {
                technique = t.label;
                break;
            }
        }

        // 3. Cobertura (NUEVO: qué está probando)
        const coverage: string[] = [];
        if (text.toLowerCase().includes('happy path') || text.toLowerCase().includes('exitos')) coverage.push('Flujos Felices');
        if (text.toLowerCase().includes('negativ') || text.toLowerCase().includes('error')) coverage.push('Casos Negativos');
        if (text.toLowerCase().includes('borde') || text.toLowerCase().includes('límite') || text.toLowerCase().includes('edge')) coverage.push('Límites/Bordes');
        if (text.toLowerCase().includes('seguridad') || text.toLowerCase().includes('security')) coverage.push('Seguridad');

        // 4. Pensamiento del modelo (Viñetas dinámicas)
        const rules: string[] = [];
        const lines = text.split(/[.\n]+/).map(l => l.trim());
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            
            // Ignorar pensamientos internos triviales
            if (lowerLine.includes('debo') || lowerLine.includes('voy a') || lowerLine.includes('necesito') || 
                lowerLine.includes('clasific') || lowerLine.includes('analizar') || lowerLine.includes('generar') ||
                lowerLine.includes('instrucción') || lowerLine.includes('actuales son') || lowerLine.includes('identificaré')) continue;

            // Ignorar si es solo el título de la HU
            if (lowerLine.includes('login usuario') || (this.testPlanData && lowerLine.includes(this.testPlanData.huDescription.toLowerCase()))) continue;

            let cleanRule = line.replace(/^[-*#>\d.)+\s]+|(regla|ca|criterio)\s*\d*[:\-]?\s*/i, '').trim();
            // Si la frase tiene sentido y longitud adecuada, la consideramos un "pensamiento"
            if (cleanRule.length > 15 && cleanRule.length < 120 && !rules.includes(cleanRule)) {
                rules.push(this.translateInsight(cleanRule));
            }
        }

        return {
            complexity: complexity ? complexity.toUpperCase() : (this.lastComplexity || 'ANALIZANDO...'),
            technique: technique ? technique : (this.lastTechnique || 'DETERMINANDO...'),
            coverage: coverage.length > 0 ? coverage.slice(0, 2) : (this.lastCoverage || []),
            rules: rules.length > 0 ? rules.slice(-3) : (this.lastRules || []) // Mostramos los últimos 3 pensamientos
        };
    }

    private lastComplexity = '';
    private lastTechnique = '';
    private lastCoverage: string[] = [];
    private lastRules: string[] = [];

    /** Almacena los últimos datos válidos para que la tabla no quede vacía al terminar el razonamiento */
    ngOnChanges() {
        const meta = this.reasoningMetadata;
        if (meta) {
            if (meta.complexity !== 'ANALIZANDO...') this.lastComplexity = meta.complexity;
            if (meta.technique !== 'DETERMINANDO...') this.lastTechnique = meta.technique;
            if (meta.coverage.length > 0) this.lastCoverage = meta.coverage;
            if (meta.rules.length > 0) this.lastRules = meta.rules;
        }
    }

    /** Estado de las fases de análisis (valor persistente) */
    get analysisPhases() {
        const text = this.streamingReasoning?.toLowerCase() || '';
        const isGenerating = this.streamingPhase === 'generating';
        
        return [
            { id: 1, label: 'Comprensión de Requisitos', active: true, done: text.length > 100 || isGenerating },
            { id: 2, label: 'Identificación de Reglas', active: text.length > 200 || isGenerating, done: text.length > 500 || isGenerating },
            { id: 3, label: 'Aplicación de Técnica QA', active: !!this.lastTechnique || isGenerating, done: isGenerating },
            { id: 4, label: 'Diseño de Escenarios', active: isGenerating, done: false }
        ];
    }

    /** Extrae fragmentos clave del razonamiento CoT para mostrar al usuario */
    get reasoningInsights(): string[] {
        if (!this.streamingReasoning || this.streamingPhase !== 'thinking') return [];
        const text = this.streamingReasoning;
        const insights: string[] = [];

        const sentences = text.split(/[.\n]+/).map(s => s.trim()).filter(s => s.length > 20 && s.length < 130);

        for (const sentence of sentences) {
            const lower = sentence.toLowerCase();
            
            // Filtro estricto: solo cosas que aporten valor al QA
            if (lower.includes('debo') || lower.includes('necesito') || lower.includes('analizaré') || 
                lower.includes('voy a') || lower.includes('pensamiento') || lower.includes('clasific')) continue;

            if (
                lower.includes('validar') || lower.includes('verificar') || 
                lower.includes('asegurar') || lower.includes('garantizar') ||
                lower.includes('incluir') || lower.includes('cubrir') ||
                lower.includes('considerar') || lower.includes('identificar')
            ) {
                let clean = sentence.replace(/^[-*#>\d.)+\s]+/, '').trim();
                clean = this.translateInsight(clean);
                clean = clean.charAt(0).toUpperCase() + clean.slice(1);
                if (!insights.some(i => i === clean)) {
                    insights.push(clean);
                }
            }
        }

        return insights.slice(-2); // Solo los 2 más recientes para no saturar
    }

    /** Extrae los títulos de casos de prueba del JSON parcial del stream */
    get streamingCaseTitles(): string[] {
        if (!this.streamingContent) return [];
        const regex = /"title"\s*:\s*"([^"]+)"/g;
        const titles: string[] = [];
        let match;
        while ((match = regex.exec(this.streamingContent)) !== null) {
            titles.push(match[1]);
        }
        return titles;
    }

    /** Porcentaje de aceptación basado en escenarios aceptados */
    get acceptancePercent(): number {
        const total = this.streamingCaseTitles.length;
        if (total === 0) return 100;
        return Math.round((this.acceptedScenarioIndices.length / total) * 100);
    }

    /** Devuelve los últimos N caracteres del texto para mostrar en el modal */
    getLastChars(text: string, n: number): string {
        if (!text) return '';
        return text.length > n ? '…' + text.slice(-n) : text;
    }

    @Output() confirm = new EventEmitter<void>();
    @Output() cancel = new EventEmitter<void>();

    get isProgressMode(): boolean {
        return this.mode === 'progress';
    }

    onOverlayClick(): void {
        if (this.isProgressMode || !this.allowBackdropClose) return;
        this.onCancel();
    }

    onConfirm() {
        if (this.isProgressMode) return;
        this.confirm.emit();
        this.close();
    }

    onCancel() {
        if (this.isProgressMode) return;
        this.cancel.emit();
        this.close();
    }

    close() {
        this.isOpen = false;
    }

    open() {
        this.isOpen = true;
    }
}
