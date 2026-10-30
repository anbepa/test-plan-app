import { HttpErrorResponse } from '@angular/common/http';
import { defer, firstValueFrom, throwError, of } from 'rxjs';
import { fakeAsync, tick, flushMicrotasks } from '@angular/core/testing';
import { isTransientError, retryTransient } from './transient-retry';

describe('transient-retry', () => {
  it('reconoce cortes de red y errores de servidor como transitorios', () => {
    expect(isTransientError(new HttpErrorResponse({ status: 0, error: new TypeError('Failed to fetch') }))).toBeTrue();
    expect(isTransientError(new HttpErrorResponse({ status: 502 }))).toBeTrue();
    expect(isTransientError(new HttpErrorResponse({ status: 429 }))).toBeTrue();
    expect(isTransientError(new TypeError('Failed to fetch'))).toBeTrue();
    expect(isTransientError(new HttpErrorResponse({ status: 400 }))).toBeFalse();
    expect(isTransientError(new HttpErrorResponse({ status: 401 }))).toBeFalse();
  });

  it('reintenta un "Failed to fetch" y entrega la respuesta sin perder el flujo', fakeAsync(() => {
    let calls = 0;
    let result: string | undefined;
    defer(() => ++calls < 3 ? throwError(() => new HttpErrorResponse({ status: 0 })) : of('ok'))
      .pipe(retryTransient())
      .subscribe((value) => result = value);
    tick(1500 + 4000);
    flushMicrotasks();
    expect(calls).toBe(3);
    expect(result).toBe('ok');
  }));

  it('no reintenta errores que no son transitorios', async () => {
    let calls = 0;
    const source = defer(() => { calls++; return throwError(() => new HttpErrorResponse({ status: 400 })); }).pipe(retryTransient());
    await expectAsync(firstValueFrom(source)).toBeRejected();
    expect(calls).toBe(1);
  });
});
