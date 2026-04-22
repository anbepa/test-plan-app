import { Injectable } from '@angular/core';
import { GeminiTextPart } from './gemini-client.service';

export interface PartialParseResult {
    parsed: any;
    wasRepaired: boolean;
    completedTestCaseCount: number;
    possiblyTruncated: boolean;
}

@Injectable({
    providedIn: 'root'
})
export class GeminiParserService {

    constructor() { }

    /**
     * Extrae el texto de las partes de la respuesta de Gemini
     */
    public getTextFromParts(parts: GeminiTextPart[] | undefined): string {
        if (parts && parts.length > 0) {
            const firstPart = parts[0];
            if (firstPart && 'text' in firstPart) {
                return firstPart.text;
            }
        }
        return '';
    }

    /**
     * Limpia y parsea una respuesta JSON que puede contener markdown o estar truncada.
     * Si el JSON está truncado, intenta extraer los test cases completos que sí llegaron.
     */
    public cleanAndParseJSON(rawText: string): any {
        const result = this.cleanAndParseJSONWithMeta(rawText);
        return result.parsed;
    }

    /**
     * Versión extendida que devuelve metadatos sobre el parseo
     * (si fue reparado, cuántos test cases se rescataron, si posiblemente está truncado)
     */
    public cleanAndParseJSONWithMeta(rawText: string): PartialParseResult {
        let jsonText = rawText.trim();

        console.log('[cleanAndParseJSON] Texto crudo (primeros 500 chars):', jsonText.substring(0, 500));
        console.log('[cleanAndParseJSON] Longitud total del texto:', jsonText.length);

        // 1. Limpiar marcadores de código markdown
        if (jsonText.startsWith("```json")) { jsonText = jsonText.substring(7); }
        if (jsonText.startsWith("```")) { jsonText = jsonText.substring(3); }
        if (jsonText.endsWith("```")) { jsonText = jsonText.substring(0, jsonText.length - 3); }
        jsonText = jsonText.trim();

        // 2. Identificar el inicio del JSON
        const firstBrace = jsonText.indexOf('{');
        const firstBracket = jsonText.indexOf('[');

        let startIndex = -1;
        if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
            startIndex = firstBrace;
        } else if (firstBracket !== -1) {
            startIndex = firstBracket;
        }

        // Si no encontramos inicio de JSON, fallar
        if (startIndex === -1) {
            throw new Error('No se encontró un objeto o array JSON en la respuesta.');
        }

        // Texto candidato desde el inicio encontrado
        let jsonCandidate = jsonText.substring(startIndex);

        // 3. LIMPIEZA IMPORTANTE: Escapar saltos de línea REALES dentro del JSON
        // Pero SOLO dentro de strings (entre comillas)
        jsonCandidate = this.escapeNewlinesInStrings(jsonCandidate);

        // 4. Intentar parsear usando la lógica de extracción original (por si hay texto al final)
        const lastBrace = jsonCandidate.lastIndexOf('}');
        const lastBracket = jsonCandidate.lastIndexOf(']');
        let endIndex = -1;

        // Determinar el final probable
        if (startIndex === firstBrace) { // Es un objeto
            endIndex = lastBrace;
        } else { // Es un array
            endIndex = lastBracket;
        }

        // Intentar parsear el bloque extraído "limpiamente"
        if (endIndex !== -1 && endIndex > 0) {
            const extracted = jsonCandidate.substring(0, endIndex + 1);
            try {
                const parsed = JSON.parse(extracted);
                console.log('[cleanAndParseJSON] ✅ JSON extraído y parseado exitosamente');
                const tcCount = this.countTestCases(parsed);
                return {
                    parsed,
                    wasRepaired: false,
                    completedTestCaseCount: tcCount,
                    possiblyTruncated: false
                };
            } catch (e) {
                console.warn('[cleanAndParseJSON] ⚠️ Falló el parseo del bloque extraído, intentando con el texto completo/reparación...');
            }
        }

        // 5. Si falló la extracción limpia, intentar con el candidato completo y reparación
        let textToParse = jsonCandidate;

        try {
            const parsed = JSON.parse(textToParse);
            console.log('[cleanAndParseJSON] ✅ JSON completo parseado exitosamente');
            const tcCount = this.countTestCases(parsed);
            return {
                parsed,
                wasRepaired: false,
                completedTestCaseCount: tcCount,
                possiblyTruncated: false
            };
        } catch (e: any) {
            console.warn('[cleanAndParseJSON] ⚠️ Error parseando JSON completo, intentando reparar...');
            console.warn('[cleanAndParseJSON] Error original:', e.message);
            console.warn('[cleanAndParseJSON] Posición aproximada del error:', e.message.match(/position (\d+)/)?.[1] || 'desconocida');

            // ESTRATEGIA DE REPARACIÓN EN CASCADA:
            // 1. Primero intentar reparación estructural (cerrar brackets)
            // 2. Si falla, extraer solo los test cases completos del JSON parcial
            try {
                const repaired = this.repairTruncatedJSON(textToParse);
                const parsed = JSON.parse(repaired);
                console.log('[cleanAndParseJSON] ✅ JSON reparado y parseado exitosamente');
                const tcCount = this.countTestCases(parsed);
                return {
                    parsed,
                    wasRepaired: true,
                    completedTestCaseCount: tcCount,
                    possiblyTruncated: true
                };
            } catch (repairError: any) {
                console.warn('[cleanAndParseJSON] ⚠️ Reparación estándar falló, intentando extracción de test cases parciales...');

                // ESTRATEGIA DE ÚLTIMO RECURSO: Extraer test cases completos con regex
                try {
                    const extracted = this.extractCompletedTestCases(textToParse);
                    if (extracted && extracted.testCases && extracted.testCases.length > 0) {
                        console.log(`[cleanAndParseJSON] ✅ Extracción parcial exitosa: ${extracted.testCases.length} test cases rescatados`);
                        return {
                            parsed: extracted,
                            wasRepaired: true,
                            completedTestCaseCount: extracted.testCases.length,
                            possiblyTruncated: true
                        };
                    }
                } catch (extractError: any) {
                    console.error('[cleanAndParseJSON] ❌ Extracción parcial también falló:', extractError.message);
                }

                console.error('[cleanAndParseJSON] ❌ No se pudo reparar ni extraer datos del JSON');
                console.error('[cleanAndParseJSON] Texto (primeros 1000 chars):', textToParse.substring(0, 1000));
                console.error('[cleanAndParseJSON] Texto (últimos 500 chars):', textToParse.substring(Math.max(0, textToParse.length - 500)));
                console.error('[cleanAndParseJSON] Texto alrededor de la posición del error:', this.getTextContext(textToParse, e.message));
                throw new Error(`Error parseando JSON: ${e.message}. El JSON parece estar truncado o malformado.`);
            }
        }
    }

    /**
     * Extrae los test cases completos de un JSON truncado.
     * Busca objetos completos dentro del array "testCases" usando una máquina de estados.
     */
    public extractCompletedTestCases(truncatedJson: string): { scope?: string; testCases: any[] } {
        const completedTestCases: any[] = [];
        let scope: string | undefined;

        // Intentar extraer el scope primero
        const scopeMatch = truncatedJson.match(/"scope"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (scopeMatch) {
            scope = scopeMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
        }

        // Buscar el inicio del array testCases
        const testCasesStart = truncatedJson.indexOf('"testCases"');
        if (testCasesStart === -1) {
            throw new Error('No se encontró la propiedad "testCases" en el JSON');
        }

        // Encontrar el '[' que inicia el array
        const arrayStart = truncatedJson.indexOf('[', testCasesStart);
        if (arrayStart === -1) {
            throw new Error('No se encontró el inicio del array testCases');
        }

        // Extraer cada objeto completo del array usando conteo de llaves
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let objectStart = -1;

        for (let i = arrayStart + 1; i < truncatedJson.length; i++) {
            const char = truncatedJson[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                continue;
            }

            if (inString) continue;

            if (char === '{') {
                if (depth === 0) {
                    objectStart = i;
                }
                depth++;
            } else if (char === '}') {
                depth--;
                if (depth === 0 && objectStart !== -1) {
                    // Encontramos un objeto completo
                    const objectStr = truncatedJson.substring(objectStart, i + 1);
                    try {
                        // Escapar newlines dentro de strings antes de parsear
                        const cleanedObjectStr = this.escapeNewlinesInStrings(objectStr);
                        const testCase = JSON.parse(cleanedObjectStr);
                        // Validar que tenga la estructura mínima esperada
                        if (testCase.title && (testCase.steps || testCase.expectedResults)) {
                            completedTestCases.push(testCase);
                        }
                    } catch (parseErr) {
                        console.warn('[extractCompletedTestCases] ⚠️ Objeto encontrado pero no parseable, saltando:', parseErr);
                    }
                    objectStart = -1;
                }
            } else if (char === ']' && depth === 0) {
                // Fin del array testCases
                break;
            }
        }

        console.log(`[extractCompletedTestCases] Extraídos ${completedTestCases.length} test cases completos`);

        return {
            scope: scope || 'Alcance no disponible (respuesta truncada)',
            testCases: completedTestCases
        };
    }

    /**
     * Cuenta la cantidad de test cases en un objeto parseado
     */
    private countTestCases(parsed: any): number {
        if (!parsed) return 0;
        if (Array.isArray(parsed.testCases)) return parsed.testCases.length;
        if (Array.isArray(parsed)) return parsed.length;
        return 0;
    }

    /**
     * Escapa saltos de línea reales SOLO dentro de strings JSON
     */
    private escapeNewlinesInStrings(jsonText: string): string {
        let result = '';
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < jsonText.length; i++) {
            const char = jsonText[i];
            const nextChar = i + 1 < jsonText.length ? jsonText[i + 1] : '';

            if (escapeNext) {
                result += char;
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                result += char;
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                result += char;
                continue;
            }

            // Si estamos dentro de un string y encontramos un salto de línea real, escaparlo
            if (inString && (char === '\n' || char === '\r')) {
                if (char === '\r' && nextChar === '\n') {
                    result += '\\n';
                    i++; // Saltar el \n siguiente
                } else if (char === '\n' || char === '\r') {
                    result += '\\n';
                }
                continue;
            }

            result += char;
        }

        return result;
    }

    /**
     * Obtiene contexto alrededor de la posición del error
     */
    private getTextContext(text: string, errorMessage: string): string {
        const match = errorMessage.match(/position (\d+)/);
        if (!match) return '';
        const pos = parseInt(match[1]);
        const start = Math.max(0, pos - 50);
        const end = Math.min(text.length, pos + 50);
        return `...${text.substring(start, end)}...`;
    }

    /**
     * Intenta reparar JSON truncado cerrando objetos y arrays incompletos
     */
    private repairTruncatedJSON(jsonText: string): string {
        // Asumimos que jsonText ya viene trimmeado desde cleanAndParseJSON,
        // pero lo aseguramos para evitar problemas de índices si no lo estuviera.
        const repaired = jsonText;

        // Pila para rastrear los cierres esperados ('}' o ']')
        const closingStack: string[] = [];
        let inString = false;
        let escapeNext = false;
        let lastCompletePosition = -1;

        for (let i = 0; i < repaired.length; i++) {
            const char = repaired[i];

            if (escapeNext) {
                escapeNext = false;
                continue;
            }

            if (char === '\\') {
                escapeNext = true;
                continue;
            }

            if (char === '"') {
                inString = !inString;
                // Si acabamos de cerrar un string, marcar esta posición como "completa"
                if (!inString) {
                    lastCompletePosition = i;
                }
                continue;
            }

            if (!inString) {
                if (char === '{') {
                    closingStack.push('}');
                    lastCompletePosition = i;
                }
                if (char === '}') {
                    closingStack.pop(); // Asumimos JSON bien formado hasta el corte
                    lastCompletePosition = i;
                }
                if (char === '[') {
                    closingStack.push(']');
                    lastCompletePosition = i;
                }
                if (char === ']') {
                    closingStack.pop();
                    lastCompletePosition = i;
                }
                // Comas y dos puntos son puntos de corte válidos (fuera de strings)
                if (char === ',' || char === ':') lastCompletePosition = i;
            }
        }

        console.log('[repairTruncatedJSON] Stack de cierre pendiente:', closingStack);
        console.log('[repairTruncatedJSON] String abierto:', inString);

        // Si estamos dentro de un string truncado, cortar hasta la última posición completa
        if (inString) {
            console.log('[repairTruncatedJSON] String truncado detectado, cortando hasta última posición válida:', lastCompletePosition);

            if (lastCompletePosition === -1) {
                return "";
            }

            let newRepaired = repaired.substring(0, lastCompletePosition + 1);

            // Lookahead: Verificar si lo que acabamos de "salvar" era una clave.
            let nextCharIndex = lastCompletePosition + 1;
            while (nextCharIndex < repaired.length && /\s/.test(repaired[nextCharIndex])) {
                nextCharIndex++;
            }

            if (nextCharIndex < repaired.length && repaired[nextCharIndex] === ':') {
                newRepaired += ': null';
            }

            if (newRepaired.trim().endsWith(':')) {
                newRepaired += ' null';
            }

            // Recalcular recursivamente
            return this.repairTruncatedJSON(newRepaired);
        }

        let finalRepaired = repaired;

        // Eliminar comas finales si existen (trailing commas)
        finalRepaired = finalRepaired.replace(/,\s*$/, '');

        // Eliminar el último elemento incompleto del array si estamos dentro de testCases
        // Esto es clave: si el JSON se cortó a mitad de un test case, necesitamos
        // remover ese test case incompleto antes de cerrar el array
        if (closingStack.length >= 2) {
            // Buscar hacia atrás el último objeto completo de testCases
            const lastCompleteObject = this.findLastCompleteObjectEnd(finalRepaired);
            if (lastCompleteObject > 0) {
                finalRepaired = finalRepaired.substring(0, lastCompleteObject + 1);
                // Limpiar trailing comma
                finalRepaired = finalRepaired.replace(/,\s*$/, '');
            }
        }

        // Si termina en ':', significa que se cortó esperando un valor (pero no dentro de un string)
        if (finalRepaired.trim().endsWith(':')) {
            finalRepaired += ' null';
        }

        // Cerrar estructuras pendientes en orden inverso (LIFO)
        // Recalcular la pila con el texto reparado
        const newStack = this.calculateClosingStack(finalRepaired);
        while (newStack.length > 0) {
            finalRepaired += newStack.pop();
        }

        console.log('[repairTruncatedJSON] JSON reparado (últimos 100 chars):', finalRepaired.substring(Math.max(0, finalRepaired.length - 100)));

        return finalRepaired;
    }

    /**
     * Busca la posición del cierre '}' del último objeto completo en el texto,
     * a nivel de profundidad 2+ (dentro de un array dentro de un objeto).
     */
    private findLastCompleteObjectEnd(text: string): number {
        let depth = 0;
        let inString = false;
        let escapeNext = false;
        let lastObjectClose = -1;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];

            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (inString) continue;

            if (char === '{') depth++;
            if (char === '}') {
                depth--;
                if (depth >= 1) { // Objeto dentro del root
                    lastObjectClose = i;
                }
            }
        }

        return lastObjectClose;
    }

    /**
     * Calcula la pila de cierres pendientes para un texto JSON
     */
    private calculateClosingStack(text: string): string[] {
        const stack: string[] = [];
        let inString = false;
        let escapeNext = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (escapeNext) { escapeNext = false; continue; }
            if (char === '\\') { escapeNext = true; continue; }
            if (char === '"') { inString = !inString; continue; }
            if (inString) continue;

            if (char === '{') stack.push('}');
            if (char === '[') stack.push(']');
            if (char === '}' || char === ']') stack.pop();
        }

        return stack;
    }
}
