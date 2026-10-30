import { MonoTypeOperatorFunction, retry, throwError, timer } from 'rxjs';

/** Esperas entre reintentos: un corte breve de red o un 502 suelen resolverse en segundos. */
export const TRANSIENT_RETRY_DELAYS_MS = [1500, 4000, 8000];

/**
 * Fallos que vale la pena reintentar: sin respuesta ("Failed to fetch", status 0),
 * timeouts, límite de tasa y errores del servidor o del gateway.
 */
export function isTransientError(error: any): boolean {
  const status = Number(error?.status ?? -1);
  if (status === 0 || status === 408 || status === 429 || status >= 500) return true;
  const message = String(error?.message || error?.error?.message || error || '');
  return status === -1 && /failed to fetch|network ?error|load failed|fetch failed|ECONNRESET|socket hang up/i.test(message);
}

export function retryTransient<T>(): MonoTypeOperatorFunction<T> {
  return retry({
    count: TRANSIENT_RETRY_DELAYS_MS.length,
    delay: (error, attempt) => isTransientError(error) ? timer(TRANSIENT_RETRY_DELAYS_MS[attempt - 1]) : throwError(() => error),
  });
}
