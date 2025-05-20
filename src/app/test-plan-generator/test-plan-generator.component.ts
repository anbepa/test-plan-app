// src/app/test-plan-generator/test-plan-generator.component.ts
import { Component, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { FormsModule, NgForm } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { GeminiService } from '../services/gemini.service';
import { catchError, finalize, tap } from 'rxjs/operators';
import { of, Subscription } from 'rxjs';
import { saveAs } from 'file-saver';

import { HUData } from '../models/hu-data.model';


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

  // --- Estado de Visibilidad del Formulario ---
  // showForm: boolean = true; // Se quita la propiedad ya que el botón de ocultar se elimina

  // --- Propiedad para el estado de validez del formulario ---
  isFormInvalid: boolean = true; // Inicialmente el formulario es inválido

  // --- Propiedad para el Título del Plan ---
  testPlanTitle: string = ''; // Esta propiedad se generará y mostrará en el HTML y el documento

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

  // --- Referencia al formulario en el template ---
  @ViewChild('huForm') huFormDirective!: NgForm;
  private formStatusSubscription!: Subscription; // Para manejar la suscripción

  // --- Constructor ---
  constructor(private geminiService: GeminiService) { }

  // --- Ciclos de Vida ---

  ngAfterViewInit(): void {
      // Nos suscribimos a los cambios de estado del formulario después de que la vista se haya inicializado
      if (this.huFormDirective && this.huFormDirective.statusChanges) {
          // Usamos setTimeout para evitar el error ExpressionChangedAfterItHasBeenCheckedError
          // porque estamos actualizando una propiedad que afecta la vista después de que ha sido verificada.
          this.formStatusSubscription = this.huFormDirective.statusChanges.subscribe(status => {
              setTimeout(() => {
                this.isFormInvalid = status !== 'VALID'; // 'INVALID' o 'PENDING' o 'DISABLED' -> inválido
              });
          });
      }
  }

  ngOnDestroy(): void {
      // Asegurarse de desuscribirse para evitar fugas de memoria
      if (this.formStatusSubscription) {
          this.formStatusSubscription.unsubscribe();
      }
  }

  // --- Métodos de Gestión de HU y Generación ---

  // Método llamado al enviar el formulario para añadir una nueva HU
  addHuAndGenerateData(): void {
    if (this.huFormDirective.invalid) {
      // Si el formulario no es válido, marca los campos como tocados para mostrar errores.
      Object.keys(this.huFormDirective.controls).forEach(key => {
        this.huFormDirective.controls[key].markAsTouched();
      });
      console.warn('Formulario no válido. Por favor, completa todos los campos requeridos.');
      return;
    }

    const huId = this.currentHuId.trim();
    const huTitle = this.currentHuTitle.trim();

    // Crear el objeto HUData para la nueva HU
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

        // Inicializar datos generados y estados
        generatedScope: '',
        generatedScenarios: [],
        generatedTestCaseTitles: '',

        editingScope: false,
        editingScenarios: false,

        loadingScope: true, // Inicia carga del alcance
        errorScope: null,
        loadingScenarios: true, // Inicia carga de escenarios
        errorScenarios: null,

        showRegenTechniquePicker: false,
        regenSelectedTechnique: ''
    };

     // Añadir la nueva HU a la lista
     this.huList.push(newHu);

     // Iniciar indicadores de carga globales
     this.loadingSections = true; this.sectionsError = null;
     this.loadingScenarios = true; this.scenariosError = null;

     // *** LLAMADA API: Generar Alcance inicial ***
     // Asumo que generateTestPlanSections devuelve el alcance.
     this.geminiService.generateTestPlanSections(newHu.originalInput.description, newHu.originalInput.acceptanceCriteria)
         .pipe(
             tap(scopeText => {
                 newHu.generatedScope = scopeText;
                 newHu.loadingScope = false; // Finaliza carga específica
             }),
             catchError(error => {
                 console.error(`Error generating scope for HU ${newHu.id}:`, error);
                 newHu.errorScope = error || 'Error al generar alcance.';
                 newHu.loadingScope = false;
                 this.sectionsError = 'Error al generar el alcance para una HU.';
                 return of(''); // Continúa el observable
             }),
             finalize(() => {
               // Ya no se finaliza this.loadingSections aquí directamente, se usa checkOverallLoadingStatus
               this.checkOverallLoadingStatus();
               this.updateTestPlanTitle(); // Actualizar el título del plan
               this.updatePreview(); // Actualiza la previsualización
               // *** DISPARAR GENERACIÓN DE ESCENARIOS DESPUÉS DEL ALCANCE ***
               this.generateInitialScenarios(newHu);
             })
         )
         .subscribe(); // Ejecuta el observable
  }

  // Método para generar escenarios iniciales (separado para claridad)
  private generateInitialScenarios(hu: HUData): void {
      hu.loadingScenarios = true;
      hu.errorScenarios = null;

      this.geminiService.generateScenarios(
          hu.originalInput.description,
          hu.originalInput.acceptanceCriteria,
          hu.originalInput.selectedTechnique // Usar la técnica seleccionada en el formulario principal
      )
      .pipe(
          tap(scenarios => {
              hu.generatedScenarios = scenarios;
              hu.generatedTestCaseTitles = this.formatScenarioTitles(scenarios);
              hu.loadingScenarios = false; // Finaliza carga específica
          }),
          catchError(error => {
              console.error(`Error generating scenarios for HU ${hu.id}:`, error);
              hu.errorScenarios = error || 'Error al generar escenarios.';
              hu.loadingScenarios = false;
              this.scenariosError = 'Error al generar los escenarios para una HU.';
              return of([]); // Continúa el observable
          }),
          finalize(() => {
              this.checkOverallLoadingStatus(); // Revisa el estado global de carga
              this.resetCurrentInputs(); // Limpia el formulario principal
              this.updatePreview(); // Actualiza la previsualización
          })
      )
      .subscribe(); // Ejecuta el observable
  }

  private checkOverallLoadingStatus(): void {
    // Verifica si alguna HU aún está cargando su alcance o escenarios
    this.loadingSections = this.huList.some(hu => hu.loadingScope);
    this.loadingScenarios = this.huList.some(hu => hu.loadingScenarios);
  }

  // --- Métodos de Edición y Regeneración por Bloque ---

  // Alterna el modo de edición para un bloque (alcance o escenarios)
  toggleEdit(hu: HUData, section: 'scope' | 'scenarios'): void {
      if (section === 'scenarios' && hu.showRegenTechniquePicker) {
           this.cancelScenarioRegeneration(hu);
      }

      const wasEditingScope = hu.editingScope;
      const wasEditingScenarios = hu.editingScenarios;

      if (section === 'scope') {
          hu.editingScope = !hu.editingScope;
      } else if (section === 'scenarios') {
          hu.editingScenarios = !hu.editingScenarios;
      }

      // Si salió del modo edición, actualiza la previsualización
      if ((section === 'scope' && wasEditingScope && !hu.editingScope) ||
          (section === 'scenarios' && wasEditingScenarios && !hu.editingScenarios)) {
           this.updatePreview();
      }
  }

  // Alterna el modo de edición para una sección estática
  toggleStaticEdit(section: string): void {
    switch (section) {
      case 'repositoryLink':
        this.editingRepositoryLink = !this.editingRepositoryLink;
        break;
      case 'outOfScope':
        this.editingOutOfScope = !this.editingOutOfScope;
        break;
      case 'strategy':
        this.editingStrategy = !this.editingStrategy;
        break;
      case 'limitations':
        this.editingLimitations = !this.editingLimitations;
        break;
      case 'assumptions':
        this.editingAssumptions = !this.editingAssumptions;
        break;
      case 'team':
        this.editingTeam = !this.editingTeam;
        break;
    }
    // Si se sale del modo de edición, actualiza la previsualización
    if (
        (!this.editingRepositoryLink && section === 'repositoryLink') ||
        (!this.editingOutOfScope && section === 'outOfScope') ||
        (!this.editingStrategy && section === 'strategy') ||
        (!this.editingLimitations && section === 'limitations') ||
        (!this.editingAssumptions && section === 'assumptions') ||
        (!this.editingTeam && section === 'team')
    ) {
        this.updatePreview(); // Actualiza la previsualización
    }
  }

  // Inicia el proceso de regeneración de escenarios mostrando el selector de técnica
  startScenarioRegeneration(hu: HUData): void {
      hu.editingScenarios = false; // Ocultar edición si estaba activa
      hu.showRegenTechniquePicker = true; // Mostrar picker
      hu.regenSelectedTechnique = hu.originalInput.selectedTechnique; // Sugiere la técnica original por defecto
      hu.errorScenarios = null; // Limpiar error específico
      this.scenariosError = null; // Limpiar error global si aplica
  }

  // Cancela el proceso de regeneración de escenarios
  cancelScenarioRegeneration(hu: HUData): void {
      hu.showRegenTechniquePicker = false; // Ocultar picker
      hu.regenSelectedTechnique = ''; // Limpiar selección
      hu.errorScenarios = null; // Limpiar error específico
      this.scenariosError = null; // Limpiar error global si aplica
  }

  // Confirma la regeneración de escenarios con la técnica seleccionada
  confirmRegenerateScenarios(hu: HUData): void {
      if (!hu.regenSelectedTechnique) {
          console.warn('Debes seleccionar una técnica para regenerar los escenarios.');
          // Aquí podrías mostrar un mensaje visual en la UI si lo deseas
          return;
      }

       if (!hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
           console.error('Faltan datos originales para regenerar escenarios.');
           hu.errorScenarios = 'Datos incompletos para regenerar.';
           return;
       }

      hu.loadingScenarios = true; // Iniciar carga específica
      hu.errorScenarios = null;
      this.loadingScenarios = true; // Iniciar carga global (aunque solo sea una HU, el spinner global podría indicar actividad)
      this.scenariosError = null;

      // *** LLAMADA API: Regenerar Escenarios con la nueva técnica ***
      this.geminiService.generateScenarios(
           hu.originalInput.description,
           hu.originalInput.acceptanceCriteria,
           hu.regenSelectedTechnique // <-- Usar la técnica del picker
      )
      .pipe(
          tap(scenarios => {
               hu.generatedScenarios = scenarios;
               hu.generatedTestCaseTitles = this.formatScenarioTitles(scenarios);
               hu.errorScenarios = null;
          }),
          catchError(error => {
               console.error(`Error regenerating scenarios for HU ${hu.id}:`, error);
               hu.errorScenarios = error || 'Error al regenerar escenarios.';
               this.scenariosError = 'Error al regenerar los escenarios para una HU.';
               return of([]);
          }),
          finalize(() => {
              hu.loadingScenarios = false; // Finaliza carga específica
              this.checkOverallLoadingStatus(); // Revisa el estado global de carga
              hu.showRegenTechniquePicker = false; // Ocultar picker
              hu.regenSelectedTechnique = ''; // Limpiar selección
              this.updatePreview(); // Actualiza previsualización
          })
      )
      .subscribe(); // Ejecuta el observable
  }

  // Regenera el alcance de una HU específica
  regenerateScope(hu: HUData): void {
       if (!hu.originalInput.description || !hu.originalInput.acceptanceCriteria) {
           console.error('Faltan datos originales para regenerar alcance.');
           hu.errorScope = 'Datos incompletos para regenerar.';
           return;
       }

       hu.editingScope = false; // Ocultar edición si estaba activa
       hu.loadingScope = true; // Iniciar carga específica
       hu.errorScope = null;
       this.loadingSections = true; // Iniciar carga global
       this.sectionsError = null;

       // *** LLAMADA API: Regenerar Alcance ***
       // Asumo que generateTestPlanSections devuelve el alcance.
       this.geminiService.generateTestPlanSections(hu.originalInput.description, hu.originalInput.acceptanceCriteria)
           .pipe(
               tap(scopeText => {
                   hu.generatedScope = scopeText;
                   hu.errorScope = null;
               }),
               catchError(error => {
                   console.error(`Error regenerating scope for HU ${hu.id}:`, error);
                    hu.errorScope = error || 'Error al regenerar alcance.';
                    this.sectionsError = 'Error al regenerar el alcance.';
                    return of('');
               }),
               finalize(() => {
                   hu.loadingScope = false; // Finaliza carga específica
                   this.checkOverallLoadingStatus(); // Revisa el estado global de carga
                   this.updatePreview(); // Actualiza previsualización
               })
           )
           .subscribe(); // Ejecuta el observable
   }

   // --- Métodos de Utilidad ---

   // Formatea los escenarios generados a una lista enumerada
   formatScenarioTitles(scenarios: string[]): string {
      if (!scenarios || scenarios.length === 0) {
        return 'No se generaron escenarios.';
      }
      return scenarios.map((scenario, index) => {
          const firstLine = scenario.split('\n')[0].replace(/^- /, '').trim(); // Limpiar el guion inicial
          return `${index + 1}. ${firstLine}`;
      }).join('\n');
   }

   // Limpia los campos del formulario principal
   private resetCurrentInputs(): void {
       this.currentHuId = '';
       this.currentHuTitle = '';
       this.currentSprint = '';
       this.currentDescription = '';
       this.currentAcceptanceCriteria = '';
       this.currentSelectedTechnique = '';
       // Asegurar que el formulario se resetee completamente
       if (this.huFormDirective) {
           this.huFormDirective.resetForm();
       }
   }

  // --- Métodos de Visibilidad del Formulario ---
  // toggleFormVisibility(): void { // Se quita el método ya que el botón de ocultar se elimina
  //     this.showForm = !this.showForm;
  // }

  // --- Métodos de Previsualización y Descarga ---

  // Nuevo método para actualizar el título del plan
  updateTestPlanTitle(): void {
      if (this.huList.length > 0) {
          // Seleccionar la última HU añadida para el ID y Sprint, o puedes tener otra lógica
          const latestHu = this.huList[this.huList.length - 1];
          const huIdForTitle = latestHu.id;
          const sprintForTitle = latestHu.sprint;
          this.testPlanTitle = `TEST PLAN EVC00057_ ${huIdForTitle} SPRINT ${sprintForTitle}`;
      } else {
          this.testPlanTitle = ''; // Si no hay HUs, el título está vacío
      }
  }


  // Genera la cadena de texto completa del plan para previsualización y descarga
  generatePlanContentString(): string {
     if (this.huList.length === 0) {
       return '';
     }

     let fullPlanContent = '';

     // Título del Plan (basado en la propiedad testPlanTitle)
     if (this.testPlanTitle) {
        fullPlanContent += `Título del Plan de Pruebas: ${this.testPlanTitle}\n\n`;
     }

     // Repositorio VSTS (ahora usa la propiedad editable)
     fullPlanContent += `Repositorio pruebas VSTS: ${this.repositoryLink}\n\n`;

     // ALCANCE CONSOLIDADO (Refactorizado para incluir la HU al final)
     fullPlanContent += `ALCANCE:\n\n`;
     this.huList.forEach((hu) => {
         fullPlanContent += `HU ${hu.id}: ${hu.title}\n`; // Título de la HU aquí
         fullPlanContent += `${hu.generatedScope}\n\n`;
     });

     // FUERA DEL ALCANCE (ahora usa la propiedad editable)
     fullPlanContent += `FUERA DEL ALCANCE:\n\n`;
     fullPlanContent += `${this.outOfScopeContent}\n\n`;

     // ESTRATEGIA (ahora usa la propiedad editable)
     fullPlanContent += `ESTRATEGIA:\n\n`;
     fullPlanContent += `${this.strategyContent}\n\n`;

     // CASOS DE PRUEBA CONSOLIDADO (Refactorizado para incluir la HU al final)
     fullPlanContent += `CASOS DE PRUEBA:\n\n`;
     this.huList.forEach((hu) => {
        fullPlanContent += `HU ${hu.id} ${hu.title}\n`; // Título de la HU aquí
        fullPlanContent += `${hu.generatedTestCaseTitles}\n\n`;
    });

     // LIMITACIONES (ahora usa la propiedad editable)
     fullPlanContent += `LIMITACIONES:\n\n`;
     fullPlanContent += `${this.limitationsContent}\n\n`;

     // SUPUESTOS (ahora usa la propiedad editable)
     fullPlanContent += `SUPUESTOS:\n\n`;
     fullPlanContent += `${this.assumptionsContent}\n\n`;

     // Equipo de Trabajo (ahora usa la propiedad editable)
     fullPlanContent += `Equipo de Trabajo:\n\n`;
     fullPlanContent += `${this.teamContent}\n\n`;

     return fullPlanContent;
  }

  // Actualiza la propiedad de previsualización
  updatePreview(): void {
      this.downloadPreviewContent = this.generatePlanContentString();
  }

  // Descarga el plan como archivo .doc (texto plano)
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

  // --- Método trackBy para *ngFor ---
  trackHuById(index: number, hu: HUData): string {
    return hu.id;
  }
}