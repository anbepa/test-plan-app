import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DatabaseService, DbTestPlanWithRelations } from '../services/database/database.service';
import { ToastService } from '../services/core/toast.service';
import { HUData } from '../models/hu-data.model';
import { WordExporterComponent } from '../word-exporter/word-exporter.component';
import { TestPlanMapperService } from '../services/database/test-plan-mapper.service';

@Component({
    selector: 'app-test-plan-preview',
    standalone: true,
    imports: [CommonModule, WordExporterComponent],
    templateUrl: './test-plan-preview.component.html',
    styleUrls: ['./test-plan-preview.component.css']
})
export class TestPlanPreviewComponent implements OnInit {
    testPlanId: string | null = null;
    testPlan: DbTestPlanWithRelations | null = null;
    huList: HUData[] = [];
    previewHtmlContent: string = '';
    isLoading: boolean = true;
    errorMessage: string = '';
    copiedToClipboard: boolean = false;
    exportMenuOpen: boolean = false;

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private databaseService: DatabaseService,
        private mapper: TestPlanMapperService,
        private toastService: ToastService
    ) { }

    ngOnInit(): void {
        this.route.paramMap.subscribe(params => {
            this.testPlanId = params.get('id');
            if (this.testPlanId) {
                this.loadTestPlan(this.testPlanId);
            } else {
                this.errorMessage = 'ID de plan de pruebas no válido.';
                this.isLoading = false;
            }
        });
    }

    async loadTestPlan(id: string) {
        this.isLoading = true;
        try {
            const plan = await this.databaseService.getTestPlanById(id);
            if (plan) {
                this.testPlan = plan;
                // Convertir UserStories a HUData usando el mapper centralizado
                this.huList = this.mapper.mapDbTestPlanToHUList(plan);

                this.generatePreview();
            } else {
                this.errorMessage = 'Plan de pruebas no encontrado.';
            }
        } catch (error) {
            console.error('Error loading test plan:', error);
            this.errorMessage = 'Error al cargar el plan de pruebas.';
        } finally {
            this.isLoading = false;
        }
    }

    generatePreview(): void {
        if (!this.testPlan) return;

        let html = `<h1>Plan de Pruebas: ${this.testPlan.title}</h1>\n\n`;

        // Repositorio
        html += `<p><strong>Repositorio:</strong> ${this.testPlan.repository_link || 'No especificado'}</p>\n\n`;

        // 1. ALCANCE
        html += `<h2>1. ALCANCE</h2>\n`;
        this.huList.forEach(hu => {
            html += `<p><strong>HU ${hu.id}</strong></p>\n`;
            if (hu.generatedScope) {
                html += `<p>${hu.generatedScope}</p>\n`;
            } else {
                html += `<p>No se generó alcance para esta HU.</p>\n`;
            }
            html += `\n`;
        });

        // 2. Fuera de Alcance
        html += `<h2>2. Fuera de Alcance</h2>\n`;
        html += `<p>${this.testPlan.out_of_scope || 'No especificado'}</p>\n\n`;

        // 3. Estrategia
        html += `<h2>3. Estrategia</h2>\n`;
        html += `<p>${this.testPlan.strategy || 'No especificada'}</p>\n\n`;

        // 4. Casos de Prueba
        html += `<h2>4. Casos de Prueba</h2>\n`;
        this.huList.forEach(hu => {
            html += `<h3>ID ${hu.id}: ${hu.title}</h3>\n`;

            if (hu.detailedTestCases && hu.detailedTestCases.length > 0) {
                html += `<ul>\n`;
                hu.detailedTestCases.forEach((tc) => {
                    html += `<li>${tc.title}</li>\n`;
                });
                html += `</ul>\n`;
            } else {
                html += `<p>No hay casos de prueba para esta HU.</p>\n`;
            }
            html += `\n`;
        });

        // 5. Limitaciones
        html += `<h2>5. Limitaciones</h2>\n`;
        html += `<p>${this.testPlan.limitations || 'No especificadas'}</p>\n\n`;

        // 6. Supuestos
        html += `<h2>6. Supuestos</h2>\n`;
        html += `<p>${this.testPlan.assumptions || 'No especificados'}</p>\n\n`;

        // 7. Equipo de trabajo
        html += `<h2>7. Equipo de trabajo</h2>\n`;
        html += `<p>${this.testPlan.team || 'No especificado'}</p>\n\n`;

        this.previewHtmlContent = html;
    }

        private buildPlainTextFromPreviewHtml(): string {
                return this.previewHtmlContent
                        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (match, title) => `\n\n${title.toUpperCase()}\n\n`)
                        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (match, title) => `\n\n${title.toUpperCase()}\n\n`)
                        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (match, title) => `\n\n${title}\n\n`)
                        .replace(/<li[^>]*>(.*?)<\/li>/gi, ' • $1\n')
                        .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<[^>]+>/g, '')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/\n{3,}/g, '\n\n')
                        .trim();
        }

        private buildApaClipboardHtml(): string {
                const safeContent = this.previewHtmlContent || '';

                return `
<!doctype html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <style>
        body {
            font-family: "Times New Roman", Times, serif;
            font-size: 12pt;
            line-height: 2;
            margin: 1in;
            color: #000;
        }
        h1, h2, h3 {
            font-weight: bold;
            margin: 0 0 12pt 0;
            page-break-after: avoid;
        }
        h1 { font-size: 16pt; }
        h2 { font-size: 14pt; }
        h3 { font-size: 12pt; }
        p {
            margin: 0 0 12pt 0;
            text-align: left;
        }
        ul, ol {
            margin: 0 0 12pt 24pt;
            padding: 0;
        }
        li {
            margin: 0 0 6pt 0;
        }
    </style>
</head>
<body>
${safeContent}
</body>
</html>`;
        }

        async copyToClipboard(): Promise<void> {
        if (!this.previewHtmlContent) return;

                const textContent = this.buildPlainTextFromPreviewHtml();
                const htmlContent = this.buildApaClipboardHtml();

                try {
                        const ClipboardItemCtor = (window as any).ClipboardItem;

                        if (navigator.clipboard?.write && ClipboardItemCtor) {
                                const item = new ClipboardItemCtor({
                                        'text/html': new Blob([htmlContent], { type: 'text/html' }),
                                        'text/plain': new Blob([textContent], { type: 'text/plain' })
                                });

                                await navigator.clipboard.write([item]);
                this.triggerCopied();
                return;
                        }

                        await navigator.clipboard.writeText(textContent);
                        this.triggerCopied();
                } catch (err) {
            console.error('Error al copiar:', err);
            this.toastService.error('Error al copiar al portapapeles.');
                }
    }

    private triggerCopied(): void {
        this.copiedToClipboard = true;
        setTimeout(() => { this.copiedToClipboard = false; }, 2000);
    }

    toggleExportMenu(): void {
        this.exportMenuOpen = !this.exportMenuOpen;
    }

    closeExportMenu(): void {
        this.exportMenuOpen = false;
    }

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        const target = event.target as HTMLElement;
        if (!target.closest('.export-dropdown')) {
            this.exportMenuOpen = false;
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
            this.router.navigate(['/viewer'], {
                queryParams: { id: this.testPlanId }
            });
            return;
        }

        this.router.navigate(['/viewer']);
    }

    goToCurrentPage(): void {
        if (!this.testPlanId) return;

        this.router.navigate(['/preview', this.testPlanId]);
    }
}
