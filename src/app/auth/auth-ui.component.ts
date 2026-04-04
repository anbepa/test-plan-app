import { CommonModule } from '@angular/common';
import { Component, DestroyRef, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AuthService } from '../services/auth/auth.service';

@Component({
  selector: 'app-auth-ui',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="auth-wrapper">
      <div class="auth-shell">
        <section class="auth-hero">
          <span class="eyebrow">Test Plan Manager</span>
          <h1>Generador de planes de prueba</h1>
          <p class="subtitle">Agiliza la generación de planes de prueba y el diseño de escenarios con IA, alineados con las buenas prácticas de ISTQB.</p>

          <div class="hero-points">
            <div class="hero-point">
              <span class="hero-point-icon">✦</span>
              <span>Crea y administra planes de prueba en un flujo simple y centralizado.</span>
            </div>
            <div class="hero-point">
              <span class="hero-point-icon">✦</span>
              <span>Define escenarios y casos de prueba con apoyo de IA para acelerar tu trabajo.</span>
            </div>
            <div class="hero-point">
              <span class="hero-point-icon">✦</span>
              <span>Mantén trazabilidad y consulta la información de tus planes en un solo lugar.</span>
            </div>
          </div>
        </section>

        <section class="auth-card">
          <div class="auth-card-header">
            <span class="auth-badge">Acceso seguro</span>
            <h2>Iniciar sesión</h2>
            <p class="auth-description">Usa tu correo corporativo o personal válido para acceder a tu espacio de trabajo.</p>
          </div>

          <form class="auth-form" (ngSubmit)="submit()">
            <label>
              Correo electrónico
              <input
                type="email"
                [(ngModel)]="email"
                name="email"
                placeholder="nombre@empresa.com"
                autocomplete="email"
                required />
            </label>

            <label>
              Contraseña
              <input
                type="password"
                [(ngModel)]="password"
                name="password"
                placeholder="********"
                minlength="8"
                autocomplete="current-password"
                required />
            </label>

            <button type="submit" class="primary-btn" [disabled]="loading">
              {{ loading ? 'Procesando...' : 'Entrar al espacio de trabajo' }}
            </button>
          </form>

          <p class="message error" *ngIf="errorMessage">{{ errorMessage }}</p>
          <p class="message success" *ngIf="successMessage">{{ successMessage }}</p>
        </section>
      </div>
    </section>
  `,
  styleUrls: ['./auth-ui.component.css']
})
export class AuthUiComponent {
  private readonly destroyRef = inject(DestroyRef);
  email = '';
  password = '';
  loading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private authService: AuthService,
    private router: Router,
    private route: ActivatedRoute
  ) {
    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (user) {
          void this.navigateAfterAuth();
        }
      });
  }

  async submit(): Promise<void> {
    const normalizedEmail = this.email.trim().toLowerCase();
    const emailValidationError = this.authService.validateEmail(normalizedEmail);

    if (emailValidationError) {
      this.errorMessage = emailValidationError;
      return;
    }

    if (this.password.trim().length < 8) {
      this.errorMessage = 'La contraseña debe tener al menos 8 caracteres.';
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    try {
      await this.authService.signInWithEmail(normalizedEmail, this.password);
      this.markMobileOnboardingPending();
      await this.navigateAfterAuth();
    } catch (error: any) {
      this.errorMessage = error?.message || 'No fue posible autenticarte.';
    } finally {
      this.loading = false;
    }
  }

  private async navigateAfterAuth(): Promise<void> {
    const redirectTo = this.route.snapshot.queryParamMap.get('redirectTo') || '/generator';
    const safeRedirect = redirectTo === '/auth' ? '/generator' : redirectTo;

    if (this.router.url !== safeRedirect) {
      await this.router.navigateByUrl(safeRedirect, { replaceUrl: true });
    }
  }

  private markMobileOnboardingPending(): void {
    if (typeof window === 'undefined') {
      return;
    }

    const isMobileViewport = window.innerWidth < 768;
    if (!isMobileViewport) {
      return;
    }

    window.sessionStorage.setItem('tp_mobile_onboarding_pending', '1');
  }
}
