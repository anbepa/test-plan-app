import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild, ChangeDetectorRef, HostListener } from '@angular/core';
import { Router } from '@angular/router';
import { ExcelMatrixExporterComponent } from '../../excel-matrix-exporter/excel-matrix-exporter.component';
import { HUData, DetailedTestCase } from '../../models/hu-data.model';
import { ToastService } from '../../services/core/toast.service';
import { ExportService } from '../../services/export/export.service';
import { HuSyncService } from '../../services/core/hu-sync.service';
import { DatabaseService } from '../../services/database/database.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-hu-scenarios-view',
  standalone: true,
  imports: [CommonModule, ExcelMatrixExporterComponent],
  templateUrl: './hu-scenarios-view.component.html',
  styleUrls: ['./hu-scenarios-view.component.css']
})
export class HuScenariosViewComponent implements OnInit, OnDestroy {
  @ViewChild('matrixExporter') matrixExporter!: ExcelMatrixExporterComponent;

  hu: HUData | null = null;
  testPlanId: string = '';
  testPlanTitle: string = '';
  isLoadingScenarios: boolean = false;
  scopeExpanded: boolean = false;
  exportMenuOpen: boolean = false;
  private huSyncSubscription: Subscription | null = null;

  constructor(
    private router: Router,
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService,
    private databaseService: DatabaseService,
    private cdr: ChangeDetectorRef
  ) { }

  ngOnInit(): void {
    const state = this.router.getCurrentNavigation()?.extras.state || history.state;

    if (state?.hu) {
      this.hu = state.hu as HUData;
      this.testPlanId = state.testPlanId || '';
      this.testPlanTitle = state.testPlanTitle || '';

      // Tries to get the lastest from memory cache first
      const latestHu = this.huSyncService.getLatestHu(this.hu.id);
      if (latestHu && latestHu.detailedTestCases && latestHu.detailedTestCases.length > 0) {
        this.hu = latestHu;
      }

      // Important: Always sync from DB to ensure persistence
      this.loadScenariosFromDb();

      this.subscribeToHuUpdates();
      return;
    }

    this.toastService.warning('No se encontró la HU seleccionada');
  }

  /** Loads test cases from Supabase and syncs with the app cache. */
  private async loadScenariosFromDb(): Promise<void> {
    if (!this.hu) return;

    try {
      this.isLoadingScenarios = true;
      this.cdr.detectChanges();

      const dbUuid = this.hu.dbUuid;
      const customId = this.hu.id;

      let query = this.databaseService.supabase
        .from('user_stories')
        .select(`
          id,
          test_cases (
            id,
            title,
            preconditions,
            expected_results,
            position,
            test_case_steps (
              id,
              step_number,
              action
            )
          )
        `);

      if (dbUuid) {
        query = query.eq('id', dbUuid);
      } else if (this.testPlanId) {
        query = query.eq('test_plan_id', this.testPlanId).eq('custom_id', customId);
      } else {
        return;
      }

      const { data, error } = await query.limit(1).single();

      if (error || !data) return;

      const sortedCases = [...(data.test_cases || [])].sort(
        (a: any, b: any) => (a.position ?? 0) - (b.position ?? 0)
      );

      const freshCases: DetailedTestCase[] = sortedCases.map((tc: any) => ({
        dbId: tc.id,
        title: tc.title || 'Sin título',
        preconditions: tc.preconditions || '',
        expectedResults: tc.expected_results || '',
        steps: [...(tc.test_case_steps || [])]
          .sort((a: any, b: any) => (a.step_number ?? 0) - (b.step_number ?? 0))
          .map((step: any, idx: number) => ({
            dbId: step.id,
            numero_paso: step.step_number ?? idx + 1,
            accion: step.action || ''
          }))
      }));

      if (this.hu) {
        this.hu = { ...this.hu, detailedTestCases: freshCases };

        // Root Fix: Only publish if we have real data to avoid clearing other components
        if (freshCases.length > 0) {
          this.huSyncService.publishHuUpdate(this.hu, this.testPlanId, 'viewer' as any);
        }
      }
    } catch (err) {
      console.error('Error loading scenarios from DB:', err);
    } finally {
      this.isLoadingScenarios = false;
      this.cdr.detectChanges();
    }
  }

  ngOnDestroy(): void {
    this.huSyncSubscription?.unsubscribe();
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.exportMenuOpen = false;
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
    if (!this.hu) return;

    this.router.navigate(['/viewer/hu-scenarios'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId,
        testPlanTitle: this.testPlanTitle
      }
    });
  }

  goBackToHuTable(): void {
    this.goToPlanDetail();
  }

  editHuScenarios(): void {
    if (!this.hu) return;

    this.router.navigate(['/refiner'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId
      }
    });
  }

  executeTestPlan(): void {
    if (!this.hu) return;

    // Use the most up-to-date source: if local has cases, use it; else try cache
    if (!this.hu.detailedTestCases || this.hu.detailedTestCases.length === 0) {
      const latestHu = this.huSyncService.getLatestHu(this.hu.id);
      if (latestHu && latestHu.detailedTestCases && latestHu.detailedTestCases.length > 0) {
        this.hu = latestHu;
      }
    }

    this.router.navigate(['/viewer/execute-plan'], {
      state: {
        hu: this.hu,
        testPlanId: this.testPlanId,
        testPlanTitle: this.testPlanTitle
      }
    });
  }

  private subscribeToHuUpdates(): void {
    if (!this.hu?.id) return;

    this.huSyncSubscription?.unsubscribe();
    this.huSyncSubscription = this.huSyncService.watchHu(this.hu.id).subscribe((updatedHu) => {
      this.hu = updatedHu;
    });
  }

  async exportExecutionMatrixToDOCX(): Promise<void> {
    if (!this.hu?.detailedTestCases || this.hu.detailedTestCases.length === 0) {
      this.toastService.warning('No hay casos de prueba válidos para exportar');
      return;
    }

    try {
      await this.exportService.exportToDOCX(this.hu);
      this.toastService.success('Matriz (.docx) exportada exitosamente');
    } catch (error) {
      this.toastService.error('Error al exportar la matriz (.docx)');
    }
  }

  toggleExportMenu(event: MouseEvent): void {
    event.stopPropagation();
    this.exportMenuOpen = !this.exportMenuOpen;
  }

  async exportMatrix(format: 'docx' | 'xlsx', event?: MouseEvent): Promise<void> {
    event?.stopPropagation();
    this.exportMenuOpen = false;

    if (format === 'docx') {
      await this.exportExecutionMatrixToDOCX();
      return;
    }

    this.exportExecutionMatrixToExcel();
  }

  exportExecutionMatrixToExcel(): void {
    if (!this.hu) return;

    if (this.matrixExporter) {
      this.matrixExporter.generateMatrixExcel(this.hu);
    } else {
      this.toastService.error('El componente para exportar no se ha cargado correctamente');
    }
  }

  splitLines(text: string): string[] {
    if (!text) return [];
    return text.split('\n').map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(l => l.length > 0);
  }
}
