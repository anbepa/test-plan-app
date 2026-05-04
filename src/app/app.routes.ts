// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { guestGuard } from './guards/guest.guard';

export const routes: Routes = [
  {
    path: 'auth',
    loadComponent: () => import('./auth/auth-ui.component').then(m => m.AuthUiComponent),
    title: 'Autenticación',
    canActivate: [guestGuard]
  },
  {
    path: '',
    redirectTo: 'welcome',
    pathMatch: 'full'
  },
  {
    path: 'welcome',
    loadComponent: () => import('./welcome/welcome.component').then(m => m.WelcomeComponent),
    title: 'Bienvenido',
    canActivate: [authGuard]
  },
  {
    path: 'generator',
    loadComponent: () => import('./test-plan-generator/test-plan-generator.component').then(m => m.TestPlanGeneratorComponent),
    title: 'Generador de planes de prueba',
    canActivate: [authGuard]
  },
  {
    path: 'viewer',
    loadComponent: () => import('./test-plan-viewer/test-plan-viewer.component').then(m => m.TestPlanViewerComponent),
    title: 'Gestor de planes de prueba',
    canActivate: [authGuard]
  },
  {
    path: 'viewer/hu-scenarios',
    loadComponent: () => import('./test-plan-viewer/hu-scenarios-view/hu-scenarios-view.component').then(m => m.HuScenariosViewComponent),
    title: 'Escenarios de prueba por HU',
    canActivate: [authGuard]
  },
  {
    path: 'viewer/test-runs',
    loadComponent: () => import('./test-plan-viewer/test-runs/test-runs.component').then(m => m.TestRunsComponent),
    title: 'Test Runs',
    canActivate: [authGuard]
  },
  {
    path: 'manual-execution',
    loadComponent: () => import('./manual-execution/manual-execution.component').then(m => m.ManualExecutionComponent),
    title: 'Ejecución Manual',
    canActivate: [authGuard]
  },
  {
    path: 'viewer/execute-plan',
    loadComponent: () => import('./test-plan-viewer/components/plan-execution/plan-execution.component').then(m => m.PlanExecutionComponent),
    title: 'Ejecutar Plan de Pruebas',
    canActivate: [authGuard]
  },
  {
    path: 'viewer/general-sections/:id',
    loadComponent: () => import('./test-plan-viewer/general-sections-view/general-sections-view.component').then(m => m.GeneralSectionsViewComponent),
    title: 'Secciones Generales del Plan',
    canActivate: [authGuard]
  },
  {
    path: 'viewer/risk-strategy/:id',
    loadComponent: () => import('./test-plan-viewer/risk-strategy-view/risk-strategy-view.component').then(m => m.RiskStrategyViewComponent),
    title: 'Riesgos Para la Estrategia de Pruebas',
    canActivate: [authGuard]
  },
  {
    path: 'refiner',
    loadComponent: () => import('./test-case-refiner/test-case-refiner.component').then(m => m.TestCaseRefinerComponent),
    title: 'Editar / Refinar Casos de Prueba',
    canActivate: [authGuard]
  },
  {
    path: 'refiner/context',
    loadComponent: () => import('./test-case-refiner/test-case-refiner.component').then(m => m.TestCaseRefinerComponent),
    title: 'Regenerar Escenarios con Contexto',
    canActivate: [authGuard]
  },
  {
    path: 'preview/:id',
    loadComponent: () => import('./test-plan-preview/test-plan-preview.component').then(m => m.TestPlanPreviewComponent),
    title: 'Previsualizar Test Plan',
    canActivate: [authGuard]
  },
  {
    path: '**',
    redirectTo: 'generator'
  }
];
