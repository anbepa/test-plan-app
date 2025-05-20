import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TestPlanGeneratorComponent } from './test-plan-generator/test-plan-generator.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    TestPlanGeneratorComponent // Importa tu componente generador
  ],
  template: `
    <app-test-plan-generator></app-test-plan-generator>
  `,
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'test-plan-app';
}