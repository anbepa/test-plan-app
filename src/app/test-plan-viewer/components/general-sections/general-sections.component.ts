import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, Inject, PLATFORM_ID } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { isPlatformBrowser } from '@angular/common';

export type StaticSectionName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

export interface RiskStrategyData {
    probabilidadDe: string;
    puedeOcurrir: string;
    loQuePodriaOcasionar: string;
    impacto: string;
    probabilidad: string;
    positiveScenarios: string[];
    alternateScenarios: string[];
}

@Component({
    selector: 'app-general-sections',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './general-sections.component.html',
    styleUrls: ['./general-sections.component.css']
})
export class GeneralSectionsComponent implements OnChanges {
    @Input() showOnlyRisk: boolean = false;

    // Inputs para el contenido
    @Input() repositoryLink: string = '';
    @Input() outOfScopeContent: string = '';
    @Input() strategyContent: string = '';
    @Input() limitationsContent: string = '';
    @Input() assumptionsContent: string = '';
    @Input() teamContent: string = '';

    // Inputs para estados de carga y error (opcionalmente se pueden manejar individualmente o en objeto)
    @Input() loadingRepositoryLinkAI: boolean = false;
    @Input() loadingOutOfScopeAI: boolean = false;
    @Input() loadingStrategyAI: boolean = false;
    @Input() loadingLimitationsAI: boolean = false;
    @Input() loadingAssumptionsAI: boolean = false;
    @Input() loadingTeamAI: boolean = false;

    @Input() errorRepositoryLinkAI: string | null = null;
    @Input() errorOutOfScopeAI: string | null = null;
    @Input() errorStrategyAI: string | null = null;
    @Input() errorLimitationsAI: string | null = null;
    @Input() errorAssumptionsAI: string | null = null;
    @Input() errorTeamAI: string | null = null;

    @Input() riskData: RiskStrategyData | null = null;
    @Input() riskScenarioOptions: string[] = [];
    @Input() loadingRiskAI: boolean = false;
    @Input() errorRiskAI: string | null = null;

    // Outputs
    @Output() contentChange = new EventEmitter<{ section: StaticSectionName, content: string }>();
    @Output() regenerateAI = new EventEmitter<StaticSectionName>();
    @Output() riskDataChange = new EventEmitter<RiskStrategyData>();
    @Output() generateRiskAI = new EventEmitter<void>();
    @Output() regenerateRiskAI = new EventEmitter<void>();

    // Estados locales de edición
    editingRepositoryLink: boolean = false;
    editingOutOfScope: boolean = false;
    editingStrategy: boolean = false;
    editingLimitations: boolean = false;
    editingAssumptions: boolean = false;
    editingTeam: boolean = false;

    // Estados locales de detalles abiertos
    isRepositoryLinkDetailsOpen: boolean = false;
    isOutOfScopeDetailsOpen: boolean = false;
    isStrategyDetailsOpen: boolean = false;
    isLimitationsDetailsOpen: boolean = false;
    isAssumptionsDetailsOpen: boolean = false;
    isTeamDetailsOpen: boolean = false;
    isRiskDetailsOpen: boolean = false;

    // Copias temporales para edición
    tempRepositoryLink: string = '';
    tempOutOfScopeContent: string = '';
    tempStrategyContent: string = '';
    tempLimitationsContent: string = '';
    tempAssumptionsContent: string = '';
    tempTeamContent: string = '';
    localRiskData: RiskStrategyData = this.createEmptyRiskData();
    copiedFieldKey: string = '';

    readonly impactOptions: string[] = [
        '1 - Ninguno',
        '2 - Bajo',
        '3 - Moderado',
        '4 - Alto',
        '5 - Crítico'
    ];

    readonly probabilityOptions: string[] = [
        '25% - Poca posibilidad de ocurrir',
        '50% - Puede ocurrir',
        '75% - Gran posibilidad de ocurrir',
        '100% - Ocurrido (Issue)'
    ];

    constructor(@Inject(PLATFORM_ID) private platformId: Object) { }

    ngOnChanges(changes: SimpleChanges): void {
        if (changes['riskData']) {
            this.localRiskData = this.normalizeRiskData(this.riskData);
        }
    }

    toggleStaticEdit(section: StaticSectionName) {
        switch (section) {
            case 'repositoryLink':
                if (this.editingRepositoryLink) {
                    // Guardar
                    this.contentChange.emit({ section, content: this.tempRepositoryLink });
                    this.editingRepositoryLink = false;
                } else {
                    // Iniciar edición
                    this.tempRepositoryLink = this.repositoryLink;
                    this.editingRepositoryLink = true;
                    this.isRepositoryLinkDetailsOpen = true;
                }
                break;
            case 'outOfScope':
                if (this.editingOutOfScope) {
                    this.contentChange.emit({ section, content: this.tempOutOfScopeContent });
                    this.editingOutOfScope = false;
                } else {
                    this.tempOutOfScopeContent = this.outOfScopeContent;
                    this.editingOutOfScope = true;
                    this.isOutOfScopeDetailsOpen = true;
                }
                break;
            case 'strategy':
                if (this.editingStrategy) {
                    this.contentChange.emit({ section, content: this.tempStrategyContent });
                    this.editingStrategy = false;
                } else {
                    this.tempStrategyContent = this.strategyContent;
                    this.editingStrategy = true;
                    this.isStrategyDetailsOpen = true;
                }
                break;
            case 'limitations':
                if (this.editingLimitations) {
                    this.contentChange.emit({ section, content: this.tempLimitationsContent });
                    this.editingLimitations = false;
                } else {
                    this.tempLimitationsContent = this.limitationsContent;
                    this.editingLimitations = true;
                    this.isLimitationsDetailsOpen = true;
                }
                break;
            case 'assumptions':
                if (this.editingAssumptions) {
                    this.contentChange.emit({ section, content: this.tempAssumptionsContent });
                    this.editingAssumptions = false;
                } else {
                    this.tempAssumptionsContent = this.assumptionsContent;
                    this.editingAssumptions = true;
                    this.isAssumptionsDetailsOpen = true;
                }
                break;
            case 'team':
                if (this.editingTeam) {
                    this.contentChange.emit({ section, content: this.tempTeamContent });
                    this.editingTeam = false;
                } else {
                    this.tempTeamContent = this.teamContent;
                    this.editingTeam = true;
                    this.isTeamDetailsOpen = true;
                }
                break;
        }
    }

    regenerateStaticSectionWithAI(section: StaticSectionName) {
        this.regenerateAI.emit(section);
    }

    requestRiskGeneration(): void {
        this.generateRiskAI.emit();
    }

    requestRiskRegeneration(): void {
        this.regenerateRiskAI.emit();
    }

    onRiskFieldChange(): void {
        this.riskDataChange.emit({
            ...this.localRiskData,
            positiveScenarios: [...this.localRiskData.positiveScenarios],
            alternateScenarios: [...this.localRiskData.alternateScenarios]
        });
    }

    addPositiveScenario(): void {
        const nextOption = this.getNextAvailableScenario(this.localRiskData.positiveScenarios);
        this.localRiskData.positiveScenarios.push(nextOption || '');
        this.onRiskFieldChange();
    }

    addAlternateScenario(): void {
        const nextOption = this.getNextAvailableScenario(this.localRiskData.alternateScenarios);
        this.localRiskData.alternateScenarios.push(nextOption || '');
        this.onRiskFieldChange();
    }

    removePositiveScenario(index: number): void {
        if (this.localRiskData.positiveScenarios.length <= 2) {
            return;
        }
        this.localRiskData.positiveScenarios.splice(index, 1);
        this.onRiskFieldChange();
    }

    removeAlternateScenario(index: number): void {
        if (this.localRiskData.alternateScenarios.length <= 1) {
            return;
        }
        this.localRiskData.alternateScenarios.splice(index, 1);
        this.onRiskFieldChange();
    }

    getScenarioOptions(currentValues: string[], index: number): string[] {
        const currentValue = currentValues[index] || '';
        const selectedOthers = currentValues
            .filter((_, i) => i !== index)
            .map(v => v.trim())
            .filter(Boolean);

        return this.riskScenarioOptions.filter(option => {
            const normalizedOption = option.trim();
            return normalizedOption === currentValue.trim() || !selectedOthers.includes(normalizedOption);
        });
    }

    copyRiskField(value: string, fieldKey: string): void {
        if (!isPlatformBrowser(this.platformId) || !navigator?.clipboard) {
            return;
        }

        const normalizedValue = (value || '').toString().trim();
        if (!normalizedValue) {
            return;
        }

        navigator.clipboard.writeText(normalizedValue)
            .then(() => {
                this.copiedFieldKey = fieldKey;
                setTimeout(() => {
                    if (this.copiedFieldKey === fieldKey) {
                        this.copiedFieldKey = '';
                    }
                }, 1200);
            });
    }

    private createEmptyRiskData(): RiskStrategyData {
        return {
            probabilidadDe: '',
            puedeOcurrir: '',
            loQuePodriaOcasionar: '',
            impacto: '',
            probabilidad: '',
            positiveScenarios: ['', ''],
            alternateScenarios: ['']
        };
    }

    private normalizeRiskData(riskData: RiskStrategyData | null): RiskStrategyData {
        if (!riskData) {
            return this.createEmptyRiskData();
        }

        const positives = [...(riskData.positiveScenarios || [])].filter(v => v !== undefined);
        const alternates = [...(riskData.alternateScenarios || [])].filter(v => v !== undefined);

        while (positives.length < 2) {
            positives.push('');
        }
        while (alternates.length < 1) {
            alternates.push('');
        }

        return {
            probabilidadDe: riskData.probabilidadDe || '',
            puedeOcurrir: riskData.puedeOcurrir || '',
            loQuePodriaOcasionar: riskData.loQuePodriaOcasionar || '',
            impacto: riskData.impacto || '',
            probabilidad: riskData.probabilidad || '',
            positiveScenarios: positives,
            alternateScenarios: alternates
        };
    }

    private getNextAvailableScenario(currentSelection: string[]): string {
        const selected = currentSelection.map(v => v.trim()).filter(Boolean);
        return this.riskScenarioOptions.find(option => !selected.includes(option.trim())) || '';
    }
}
