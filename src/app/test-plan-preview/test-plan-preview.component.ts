import { Component, OnInit, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DatabaseService, DbTestPlanWithRelations } from '../services/database/database.service';
import { ToastService } from '../services/core/toast.service';
import { GeneralSectionsConfigService } from '../services/core/general-sections-config.service';
import { HUData } from '../models/hu-data.model';
import { TestPlanMapperService } from '../services/database/test-plan-mapper.service';
import { PlanExportModalComponent } from '../shared/components/plan-export-modal/plan-export-modal.component';

@Component({
    selector: 'app-test-plan-preview',
    standalone: true,
    imports: [CommonModule, PlanExportModalComponent],
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
    showExportModal: boolean = false;
    
    // Propiedades con fallback a configuración global
    repositoryLink: string = '';
    teamContent: string = '';

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private databaseService: DatabaseService,
        private mapper: TestPlanMapperService,
        private toastService: ToastService,
        private generalSectionsConfig: GeneralSectionsConfigService
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

                // Cargar configuración global con fallback
                const config = this.generalSectionsConfig.getConfig();

                // Preferir config global, caer a plan solo si config global está vacía
                this.repositoryLink = config.repositoryLink || plan.repository_link || '';
                this.teamContent = config.teamContent || plan.team || '';

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
        html += `<p><strong>Repositorio:</strong> ${this.repositoryLink || 'No especificado'}</p>\n\n`;

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
        html += this.buildTeamTableHtml(this.teamContent);

        this.previewHtmlContent = html;
    }

    /**
     * Convierte el contenido del equipo (una persona por línea con formato
     * "Rol – Empresa: Nombre") en una tabla de dos columnas (Rol | Nombre).
     * Si una línea no tiene el separador esperado, se muestra completa en la
     * columna de rol para no perder información.
     */
    private buildTeamTableHtml(content: string): string {
        const raw = (content || '').trim();
        if (!raw) {
            return `<p>No especificado</p>\n\n`;
        }

        const rows = raw
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                // Separar por el ÚLTIMO ": " para que "Rol – Empresa" quede completo a la izquierda.
                const idx = line.lastIndexOf(':');
                if (idx === -1) {
                    return { role: line, name: '' };
                }
                const role = line.slice(0, idx).trim();
                const name = line.slice(idx + 1).trim();
                return { role, name };
            });

        let table = `<table class="team-table" border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;">\n`;
        table += `<thead><tr><th style="border:1px solid #000;padding:6px 10px;text-align:left;">Rol</th><th style="border:1px solid #000;padding:6px 10px;text-align:left;">Nombre</th></tr></thead>\n`;
        table += `<tbody>\n`;
        for (const r of rows) {
            table += `<tr><td style="border:1px solid #000;padding:6px 10px;">${r.role}</td><td style="border:1px solid #000;padding:6px 10px;">${r.name}</td></tr>\n`;
        }
        table += `</tbody>\n</table>\n\n`;
        return table;
    }

        private buildPlainTextFromPreviewHtml(): string {
                return this.previewHtmlContent
                        .replace(/<h1[^>]*>(.*?)<\/h1>/gi, (match, title) => `\n\n${title.toUpperCase()}\n\n`)
                        .replace(/<h2[^>]*>(.*?)<\/h2>/gi, (match, title) => `\n\n${title.toUpperCase()}\n\n`)
                        .replace(/<h3[^>]*>(.*?)<\/h3>/gi, (match, title) => `\n\n${title}\n\n`)
                        .replace(/<li[^>]*>(.*?)<\/li>/gi, ' • $1\n')
                        // Tabla: cada celda separada por tab, cada fila con salto de línea.
                        .replace(/<\/tr>/gi, '\n')
                        .replace(/<t[hd][^>]*>(.*?)<\/t[hd]>/gi, '$1\t')
                        .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
                        .replace(/<br\s*\/?>/gi, '\n')
                        .replace(/<[^>]+>/g, '')
                        .replace(/&nbsp;/g, ' ')
                        .replace(/\t\n/g, '\n')
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
        table {
            border-collapse: collapse;
            width: 100%;
            margin: 0 0 12pt 0;
        }
        th, td {
            border: 1px solid #000;
            padding: 6pt 10pt;
            text-align: left;
            vertical-align: top;
        }
        th { font-weight: bold; background: #f0f0f0; }
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

    openExportModal(): void {
        this.showExportModal = true;
    }

    closeExportModal(): void {
        this.showExportModal = false;
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
