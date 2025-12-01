import { Injectable } from '@angular/core';
import { GeminiTextPart } from './gemini-client.service';

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
     * Limpia y parsea una respuesta JSON que puede contener markdown o estar truncada
     */
    public cleanAndParseJSON(rawText: string): any {
        let jsonText = rawText.trim();

        console.log('[cleanAndParseJSON] Texto crudo (primeros 500 chars):', jsonText.substring(0, 500));

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
        const jsonCandidate = jsonText.substring(startIndex);

        // 3. Intentar parsear usando la lógica de extracción original (por si hay texto al final)
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
                // Limpieza básica de saltos de línea en strings antes de parsear
                const cleanExtracted = extracted.replace(/\\n/g, '\\n');
                const parsed = JSON.parse(cleanExtracted);
                console.log('[cleanAndParseJSON] ✅ JSON extraído y parseado exitosamente');
                return parsed;
            } catch (e) {
                console.warn('[cleanAndParseJSON] ⚠️ Falló el parseo del bloque extraído, intentando con el texto completo/reparación...');
            }
        }

        // 4. Si falló la extracción limpia, intentar con el candidato completo y reparación
        let textToParse = jsonCandidate.replace(/\\n/g, '\\n');

        try {
            const parsed = JSON.parse(textToParse);
            console.log('[cleanAndParseJSON] ✅ JSON completo parseado exitosamente');
            return parsed;
        } catch (e: any) {
            console.warn('[cleanAndParseJSON] ⚠️ Error parseando JSON completo, intentando reparar...');
            console.warn('[cleanAndParseJSON] Error original:', e.message);

            // INTENTO DE REPARACIÓN: Detectar JSON truncado
            try {
                const repaired = this.repairTruncatedJSON(textToParse);
                const parsed = JSON.parse(repaired);
                console.log('[cleanAndParseJSON] ✅ JSON reparado y parseado exitosamente');
                return parsed;
            } catch (repairError: any) {
                console.error('[cleanAndParseJSON] ❌ No se pudo reparar el JSON');
                console.error('[cleanAndParseJSON] Error de reparación:', repairError.message);
                console.error('[cleanAndParseJSON] Texto (primeros 1000 chars):', textToParse.substring(0, 1000));
                throw new Error(`Error parseando JSON: ${e.message}. El JSON parece estar truncado o malformado.`);
            }
        }
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

        // Si termina en ':', significa que se cortó esperando un valor (pero no dentro de un string)
        if (finalRepaired.trim().endsWith(':')) {
            finalRepaired += ' null';
        }

        // Cerrar estructuras pendientes en orden inverso (LIFO)
        while (closingStack.length > 0) {
            finalRepaired += closingStack.pop();
        }

        console.log('[repairTruncatedJSON] JSON reparado (últimos 100 chars):', finalRepaired.substring(Math.max(0, finalRepaired.length - 100)));

        return finalRepaired;
    }
}
