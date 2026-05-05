import { Injectable } from '@angular/core';
import { HUData } from '../../models/hu-data.model';
import { DbTestPlan, DbUserStoryWithRelations } from './database.service';

/**
 * Servicio para transformar datos entre formatos de la aplicación y la base de datos
 */
@Injectable({
    providedIn: 'root'
})
export class TestPlanMapperService {

    /**
     * Convierte una lista de HUData a DbUserStoryWithRelations para guardar en BD
     */
    mapHUListToDbUserStories(
        huList: HUData[],
        testPlanId: string
    ): DbUserStoryWithRelations[] {
        return huList.map((hu, index) => ({
            id: hu.dbUuid || crypto.randomUUID(),
            custom_id: hu.id,
            title: hu.title || `Historia ${index + 1}`,
            sprint: hu.sprint || '',
            description: hu.originalInput.description || '',
            acceptance_criteria: hu.originalInput.acceptanceCriteria || '',
            generated_scope: hu.generatedScope || '',
            generated_test_case_titles: hu.generatedTestCaseTitles || '',
            refinement_technique: hu.refinementTechnique || undefined,
            refinement_context: hu.refinementContext || undefined,
            test_plan_id: testPlanId,
            position: index + 1,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),

            test_cases: (hu.detailedTestCases || []).map((tc, tcIndex) => ({
                id: tc.dbId || crypto.randomUUID(),
                user_story_id: '',
                title: tc.title || `Caso ${tcIndex + 1}`,
                preconditions: tc.preconditions || '',
                expected_results: tc.expectedResults || '',
                position: tcIndex + 1,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),

                test_case_steps: (tc.steps || []).map((step, stepIndex) => ({
                    id: step.dbId || crypto.randomUUID(),
                    test_case_id: '',
                    step_number: step.numero_paso || stepIndex + 1,
                    action: step.accion || '',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }))
            }))
        }));
    }

    /**
     * Crea un objeto DbTestPlan a partir de los datos del formulario
     */
    createDbTestPlan(
        title: string,
        cellName: string,
        repositoryLink: string,
        outOfScope: string,
        strategy: string,
        limitations: string,
        assumptions: string,
        team: string
    ): DbTestPlan {
        return {
            id: crypto.randomUUID(),
            title: title || 'Plan de Pruebas',
            repository_link: repositoryLink || '',
            cell_name: cellName,
            out_of_scope: outOfScope || '',
            strategy: strategy || '',
            limitations: limitations || '',
            assumptions: assumptions || '',
            team: team || '',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
    }

    /**
     * Genera el título del plan basado en la última HU
     */
    generateTestPlanTitle(huList: HUData[]): string {
        if (huList.length === 0) {
            return 'Plan de Pruebas (Aún sin entradas)';
        }

        const relevantHu = [...huList]
            .reverse()
            .find(hu => hu.originalInput.generationMode !== undefined)
            || huList[huList.length - 1];

        return `TEST PLAN EVC00057_ ${relevantHu.id} SPRINT ${relevantHu.sprint}`;
    }

    /**
     * Obtiene un resumen de las HUs para usar en prompts de IA
     */
    getHuSummaryForAI(huList: HUData[]): string {
        if (huList.length === 0) {
            return "No hay Historias de Usuario definidas aún.";
        }

        const summary = huList.map((hu, index) => {
            const description = (hu.originalInput.description || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 240);

            const acceptanceCriteria = (hu.originalInput.acceptanceCriteria || '')
                .split(/\n|\r|•|- /)
                .map(line => line.trim())
                .filter(Boolean)
                .slice(0, 6)
                .map((line, i) => `CA${i + 1}: ${line.slice(0, 150)}`)
                .join(' | ');

            let testCaseTitles = (hu.detailedTestCases || [])
                .map(tc => tc.title?.trim())
                .filter(Boolean)
                .slice(0, 8)
                .join(' | ');
                
            if (!testCaseTitles && hu.generatedTestCaseTitles) {
                testCaseTitles = hu.generatedTestCaseTitles
                    .split(/\r?\n|\|/)
                    .map(l => l.trim())
                    .filter(Boolean)
                    .slice(0, 8)
                    .join(' | ');
            }

            return [
                `HU ${index + 1}/${huList.length}: ${hu.id} | ${hu.title}`,
                `Sprint: ${hu.sprint || 'N/A'} | Técnica: ${hu.originalInput.selectedTechnique || hu.refinementTechnique || 'N/A'}`,
                `Descripción: ${description || 'N/A'}`,
                `Criterios: ${acceptanceCriteria || 'N/A'}`,
                `Escenarios (${hu.detailedTestCases?.length || 0}): ${testCaseTitles || 'Sin escenarios detallados'}`
            ].join('\n');
        }).join('\n\n');

        return summary.length > 6000
            ? summary.substring(0, 6000) + "\n... (contexto truncado para no exceder límites de prompt)"
            : summary;
    }

    /**
     * Convierte un DbTestPlanWithRelations a una lista de HUData
     */
    mapDbTestPlanToHUList(testPlan: any): HUData[] {
        if (!testPlan.user_stories) return [];

        return testPlan.user_stories.map((us: any) => ({
            dbUuid: us.id,
            id: us.custom_id || us.id,
            title: us.title,
            sprint: us.sprint,
            originalInput: {
                description: us.description,
                acceptanceCriteria: us.acceptance_criteria,
                generationMode: us.generation_mode || 'text',
                selectedTechnique: us.refinement_technique
            },
            generatedScope: us.generated_scope,
            generatedTestCaseTitles: us.generated_test_case_titles,
            refinementTechnique: us.refinement_technique,
            refinementContext: us.refinement_context,
            testCasesCount: (us.test_cases && us.test_cases[0] && us.test_cases[0].count !== undefined)
                ? us.test_cases[0].count
                : (us.test_cases ? us.test_cases.length : 0),
            detailedTestCases: (us.test_cases && us.test_cases[0] && us.test_cases[0].count !== undefined)
                ? []
                : (us.test_cases || []).map((tc: any) => ({
                dbId: tc.id,
                title: tc.title,
                preconditions: tc.preconditions,
                steps: (tc.test_case_steps || []).map((step: any) => ({
                    dbId: step.id,
                    numero_paso: step.step_number,
                    accion: step.action
                })),
                expectedResults: tc.expected_results
            })),
            isScopeDetailsOpen: false,
            isScenariosDetailsOpen: false,
            editingScope: false,
            editingTestCases: false,
            loadingScope: false,
            errorScope: null
        }));
    }
}
