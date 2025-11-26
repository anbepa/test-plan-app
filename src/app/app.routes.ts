// src/app/app.routes.ts
import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./welcome/welcome.component').then(m => m.WelcomeComponent),
    pathMatch: 'full'
  },
  {
    path: 'generator',
    loadComponent: () => import('./test-plan-generator/test-plan-generator.component').then(m => m.TestPlanGeneratorComponent),
    title: 'Generador de Test Plans'
  },
  {
    path: 'viewer',
    loadComponent: () => import('./test-plan-viewer/test-plan-viewer.component').then(m => m.TestPlanViewerComponent),
    title: 'Gestor de Test Plans'
  },
  {
    path: 'refiner',
    loadComponent: () => import('./test-case-refiner/test-case-refiner.component').then(m => m.TestCaseRefinerComponent),
    title: 'Editar / Refinar Casos de Prueba'
  },
  {
    path: 'preview/:id',
    loadComponent: () => import('./test-plan-preview/test-plan-preview.component').then(m => m.TestPlanPreviewComponent),
    title: 'Previsualizar Test Plan'
  },
  {
    path: '**',
    loadComponent: () => import('./welcome/welcome.component').then(m => m.WelcomeComponent)
  }
];
