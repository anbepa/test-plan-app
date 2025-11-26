import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export type StaticSectionName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';

@Component({
    selector: 'app-general-sections',
    standalone: true,
    imports: [CommonModule, FormsModule],
    templateUrl: './general-sections.component.html',
    styleUrls: ['./general-sections.component.css']
})
export class GeneralSectionsComponent {
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

    // Outputs
    @Output() contentChange = new EventEmitter<{ section: StaticSectionName, content: string }>();
    @Output() regenerateAI = new EventEmitter<StaticSectionName>();

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

    // Copias temporales para edición
    tempRepositoryLink: string = '';
    tempOutOfScopeContent: string = '';
    tempStrategyContent: string = '';
    tempLimitationsContent: string = '';
    tempAssumptionsContent: string = '';
    tempTeamContent: string = '';

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
}
