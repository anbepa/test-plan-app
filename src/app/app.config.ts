import { ApplicationConfig } from '@angular/core';
// Importa 'withFetch' junto con provideHttpClient y withInterceptorsFromDi
import { provideHttpClient, withInterceptorsFromDi, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    // Configura provideHttpClient para usar withInterceptorsFromDi y AHORA también withFetch()
    provideHttpClient(withInterceptorsFromDi(), withFetch()),
    // Configura el enrutador
    provideRouter(routes)
    // provideHttpClient() puede recibir varias opciones, withInterceptorsFromDi() y withFetch() son dos de ellas
  ]
};
