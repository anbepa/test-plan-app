import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
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
  editingSectionKey: StaticSectionName | null = null;
  editingBuffer = '';

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
    private toastService: ToastService,
    private cdr: ChangeDetectorRef,
    private ngZone: NgZone
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

  startEditing(section: SectionItem): void {
    if (this.editingSectionKey !== null && this.editingSectionKey !== section.key) {
      // Salir del anterior sin guardar
      this.cancelEditing();
    }
    this.editingSectionKey = section.key;
    this.editingBuffer = section.value || '';
  }

  cancelEditing(): void {
    this.editingSectionKey = null;
    this.editingBuffer = '';
  }

  async saveSection(section: SectionItem): Promise<void> {
    if (this.editingSectionKey !== section.key) return;

    const updates = this.buildDbUpdate(section.key, this.editingBuffer);
    const loadingToastId = this.toastService.loading('Guardando...');
    const success = await this.databaseService.updateTestPlan(this.testPlanId, updates);
    this.toastService.dismiss(loadingToastId);

    if (!success) {
      this.toastService.error('No se pudo guardar la sección');
      return;
    }

    section.value = this.editingBuffer;
    this.editingSectionKey = null;
    this.editingBuffer = '';
    this.toastService.success(`"${section.title}" guardada`);
    this.cdr.detectChanges();
  }

  improveWithAI(section: SectionItem): void {
    if (!section.aiEnabled || section.loadingAI) return;

    section.loadingAI = true;
    section.errorAI = null;
    this.cdr.detectChanges();

    const huSummary = this.mapper.getHuSummaryForAI(this.huList);

    this.aiService.generateEnhancedStaticSectionContent(section.title, section.value || '', huSummary)
      .pipe(
        switchMap((enhancedContent: string) => {
          if (!enhancedContent || !enhancedContent.trim()) {
            this.ngZone.run(() => {
              this.toastService.info(`"${section.title}" ya está completa`);
              this.cdr.detectChanges();
            });
            return of(null);
          }

          const compact = this.compactStaticSectionContent(enhancedContent);
          const updates = this.buildDbUpdate(section.key, compact);

          return from(this.databaseService.updateTestPlan(this.testPlanId, updates)).pipe(
            switchMap((success: boolean) => {
              this.ngZone.run(() => {
                if (!success) {
                  this.toastService.error(`No se pudo guardar "${section.title}"`);
                } else {
                  section.value = compact;
                  this.toastService.success(`"${section.title}" mejorada y guardada`);
                }
                this.cdr.detectChanges();
              });
              return of(success ? compact : null);
            })
          );
        }),
        catchError(err => {
          const errorMsg = err?.userMessage || err?.message || 'Error desconocido al mejorar con IA';
          this.ngZone.run(() => {
            section.errorAI = errorMsg;
            this.toastService.error(`Error al mejorar "${section.title}": ${errorMsg}`);
            this.cdr.detectChanges();
          });
          return of(null);
        }),
        finalize(() => {
          this.ngZone.run(() => {
            section.loadingAI = false;
            this.cdr.detectChanges();
          });
        })
      )
      .subscribe();
  }

  updateEditingBuffer(value: string): void {
    this.editingBuffer = value;
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

  ngOnDestroy(): void { }

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
