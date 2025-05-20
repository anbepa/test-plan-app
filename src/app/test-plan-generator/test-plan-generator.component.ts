// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';

import { HUData } from '../models/hu-data.model'; // Ensure this path is correct

// Define the type for the base names of static sections passed from the template
type StaticSectionBaseName = 'repositoryLink' | 'outOfScope' | 'strategy' | 'limitations' | 'assumptions' | 'team';


@Component({
  selector: 'app-test-plan-generator',
  templateUrl: './test-plan-generator.component.html',
  styleUrls: ['./test-plan-generator.component.css'],
  standalone: true,
  imports: [
    FormsModule,
    CommonModule
  ]
})
export class TestPlanGeneratorComponent implements AfterViewInit, OnDestroy {

  // --- Propiedades del Formulario ---
  currentHuId: string = '';
  currentHuTitle: string = '';
  currentSprint: string = '';
  currentDescription: string = '';
  currentAcceptanceCriteria: string = '';
  currentSelectedTechnique: string = '';

  // --- Estado del Plan ---
  huList: HUData[] = [];
  downloadPreviewContent: string = '';

  // --- Estados de Carga y Error ---
  loadingSections: boolean = false;
  sectionsError: string | null = null;
  loadingScenarios: boolean = false;
  scenariosError: string | null = null;

  // --- Propiedad para el estado de validez del formulario ---
  isFormInvalid: boolean = true; // Inicialmente el formulario es inválido

  // --- Propiedad para el Título del Plan ---
  testPlanTitle: string = '';

  // --- Propiedades para el contenido editable de secciones estáticas ---
  repositoryLink: string = 'https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_git/NU0139001_SAF_MR_Test - Repos (visualstudio.com)';
  outOfScopeContent: string = 'No se probarán funcionalidades o secciones diferentes a los definidos en el alcance.';
  strategyContent: string = 'Trabajar en coordinación con el equipo de desarrollo para identificar y/o corregir errores en etapas tempranas del proyecto.\nReportar bugs de manera inmediata, con el fin de que sean corregidos lo más pronto posible y no se vean afectadas las fechas planteadas para las entregas que generan valor al cliente.\nEl ambiente de certificación se encuentra estable.';
  limitationsContent: string = 'No tener los permisos requeridos para la aplicación.';
  assumptionsContent: string = 'El equipo de desarrollo ha realizado pruebas unitarias y de aceptación.\nSe cuenta con los insumos necesarios para realizar las pruebas.\nSe cuenta con las herramientas necesarias para la ejecución de las pruebas.\nSe cuenta con los permisos y accesos requeridos para las pruebas.\nEl equipo de desarrollo tendrá disponibilidad para la corrección de errores.';
  teamContent: string = 'Dueño del Producto – Bancolombia: Diego Fernando Giraldo Hincapie\nAnalista de Desarrollo – Pragma: Eddy Johana Cristancho\nAnalista de Desarrollo – Luis Alfredo Chuscano Remolina\nAnalista de Desarrollo - Kevin David Cuadros Estupinan\nAnalista de Pruebas – TCS: Gabriel Ernesto Montoya Henao\nAnalista de Pruebas – TCS: Andrés Antonio Bernal Padilla';

  // --- Propiedades para el estado de edición de secciones estáticas ---
  editingRepositoryLink: boolean = false;
  editingOutOfScope: boolean = false;
  editingStrategy: boolean = false;
  editingLimitations: boolean = false;
  editingAssumptions: boolean = false;
  editingTeam: boolean = false;

  // --- Propiedades para el estado de apertura/cierre de <details> en secciones estáticas ---
  isRepositoryLinkDetailsOpen: boolean = true;
  isOutOfScopeDetailsOpen: boolean = true;
  isStrategyDetailsOpen: boolean = true;
  isLimitationsDetailsOpen: boolean = true;
  isAssumptionsDetailsOpen: boolean = true;
  isTeamDetailsOpen: boolean = true;


  // --- Referencia al formulario en el template ---
  @ViewChild('huForm') huFormDirective!: NgForm;
  private formStatusSubscription!: Subscription;

  constructor(private geminiService: GeminiService) { }

  ngAfterViewInit(): void {
      if (this.huFormDirective && this.huFormDirective.statusChanges) {
          this.formStatusSubscription = this.huFormDirective.statusChanges.subscribe(status => {
              setTimeout(() => {
                this.isFormInvalid = status !== 'VALID';
              });
          });
      }
  }

  ngOnDestroy(): void {
      if (this.formStatusSubscription) {
          this.formStatusSubscription.unsubscribe();
      }
  }

  addHuAndGenerateData(): void {
    if (this.huFormDirective.invalid) {
      Object.keys(this.huFormDirective.controls).forEach(key => {
        this.huFormDirective.controls[key].markAsTouched();
      });
      console.warn('Formulario no válido. Por favor, completa todos los campos requeridos.');
      return;
    }

    const huId = this.currentHuId.trim();
    const huTitle = this.currentHuTitle.trim();

    const newHu: HUData = {
        originalInput: {
           id: this.currentHuId,
           title: this.currentHuTitle,
           sprint: this.currentSprint,
           description: this.currentDescription,
           acceptanceCriteria: this.currentAcceptanceCriteria,
           selectedTechnique: this.currentSelectedTechnique
        },
        id: huId,
        title: huTitle,
        sprint: this.currentSprint.trim(),
        generatedScope: '',
        generatedScenarios: [],
        generatedTestCaseTitles: '',
        editingScope: false,
        editingScenarios: false,
        loadingScope: true,
        errorScope: null,
        loadingScenarios: true,
        errorScenarios: null,
        showRegenTechniquePicker: false,
        regenSelectedTechnique: '',
        isScopeDetailsOpen: true, // Default to open
        isScenariosDetailsOpen: true // Default to open
    };

     this.huList.push(newHu);
     this.loadingSections = true; this.sectionsError = null;
     this.loadingScenarios = true; this.scenariosError = null;

     this.geminiService.generateTestPlanSections(newHu.originalInput.description, newHu.originalInput.acceptanceCriteria)
         .pipe(
             tap(scopeText => {
                 newHu.generatedScope = scopeText;
                 newHu.loadingScope = false;
             }),
             catchError(error => {
                 console.error(`Error generating scope for HU ${newHu.id}:`, error);
                 newHu.errorScope = (typeof error === 'string' ? error : error?.message) || 'Error al generar alcance.';
                 newHu.loadingScope = false;
                 this.sectionsError = 'Error al generar el alcance para una HU.';
                 return of('');
             }),
             finalize(() => {
               this.checkOverallLoadingStatus();
               this.updateTestPlanTitle();
               this.updatePreview();
               this.generateInitialScenarios(newHu);
             })
         )
         .subscribe();
  }

  private generateInitialScenarios(hu: HUData): void {
      hu.loadingScenarios = true;
      hu.errorScenarios = null;

      this.geminiService.generateScenarios(
          hu.originalInput.description,
          hu.originalInput.acceptanceCriteria,
          hu.originalInput.selectedTechnique
      )
      .pipe(
          tap(scenarios => {
              hu.generatedScenarios = scenarios;
              hu.generatedTestCaseTitles = this.formatScenarioTitles(scenarios);
              hu.loadingScenarios = false;
          }),
          catchError(error => {
              console.error(`Error generating scenarios for HU ${hu.id}:`, error);
              hu.errorScenarios = (typeof error === 'string' ? error : error?.message) || 'Error al generar escenarios.';
              hu.loadingScenarios = false;
              this.scenariosError = 'Error al generar los escenarios para una HU.';
              return of([]);
          }),
          finalize(() => {
              this.checkOverallLoadingStatus();
              this.resetCurrentInputs();
              this.updatePreview();
          })
      )
      .subscribe();
  }

  private checkOverallLoadingStatus(): void {
    this.loadingSections = this.huList.some(hu => hu.loadingScope);
    this.loadingScenarios = this.huList.some(hu => hu.loadingScenarios);
  }

  toggleEdit(hu: HUData, section: 'scope' | 'scenarios'): void {
      if (section === 'scenarios' && hu.showRegenTechniquePicker) {
           this.cancelScenarioRegeneration(hu); // Exit regen mode if active
      }

      const wasEditingScope = hu.editingScope;
      const wasEditingScenarios = hu.editingScenarios;

      if (section === 'scope') {
          hu.editingScope = !hu.editingScope;
          if (hu.editingScope) hu.isScopeDetailsOpen = true; // Ensure details open when starting edit
      } else if (section === 'scenarios') {
          hu.editingScenarios = !hu.editingScenarios;
          if (hu.editingScenarios) hu.isScenariosDetailsOpen = true; // Ensure details open when starting edit
      }

      // If exited edit mode, update preview
      if ((section === 'scope' && wasEditingScope && !hu.editingScope) ||
          (section === 'scenarios' && wasEditingScenarios && !hu.editingScenarios)) {
           this.updatePreview();
      }
  }

  toggleStaticEdit(baseName: StaticSectionBaseName): void {
    let editingProp: keyof TestPlanGeneratorComponent;
    let detailsOpenProp: keyof TestPlanGeneratorComponent;

    switch (baseName) {
        case 'repositoryLink':
            editingProp = 'editingRepositoryLink';
            detailsOpenProp = 'isRepositoryLinkDetailsOpen';
            break;
        case 'outOfScope':
            editingProp = 'editingOutOfScope';
            detailsOpenProp = 'isOutOfScopeDetailsOpen';
            break;
        case 'strategy':
            editingProp = 'editingStrategy';
            detailsOpenProp = 'isStrategyDetailsOpen';
            break;
        case 'limitations':
            editingProp = 'editingLimitations';
            detailsOpenProp = 'isLimitationsDetailsOpen';
            break;
        case 'assumptions':
            editingProp = 'editingAssumptions';
            detailsOpenProp = 'isAssumptionsDetailsOpen';
            break;
        case 'team':
            editingProp = 'editingTeam';
            detailsOpenProp = 'isTeamDetailsOpen';
            break;
        default:
            // This case should ideally not be reached if baseName is correctly typed
            const exhaustiveCheck: never = baseName;
            console.error('Invalid static section base name:', exhaustiveCheck);
            return;
    }

    // Type assertion is needed here because TypeScript can't infer that editingProp
    // will always be a boolean property based on the switch cases alone without more complex mapped types.
    const wasEditing = this[editingProp] as boolean;
    (this[editingProp] as any) = !wasEditing; // Use 'as any' for assignment if direct boolean typing is tricky

    if (this[editingProp]) { // If starting to edit
        (this[detailsOpenProp] as any) = true; // Ensure details open
    }

    if (wasEditing && !(this[editingProp] as boolean)) { // If stopped editing
        this.updatePreview();
    }
}


  startScenarioRegeneration(hu: HUData): void {
      hu.editingScenarios = false; // Ensure not in text edit mode
      hu.showRegenTechniquePicker = true;
      hu.isScenariosDetailsOpen = true; // Ensure details open for picker
      hu.regenSelectedTechnique = hu.originalInput.selectedTechnique;
      hu.errorScenarios = null;
      this.scenariosError = null;
  }

  cancelScenarioRegeneration(hu: HUData): void {
      hu.showRegenTechniquePicker = false;
      hu.regenSelectedTechnique = '';
      hu.errorScenarios = null;
  }

  confirmRegenerateScenarios(hu: HUData): void {
      if (!hu.regenSelectedTechnique) {
          console.warn('Debes seleccionar una técnica para regenerar los escenarios.');
          hu.errorScenarios = 'Selecciona una técnica para regenerar.';
          return;
      }

       if (!hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
           console.error('Faltan datos originales para regenerar escenarios.');
           hu.errorScenarios = 'Datos incompletos para regenerar.';
           return;
       }

      hu.loadingScenarios = true;
      hu.errorScenarios = null;
      this.loadingScenarios = this.huList.some(h => h.loadingScenarios || h.id === hu.id);
      this.scenariosError = null;

      this.geminiService.generateScenarios(
           hu.originalInput.description,
           hu.originalInput.acceptanceCriteria,
           hu.regenSelectedTechnique
      )
      .pipe(
          tap(scenarios => {
               hu.generatedScenarios = scenarios;
               hu.generatedTestCaseTitles = this.formatScenarioTitles(scenarios);
               hu.errorScenarios = null;
          }),
          catchError(error => {
               console.error(`Error regenerating scenarios for HU ${hu.id}:`, error);
               hu.errorScenarios = (typeof error === 'string' ? error : error?.message) || 'Error al regenerar escenarios.';
               this.scenariosError = `Error al regenerar escenarios para HU ${hu.id}.`;
               return of([]);
          }),
          finalize(() => {
              hu.loadingScenarios = false;
              this.checkOverallLoadingStatus();
              hu.showRegenTechniquePicker = false;
              this.updatePreview();
          })
      )
      .subscribe();
  }

  regenerateScope(hu: HUData): void {
       if (!hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
           console.error('Faltan datos originales para regenerar alcance.');
           hu.errorScope = 'Datos incompletos para regenerar.';
           return;
       }

       hu.editingScope = false;
       hu.isScopeDetailsOpen = true; // Ensure details open
       hu.loadingScope = true;
       hu.errorScope = null;
       this.loadingSections = this.huList.some(h => h.loadingScope || h.id === hu.id);
       this.sectionsError = null;

       this.geminiService.generateTestPlanSections(hu.originalInput.description, hu.originalInput.acceptanceCriteria)
           .pipe(
               tap(scopeText => {
                   hu.generatedScope = scopeText;
                   hu.errorScope = null;
               }),
               catchError(error => {
                   console.error(`Error regenerating scope for HU ${hu.id}:`, error);
                    hu.errorScope = (typeof error === 'string' ? error : error?.message) || 'Error al regenerar alcance.';
                    this.sectionsError = `Error al regenerar el alcance para HU ${hu.id}.`;
                    return of('');
               }),
               finalize(() => {
                   hu.loadingScope = false;
                   this.checkOverallLoadingStatus();
                   this.updatePreview();
               })
           )
           .subscribe();
   }

   formatScenarioTitles(scenarios: string[]): string {
      if (!scenarios || scenarios.length === 0) {
        return 'No se generaron escenarios.';
      }
      return scenarios.map((scenario, index) => {
          const firstLine = scenario.split('\n')[0].replace(/^- /, '').trim();
          return `${index + 1}. ${firstLine}`;
      }).join('\n');
   }

   private resetCurrentInputs(): void {
       this.currentHuId = '';
       this.currentHuTitle = '';
       this.currentSprint = '';
       this.currentDescription = '';
       this.currentAcceptanceCriteria = '';
       this.currentSelectedTechnique = '';
       if (this.huFormDirective) {
           this.huFormDirective.resetForm();
           setTimeout(() => {
             this.isFormInvalid = this.huFormDirective.invalid ?? true;
           });
       } else {
        this.isFormInvalid = true;
       }
   }

  updateTestPlanTitle(): void {
      if (this.huList.length > 0) {
          const latestHu = this.huList[this.huList.length - 1];
          const huIdForTitle = latestHu.id;
          const sprintForTitle = latestHu.sprint;
          this.testPlanTitle = `TEST PLAN EVC00057_ ${huIdForTitle} SPRINT ${sprintForTitle}`;
      } else {
          this.testPlanTitle = '';
      }
  }


  generatePlanContentString(): string {
     if (this.huList.length === 0) {
       return '';
     }

     let fullPlanContent = '';

     if (this.testPlanTitle) {
        fullPlanContent += `Título del Plan de Pruebas: ${this.testPlanTitle}\n\n`;
     }

     fullPlanContent += `Repositorio pruebas VSTS: ${this.repositoryLink}\n\n`;

     fullPlanContent += `ALCANCE:\n\n`;
     this.huList.forEach((hu) => {
         fullPlanContent += `HU ${hu.id}: ${hu.title}\n`;
         fullPlanContent += `${hu.generatedScope}\n\n`;
     });

     fullPlanContent += `FUERA DEL ALCANCE:\n\n`;
     fullPlanContent += `${this.outOfScopeContent}\n\n`;

     fullPlanContent += `ESTRATEGIA:\n\n`;
     fullPlanContent += `${this.strategyContent}\n\n`;

     fullPlanContent += `CASOS DE PRUEBA:\n\n`;
     this.huList.forEach((hu) => {
        fullPlanContent += `HU ${hu.id} ${hu.title}\n`;
        fullPlanContent += `${hu.generatedTestCaseTitles}\n\n`;
    });

     fullPlanContent += `LIMITACIONES:\n\n`;
     fullPlanContent += `${this.limitationsContent}\n\n`;

     fullPlanContent += `SUPUESTOS:\n\n`;
     fullPlanContent += `${this.assumptionsContent}\n\n`;

     fullPlanContent += `Equipo de Trabajo:\n\n`;
     fullPlanContent += `${this.teamContent}\n\n`;

     return fullPlanContent;
  }

  updatePreview(): void {
      this.downloadPreviewContent = this.generatePlanContentString();
  }

  downloadWord(): void {
    const fullPlanContent = this.generatePlanContentString();
    if (!fullPlanContent) {
        console.warn('No hay contenido para descargar.');
        return;
    }

    const blob = new Blob([fullPlanContent], { type: 'text/plain;charset=utf-8' });
    const date = new Date().toISOString().split('T')[0];
    saveAs(blob, `PlanDePruebas_Completo_${date}.doc`);
  }

  trackHuById(index: number, hu: HUData): string {
    return hu.id;
  }
}