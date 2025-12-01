import { Injectable } from '@angular/core';
import { SupabaseClientService } from './supabase-client.service';
import { DbUserStoryWithRelations, DbTestCase } from '../../models/database.model';
import { DetailedTestCase } from '../../models/hu-data.model';

@Injectable({
    providedIn: 'root'
})
export class DatabaseHelperService {
    private static readonly INSERT_CHUNK_SIZE = 200;

    constructor(private supabaseClient: SupabaseClientService) { }

    /**
     * Inserta filas en lotes para evitar límites de tamaño de request
     */
    async chunkedInsert<T extends Record<string, any>>(
        table: 'user_stories' | 'test_cases' | 'test_case_steps',
        rows: T[],
        selectColumns?: string
    ): Promise<any[]> {
        if (!rows.length) {
            return [];
        }

        const chunkSize = DatabaseHelperService.INSERT_CHUNK_SIZE;
        const accumulated: any[] = [];

        for (let start = 0; start < rows.length; start += chunkSize) {
            const chunk = rows.slice(start, start + chunkSize);
            let query = this.supabaseClient.supabase
                .from(table)
                .insert(chunk);

            if (selectColumns) {
                const { data, error } = await query.select(selectColumns);

                if (error) {
                    console.error(`❌ Error al insertar lote en ${table}:`, error);
                    throw new Error(`Error en ${table}: ${error.message || error.hint || JSON.stringify(error)}`);
                }

                accumulated.push(...(data || []));
            } else {
                const { error } = await query;

                if (error) {
                    console.error(`❌ Error al insertar lote en ${table}:`, error);
                    throw new Error(`Error en ${table}: ${error.message || error.hint || JSON.stringify(error)}`);
                }
            }
        }

        return accumulated;
    }

    hasUserStoryChanged(existing: DbUserStoryWithRelations, incoming: DbUserStoryWithRelations): boolean {
        const simplify = (hu: DbUserStoryWithRelations) => ({
            title: hu.title,
            sprint: hu.sprint,
            desc: hu.description,
            ac: hu.acceptance_criteria,
            scope: hu.generated_scope,
            tech: hu.refinement_technique,
            ctx: hu.refinement_context,
            tcs: (hu.test_cases || []).map(tc => ({
                title: tc.title,
                pre: tc.preconditions,
                exp: tc.expected_results,
                steps: (tc.test_case_steps || []).map(s => s.action)
            }))
        });

        return JSON.stringify(simplify(existing)) !== JSON.stringify(simplify(incoming));
    }

    hasTestCaseChanged(existing: any, incoming: DetailedTestCase): boolean {
        // Simplificar para comparar
        const simplifyExisting = {
            t: existing.title,
            p: existing.preconditions || '',
            e: existing.expected_results || '',
            pos: existing.position,
            s: (existing.test_case_steps || []).sort((a: any, b: any) => a.step_number - b.step_number).map((s: any) => s.action)
        };

        const simplifyIncoming = {
            t: incoming.title,
            p: incoming.preconditions || '',
            e: incoming.expectedResults || '',
            pos: incoming.position,
            s: (incoming.steps || []).map(s => s.accion)
        };

        return JSON.stringify(simplifyExisting) !== JSON.stringify(simplifyIncoming);
    }

    makeUserStoryKey(position: number | null | undefined, customId?: string | null): string {
        return `${position ?? -1}::${customId ?? ''}`;
    }

    makeTestCaseKey(userStoryId: string, position: number | null | undefined): string {
        return `${userStoryId}::${position ?? -1}`;
    }
}
