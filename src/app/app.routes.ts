// src/app/app.routes.ts
import { Routes } from '@angular/router';
import { TestPlanGeneratorComponent } from './test-plan-generator/test-plan-generator.component';
import { TestPlanViewerComponent } from './test-plan-viewer/test-plan-viewer.component';
import { WelcomeComponent } from './welcome/welcome.component';

export const routes: Routes = [
  {
    path: '',
    component: WelcomeComponent,
    pathMatch: 'full'
  },
  {
    path: 'generator',
    component: TestPlanGeneratorComponent,
    title: 'Generador de Test Plans'
  },
  {
    path: 'viewer',
    component: TestPlanViewerComponent,
    title: 'Gestor de Test Plans'
  },
  {
    path: '**',
    component: WelcomeComponent
  }
];
