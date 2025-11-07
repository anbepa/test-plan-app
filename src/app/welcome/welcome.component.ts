import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="welcome-container">
      <div class="welcome-content">
        <div class="welcome-icon">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <h1 class="welcome-title">Generador de Test Plans</h1>
        <p class="welcome-description">
          Agiliza la generación de planes de prueba y el diseño de escenarios con IA, alineados con las buenas prácticas de ISTQB.
        </p>
        <div class="welcome-actions">
          <button class="btn-primary" routerLink="/generator">
            <span>Empezar ahora</span>
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  `,
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent {}
