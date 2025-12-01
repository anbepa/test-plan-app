import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { DatabaseService, DbTestPlanWithRelations } from '../services/database/database.service';
import { ToastService } from '../services/core/toast.service';
import { HUData } from '../models/hu-data.model';
import { WordExporterComponent } from '../word-exporter/word-exporter.component';

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

    constructor(
        private route: ActivatedRoute,
        private router: Router,
        private databaseService: DatabaseService,
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
                // Convertir UserStories a HUData
                this.huList = (plan.user_stories || []).map((us: any, index: number) => {
                    let originalInput: HUData['originalInput'] = {
                        generationMode: 'text',
                        description: '',
                        acceptanceCriteria: '',
                        selectedTechnique: ''
                    };
                    try {
                        originalInput = {
                            generationMode: (us.generation_mode as any) || 'text',
                            description: us.description || '',
                            acceptanceCriteria: us.acceptance_criteria || '',
                            selectedTechnique: us.refinement_technique || ''
                        };
                    } catch (e) {
                        console.error('Error parsing user story data', e);
                    }

                    let detailedTestCases = [];
                    try {
                        detailedTestCases = (us.test_cases || []).map((tc: any) => ({
                            title: tc.title || '',
                            preconditions: tc.preconditions || '',
                            steps: (tc.test_case_steps || []).map((step: any, idx: number) => ({
                                numero_paso: idx + 1,
                                accion: step.action || ''
                            })),
                            expectedResults: tc.expected_results || '',
                            isExpanded: false
                        }));
                    } catch (e) {
                        console.error('Error parsing test_cases', e);
                    }

                    // Usar el custom_id si existe, sino generar uno temporal
                    const customId = us.custom_id || `HU_${index + 1}_${plan.title.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`;

                    return {
                        id: customId,
                        title: us.title || '',
                        sprint: us.sprint || '',
                        originalInput: originalInput,
                        generatedScope: us.generated_scope || '',
                        detailedTestCases: detailedTestCases,
                        refinementTechnique: us.refinement_technique || '',
                        refinementContext: us.refinement_context || ''
                    } as HUData;
                });

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

    copyToClipboard(): void {
        if (!this.previewHtmlContent) return;

        let textContent = this.previewHtmlContent
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

        navigator.clipboard.writeText(textContent).then(() => {
            this.toastService.success('Texto copiado al portapapeles.');
        }).catch(err => {
            console.error('Error al copiar:', err);
            this.toastService.error('Error al copiar al portapapeles.');
        });
    }

    goBack(): void {
        // Navegar de vuelta al viewer, manteniendo el plan seleccionado
        if (this.testPlanId) {
            this.router.navigate(['/viewer'], {
                queryParams: { id: this.testPlanId }
            });
        } else {
            this.router.navigate(['/viewer']);
        }
    }
}
