import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { catchError, finalize, from, of, switchMap } from 'rxjs';
import { AiUnifiedService } from '../../services/ai/ai-unified.service';
import { ToastService } from '../../services/core/toast.service';
import { DatabaseService, DbTestPlan } from '../../services/database/database.service';
import { TestPlanMapperService } from '../../services/database/test-plan-mapper.service';
import { HUData } from '../../models/hu-data.model';
import { StaticSectionName } from '../components/general-sections/general-sections.component';

interface SectionItem {
  key: StaticSectionName;
  title: string;
  value: string;
  editable: boolean;
  aiEnabled: boolean;
  loadingAI: boolean;
  errorAI: string | null;
}

@Component({
  selector: 'app-general-sections-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './general-sections-view.component.html',
  styleUrls: ['./general-sections-view.component.css']
})
export class GeneralSectionsViewComponent implements OnInit, OnDestroy {
  testPlanId: string = '';
  testPlanTitle: string = '';
  isLoading = true;

  huList: HUData[] = [];
  selectedSectionKeys: StaticSectionName[] = [];
  editingSectionKey: StaticSectionName | null = null;
  editingBuffer = '';

  // Anchos de columna en píxeles (null = auto)
  colWidths: (number | null)[] = [null, null, null, null, null, null];

  private resizingColIndex: number = -1;
  private resizeStartX: number = 0;
  private resizeStartWidth: number = 0;
  private readonly boundMouseMove = (e: MouseEvent) => this.onResizeMouseMove(e);
  private readonly boundMouseUp = () => this.onResizeMouseUp();

  sections: SectionItem[] = [
    { key: 'repositoryLink', title: 'Repositorio Pruebas VSTS', value: '', editable: true, aiEnabled: false, loadingAI: false, errorAI: null },
    { key: 'outOfScope', title: 'Fuera del Alcance', value: '', editable: true, aiEnabled: true, loadingAI: false, errorAI: null },
    { key: 'strategy', title: 'Estrategia', value: '', editable: true, aiEnabled: true, loadingAI: false, errorAI: null },
    { key: 'limitations', title: 'Limitaciones', value: '', editable: true, aiEnabled: true, loadingAI: false, errorAI: null },
    { key: 'assumptions', title: 'Supuestos', value: '', editable: true, aiEnabled: true, loadingAI: false, errorAI: null },
    { key: 'team', title: 'Equipo de Trabajo', value: '', editable: true, aiEnabled: false, loadingAI: false, errorAI: null }
  ];

  constructor(
    private router: Router,
    private route: ActivatedRoute,
    private databaseService: DatabaseService,
    private mapper: TestPlanMapperService,
    private aiService: AiUnifiedService,
    private toastService: ToastService
  ) { }

  async ngOnInit(): Promise<void> {
    this.testPlanId = this.route.snapshot.paramMap.get('id') || '';
    this.testPlanTitle = history.state?.testPlanTitle || '';

    if (!this.testPlanId) {
      this.toastService.warning('No se encontró el plan de pruebas');
      this.goBack();
      return;
    }

    await this.loadData();
  }

  private async loadData(): Promise<void> {
    this.isLoading = true;
    try {
      const plan = await this.databaseService.getTestPlanById(this.testPlanId);
      if (!plan) {
        this.toastService.error('No se pudo cargar el plan de pruebas');
        this.goBack();
        return;
      }

      this.testPlanTitle = this.testPlanTitle || plan.title || '';
      this.huList = this.mapper.mapDbTestPlanToHUList(plan);

      this.setSectionValue('repositoryLink', plan.repository_link || '');
      this.setSectionValue('outOfScope', plan.out_of_scope || '');
      this.setSectionValue('strategy', plan.strategy || '');
      this.setSectionValue('limitations', plan.limitations || '');
      this.setSectionValue('assumptions', plan.assumptions || '');
      this.setSectionValue('team', plan.team || '');

    } catch (error) {
      console.error('❌ Error cargando secciones generales:', error);
      this.toastService.error('Error al cargar secciones generales del plan');
      this.goBack();
    } finally {
      this.isLoading = false;
    }
  }

  goBack(): void {
    this.goToPlanDetail();
  }

  goToPlansList(): void {
    this.router.navigate(['/viewer']);
  }

  goToPlanDetail(): void {
    if (this.testPlanId) {
      this.router.navigate(['/viewer'], { queryParams: { id: this.testPlanId } });
      return;
    }

    this.router.navigate(['/viewer']);
  }

  goToCurrentPage(): void {
    if (!this.testPlanId) return;

    this.router.navigate(['/viewer/general-sections', this.testPlanId], {
      state: { testPlanTitle: this.testPlanTitle }
    });
  }

  isSectionSelected(key: StaticSectionName): boolean {
    return this.selectedSectionKeys.includes(key);
  }

  onSectionSelectionChange(key: StaticSectionName, checked: boolean): void {
    if (checked) {
      if (!this.selectedSectionKeys.includes(key)) {
        this.selectedSectionKeys = [...this.selectedSectionKeys, key];
      }
      return;
    }

    this.selectedSectionKeys = this.selectedSectionKeys.filter(item => item !== key);

    if (this.editingSectionKey === key) {
      this.cancelEditing();
    }
  }

  canEditSelected(): boolean {
    return this.selectedSectionKeys.length === 1 && this.editingSectionKey === null;
  }

  canSaveSelected(): boolean {
    return this.selectedSectionKeys.length === 1 && this.editingSectionKey === this.selectedSectionKeys[0];
  }

  canImproveWithAI(): boolean {
    if (this.selectedSectionKeys.length !== 1 || this.editingSectionKey !== null) return false;
    const selected = this.getSelectedSection();
    return !!selected?.aiEnabled && !selected.loadingAI;
  }

  startEditingSelected(): void {
    const selected = this.getSelectedSection();
    if (!selected) {
      this.toastService.warning('Selecciona una sección para editar');
      return;
    }

    this.editingSectionKey = selected.key;
    this.editingBuffer = selected.value;
  }

  cancelEditing(): void {
    this.editingSectionKey = null;
    this.editingBuffer = '';
  }

  async saveSelected(): Promise<void> {
    const selected = this.getSelectedSection();
    if (!selected || this.editingSectionKey !== selected.key) {
      return;
    }

    const updates = this.buildDbUpdate(selected.key, this.editingBuffer);

    const loadingToastId = this.toastService.loading('Guardando sección...');
    const success = await this.databaseService.updateTestPlan(this.testPlanId, updates);
    this.toastService.dismiss(loadingToastId);

    if (!success) {
      this.toastService.error('No se pudo guardar la sección');
      return;
    }

    selected.value = this.editingBuffer;
    this.editingSectionKey = null;
    this.editingBuffer = '';
    this.toastService.success('Sección guardada correctamente');
  }

  improveSelectedWithAI(): void {
    const selected = this.getSelectedSection();
    if (!selected) {
      this.toastService.warning('Selecciona una sección para mejorar');
      return;
    }

    if (!selected.aiEnabled) {
      this.toastService.info('Esta sección no tiene mejora con IA habilitada');
      return;
    }

    selected.loadingAI = true;
    selected.errorAI = null;

    const huSummary = this.mapper.getHuSummaryForAI(this.huList);

    this.aiService.generateEnhancedStaticSectionContent(selected.title, selected.value || '', huSummary)
      .pipe(
        switchMap((enhancedContent: string) => {
          if (!enhancedContent || !enhancedContent.trim()) {
            this.toastService.info(`La sección "${selected.title}" ya está completa`);
            return of(null);
          }

          const compact = this.compactStaticSectionContent(enhancedContent);
          const updates = this.buildDbUpdate(selected.key, compact);

          // Guardar automáticamente en BD
          return from(this.databaseService.updateTestPlan(this.testPlanId, updates)).pipe(
            switchMap((success: boolean) => {
              if (!success) {
                this.toastService.error(`No se pudo guardar la sección "${selected.title}" en la base de datos`);
                return of(null);
              }

              // Persistencia exitosa → actualizar valor en memoria
              selected.value = compact;
              this.toastService.success(`Sección "${selected.title}" mejorada y guardada automáticamente`);
              return of(compact);
            })
          );
        }),
        catchError(err => {
          const errorMsg = err?.message || 'Error desconocido al mejorar con IA';
          selected.errorAI = errorMsg;
          this.toastService.error(`Error al mejorar "${selected.title}": ${errorMsg}`);
          return of(null);
        }),
        finalize(() => {
          selected.loadingAI = false;
        })
      )
      .subscribe();
  }

  getSectionDisplayValue(section: SectionItem): string {
    if (this.editingSectionKey === section.key) {
      return this.editingBuffer;
    }

    return section.value || '';
  }

  updateEditingBuffer(value: string): void {
    this.editingBuffer = value;
  }

  private getSelectedSection(): SectionItem | null {
    if (this.selectedSectionKeys.length !== 1) return null;
    return this.sections.find(s => s.key === this.selectedSectionKeys[0]) || null;
  }

  private setSectionValue(key: StaticSectionName, value: string): void {
    const target = this.sections.find(section => section.key === key);
    if (target) {
      target.value = value;
    }
  }

  private buildDbUpdate(key: StaticSectionName, value: string): Partial<DbTestPlan> {
    switch (key) {
      case 'repositoryLink':
        return { repository_link: value };
      case 'outOfScope':
        return { out_of_scope: value };
      case 'strategy':
        return { strategy: value };
      case 'limitations':
        return { limitations: value };
      case 'assumptions':
        return { assumptions: value };
      case 'team':
        return { team: value };
      default:
        return {};
    }
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
  }

  onResizeMouseDown(event: MouseEvent, colIndex: number): void {
    event.preventDefault();
    event.stopPropagation();

    const th = (event.target as HTMLElement).closest('th') as HTMLElement;
    const currentWidth = th ? th.getBoundingClientRect().width : 160;

    this.resizingColIndex = colIndex;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = currentWidth;

    document.addEventListener('mousemove', this.boundMouseMove);
    document.addEventListener('mouseup', this.boundMouseUp);
  }

  private onResizeMouseMove(event: MouseEvent): void {
    if (this.resizingColIndex < 0) return;

    const dx = event.clientX - this.resizeStartX;
    const newWidth = Math.max(120, this.resizeStartWidth + dx);
    const updated = [...this.colWidths];
    updated[this.resizingColIndex] = newWidth;
    this.colWidths = updated;
  }

  private onResizeMouseUp(): void {
    this.resizingColIndex = -1;
    document.removeEventListener('mousemove', this.boundMouseMove);
    document.removeEventListener('mouseup', this.boundMouseUp);
  }

  getColStyle(index: number): Record<string, string> {
    const w = this.colWidths[index];
    if (w == null) return {};
    return { width: w + 'px', minWidth: w + 'px', maxWidth: w + 'px' };
  }

  private compactStaticSectionContent(content: string): string {
    if (!content) return '';

    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.replace(/^[-•\d.)\s]+/, '').trim())
      .slice(0, 6)
      .map(line => line.slice(0, 220));

    const compact = lines.join('\n');
    return compact.slice(0, 1200).trim();
  }
}
