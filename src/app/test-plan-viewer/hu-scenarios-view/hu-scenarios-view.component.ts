import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Router } from '@angular/router';
import { ExcelMatrixExporterComponent } from '../../excel-matrix-exporter/excel-matrix-exporter.component';
import { HUData } from '../../models/hu-data.model';
import { ToastService } from '../../services/core/toast.service';
import { ExportService } from '../../services/export/export.service';
import { HuSyncService } from '../../services/core/hu-sync.service';
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
  private huSyncSubscription: Subscription | null = null;

  constructor(
    private router: Router,
    private toastService: ToastService,
    private exportService: ExportService,
    private huSyncService: HuSyncService
  ) { }

  ngOnInit(): void {
    const state = this.router.getCurrentNavigation()?.extras.state || history.state;

    if (state?.hu) {
      this.hu = state.hu as HUData;
      this.testPlanId = state.testPlanId || '';
      this.testPlanTitle = state.testPlanTitle || '';
      const latestHu = this.huSyncService.getLatestHu(this.hu.id);
      if (latestHu) {
        this.hu = latestHu;
      }
      this.subscribeToHuUpdates();
      return;
    }

    this.toastService.warning('No se encontró la HU seleccionada para mostrar escenarios');
  }

  ngOnDestroy(): void {
    this.huSyncSubscription?.unsubscribe();
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

    const latestHu = this.huSyncService.getLatestHu(this.hu.id);
    if (latestHu) {
      this.hu = latestHu;
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

  exportExecutionMatrixToExcel(): void {
    if (!this.hu) return;

    if (this.matrixExporter) {
      this.matrixExporter.generateMatrixExcel(this.hu);
    } else {
      this.toastService.error('El componente para exportar no se ha cargado correctamente');
    }
  }
}
