import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-welcome',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="welcome-container">

      <!-- Background watermark SVG -->
      <div class="wm-bg" aria-hidden="true">
        <svg viewBox="0 0 800 600" fill="none" xmlns="http://www.w3.org/2000/svg" class="wm-svg">
          <!-- Document stack -->
          <rect x="160" y="120" width="160" height="200" rx="12" stroke="#2563eb" stroke-width="2" opacity="0.07"/>
          <rect x="175" y="105" width="160" height="200" rx="12" stroke="#2563eb" stroke-width="2" opacity="0.05"/>
          <rect x="190" y="90" width="160" height="200" rx="12" stroke="#2563eb" stroke-width="2" opacity="0.04"/>
          <line x1="210" y1="140" x2="330" y2="140" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity="0.08"/>
          <line x1="210" y1="160" x2="330" y2="160" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity="0.08"/>
          <line x1="210" y1="180" x2="290" y2="180" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity="0.08"/>
          <line x1="210" y1="200" x2="310" y2="200" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity="0.08"/>
          <line x1="210" y1="220" x2="270" y2="220" stroke="#2563eb" stroke-width="2" stroke-linecap="round" opacity="0.08"/>
          <!-- Checkmark circle right -->
          <circle cx="580" cy="200" r="80" stroke="#22c55e" stroke-width="2" opacity="0.06"/>
          <circle cx="580" cy="200" r="56" stroke="#22c55e" stroke-width="2" opacity="0.05"/>
          <path d="M548 200l22 22 40-40" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.1"/>
          <!-- Bottom nodes / flow -->
          <circle cx="200" cy="450" r="18" stroke="#6366f1" stroke-width="2" opacity="0.07"/>
          <circle cx="300" cy="420" r="12" stroke="#6366f1" stroke-width="2" opacity="0.06"/>
          <circle cx="390" cy="460" r="22" stroke="#6366f1" stroke-width="2" opacity="0.07"/>
          <circle cx="500" cy="430" r="14" stroke="#6366f1" stroke-width="2" opacity="0.06"/>
          <circle cx="600" cy="455" r="18" stroke="#6366f1" stroke-width="2" opacity="0.07"/>
          <line x1="218" y1="450" x2="288" y2="425" stroke="#6366f1" stroke-width="1.5" opacity="0.06"/>
          <line x1="312" y1="422" x2="368" y2="455" stroke="#6366f1" stroke-width="1.5" opacity="0.06"/>
          <line x1="412" y1="458" x2="486" y2="433" stroke="#6366f1" stroke-width="1.5" opacity="0.06"/>
          <line x1="514" y1="432" x2="582" y2="450" stroke="#6366f1" stroke-width="1.5" opacity="0.06"/>
          <!-- Magnifier top right -->
          <circle cx="660" cy="380" r="30" stroke="#f59e0b" stroke-width="2" opacity="0.08"/>
          <line x1="682" y1="402" x2="700" y2="420" stroke="#f59e0b" stroke-width="3" stroke-linecap="round" opacity="0.08"/>
          <!-- Dots pattern -->
          <circle cx="120" cy="300" r="3" fill="#2563eb" opacity="0.06"/>
          <circle cx="140" cy="320" r="3" fill="#2563eb" opacity="0.05"/>
          <circle cx="680" cy="100" r="3" fill="#6366f1" opacity="0.06"/>
          <circle cx="700" cy="120" r="3" fill="#6366f1" opacity="0.05"/>
          <circle cx="720" cy="140" r="3" fill="#6366f1" opacity="0.04"/>
        </svg>
      </div>

      <!-- Content -->
      <div class="welcome-hero">
        <h1 class="welcome-title">Bienvenido</h1>
        <p class="welcome-description">
          Genera, organiza y ejecuta planes de prueba con IA.
        </p>
        <div class="welcome-actions">
          <button class="btn-secondary" routerLink="/viewer">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            Ver planes
          </button>
          <button class="btn-primary" routerLink="/generator">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Crear plan
          </button>
        </div>
      </div>

    </div>
  `,
  styleUrls: ['./welcome.component.css']
})
export class WelcomeComponent {}
