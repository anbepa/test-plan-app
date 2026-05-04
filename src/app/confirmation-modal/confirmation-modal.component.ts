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
            return 'Analizando criterios de aceptación y diseñando escenarios…';
        }
        if (this.streamingPhase === 'generating') {
            return 'Construyendo casos de prueba…';
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
            [/\bhigh\b/gi, 'alta'],
            [/\bEquivalent Partitioning\b/gi, 'Partición Equivalente'],
            [/\bBoundary Value Analysis\b/gi, 'Análisis de Valores Límite'],
            [/\bDecision Table\b/gi, 'Tabla de Decisión'],
            [/\bState Transition\b/gi, 'Transición de Estado'],
            [/\bvalidation\b/gi, 'validación'],
        ];
        let result = text;
        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }
        return result;
    }

    /** Extrae fragmentos clave del razonamiento CoT para mostrar al usuario */
    get reasoningInsights(): string[] {
        if (!this.streamingReasoning || this.streamingPhase !== 'thinking') return [];
        const text = this.streamingReasoning;
        const insights: string[] = [];

        const sentences = text.split(/[.\n]+/).map(s => s.trim()).filter(s => s.length > 15 && s.length < 150);

        for (const sentence of sentences) {
            const lower = sentence.toLowerCase();
            if (
                lower.includes('criterio') || lower.includes('acceptance') ||
                lower.includes('escenario') || lower.includes('scenario') ||
                lower.includes('caso') || lower.includes('case') ||
                lower.includes('validar') || lower.includes('verificar') || lower.includes('valid') ||
                lower.includes('prueba') || lower.includes('test') ||
                lower.includes('usuario') || lower.includes('user') ||
                lower.includes('funcional') || lower.includes('flujo') ||
                lower.includes('positiv') || lower.includes('negativ') ||
                lower.includes('error') || lower.includes('límite') || lower.includes('boundary') ||
                lower.includes('partici') || lower.includes('equivalen') ||
                lower.includes('need') || lower.includes('should') || lower.includes('must') ||
                lower.includes('consider') || lower.includes('incluy') || lower.includes('analiz') ||
                lower.includes('generat') || lower.includes('combin')
            ) {
                let clean = sentence.replace(/^[-*#>\d.)+\s]+/, '').trim();
                if (clean.length < 12) continue;
                // Traducir si contiene palabras en inglés
                clean = this.translateInsight(clean);
                clean = clean.charAt(0).toUpperCase() + clean.slice(1);
                if (clean.length > 120) clean = clean.slice(0, 117) + '…';
                if (!insights.some(i => i === clean)) {
                    insights.push(clean);
                }
            }
        }

        return insights.slice(-4);
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
