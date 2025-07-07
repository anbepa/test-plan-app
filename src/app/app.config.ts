import { ApplicationConfig } from '@angular/core';
// Importa 'withFetch' junto con provideHttpClient y withInterceptorsFromDi
import { provideHttpClient, withInterceptorsFromDi, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { TestPlanGeneratorComponent } from './test-plan-generator/test-plan-generator.component';
import { TestMatrixExecutionComponent } from './test-matrix-execution/test-matrix-execution.component';

export const appConfig: ApplicationConfig = {
  providers: [
    // Configura provideHttpClient para usar withInterceptorsFromDi y AHORA también withFetch()
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    provideRouter([
      { path: '', component: TestPlanGeneratorComponent },
      { path: 'ejecutar-matriz', component: TestMatrixExecutionComponent },
    ])
    // provideHttpClient() puede recibir varias opciones, withInterceptorsFromDi() y withFetch() son dos de ellas
  ]
};