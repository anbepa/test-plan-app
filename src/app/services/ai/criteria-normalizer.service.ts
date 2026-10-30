import { Injectable } from '@angular/core';
import { CodeExplorerAgentService } from './code-explorer-agent.service';
import {
  CRITERIA_NORMALIZATION_SYSTEM,
  CRITERIA_NORMALIZATION_USER,
  formatNormalizedCriteria,
  isNormalizedCriteria,
  parseNormalizedCriteria,
} from './criteria-normalizer';

/**
 * Convierte los criterios del funcional en una lista numerada de criterios
 * verificables (CA-xx). Mismo texto → misma lista: se memoriza por sesión.
 */
@Injectable({
  providedIn: 'root'
})
export class CriteriaNormalizerService {
  private readonly cache = new Map<string, Promise<string>>();

  constructor(private llm: CodeExplorerAgentService) {}

  /** Lista normalizada, o '' si no se pudo interpretar (se usan los criterios originales). */
  normalize(description: string, acceptanceCriteria: string): Promise<string> {
    const criteria = (acceptanceCriteria || '').trim();
    if (!criteria) return Promise.resolve('');
    if (isNormalizedCriteria(criteria)) return Promise.resolve(criteria);

    const key = `${description}\u0000${criteria}`;
    if (!this.cache.has(key)) {
      const request = this.llm.complete([
        { role: 'system', content: CRITERIA_NORMALIZATION_SYSTEM },
        { role: 'user', content: CRITERIA_NORMALIZATION_USER(description, criteria) },
      ]).then((raw) => formatNormalizedCriteria(parseNormalizedCriteria(raw)));
      request.catch(() => this.cache.delete(key));
      this.cache.set(key, request);
    }
    return this.cache.get(key)!;
  }
}
