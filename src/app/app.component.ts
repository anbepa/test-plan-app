import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { map } from 'rxjs';
import { User } from '@supabase/supabase-js';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DestroyRef, inject } from '@angular/core';
import { ToastComponent } from './toast/toast.component';
import { AuthUiComponent } from './auth/auth-ui.component';
import { AuthService } from './services/auth/auth.service';

interface MenuItem {
  icon: string;
  label: string;
  route?: string;
  subItems?: MenuItem[];
  expanded?: boolean;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    ToastComponent,
    AuthUiComponent
  ],
  template: `
    <ng-container *ngIf="authService.loading$ | async; else authStateLoaded">
      <div class="auth-loading">Cargando sesión...</div>
    </ng-container>

    <ng-template #authStateLoaded>
      <ng-container *ngIf="isAuthenticated$ | async; else authScreen">
        <div class="app-container">
          <app-toast></app-toast>

          <div class="sidebar-overlay" *ngIf="sidebarOpen && isMobile" (click)="closeSidebar()"></div>

          <aside
            class="sidebar"
            [class.collapsed]="!isSidebarExpandedView"
            [class.open]="sidebarOpen"
            [class.temporary-expanded]="temporaryExpanded && !sidebarExpanded && !isMobile"
            (mouseenter)="onSidebarHover()"
            (mouseleave)="onSidebarLeave()">

            <nav class="sidebar-nav">
              <div class="logo-section">
                <a class="app-logo" *ngIf="isSidebarExpandedView" (click)="showOnboarding()" style="cursor:pointer">
                  <span class="logo-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M6.28 5.22a.75.75 0 010 1.06L2.56 10l3.72 3.72a.75.75 0 01-1.06 1.06L.97 10.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 010-1.06zM11.377 2.011a.75.75 0 01.612.867l-2.5 14.5a.75.75 0 01-1.478-.255l2.5-14.5a.75.75 0 01.866-.612z" clip-rule="evenodd" />
                    </svg>
                  </span>
                  <span class="logo-title">Test Plan Manager</span>
                </a>

                <a class="logo-compact" *ngIf="!isSidebarExpandedView" (click)="showOnboarding()" style="cursor:pointer">
                  <span class="logo-compact-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                      <rect x="4" y="4" width="16" height="16" rx="2" stroke-width="2"/>
                      <path d="M8 8h8M8 12h8M8 16h5" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                  </span>
                </a>
              </div>

              <div class="menu-header">
                <button
                  type="button"
                  class="menu-toggle-btn"
                  (click)="toggleSidebar()"
                  [attr.aria-label]="sidebarExpanded ? 'Contraer menú' : 'Expandir menú'"
                  [attr.title]="getCollapsedOnlyTitle(sidebarExpanded ? 'Contraer menú' : 'Expandir menú')">
                  <span class="menu-toggle-icon">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                    </svg>
                  </span>
                  <span class="menu-toggle-label">{{ sidebarExpanded ? 'Contraer menú' : 'Expandir menú' }}</span>
                  <span class="menu-toggle-arrow">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
                    </svg>
                  </span>
                </button>
              </div>

              <ul class="menu-list">
                <li *ngFor="let item of menuItems; let i = index" class="menu-item">
                  <a
                    *ngIf="!item.subItems"
                    [routerLink]="item.route"
                    routerLinkActive="active"
                    class="menu-link"
                    (click)="onMenuItemClick()"
                    [attr.title]="getCollapsedOnlyTitle(item.label)">

                    <span class="menu-icon">
                      <svg *ngIf="i === 0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                      <svg *ngIf="i === 1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </span>
                    <span class="menu-label">{{ item.label }}</span>
                  </a>

                  <div *ngIf="item.subItems" class="menu-group">
                    <button
                      class="menu-link menu-parent"
                      (click)="toggleSubmenu(item)"
                      [attr.title]="getCollapsedOnlyTitle(item.label)">

                      <span class="menu-icon" [innerHTML]="item.icon"></span>
                      <span class="menu-label">{{ item.label }}</span>
                      <svg
                        class="submenu-arrow"
                        [class.expanded]="item.expanded"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    <ul class="submenu" *ngIf="item.expanded">
                      <li *ngFor="let subItem of item.subItems" class="submenu-item">
                        <a
                          [routerLink]="subItem.route"
                          routerLinkActive="active"
                          class="submenu-link"
                          (click)="onMenuItemClick()">
                          <span class="submenu-icon" [innerHTML]="subItem.icon"></span>
                          <span class="submenu-label">{{ subItem.label }}</span>
                        </a>
                      </li>
                    </ul>
                  </div>
                </li>
              </ul>
            </nav>

            <div class="sidebar-user" *ngIf="authService.user$ | async as user">
              <img *ngIf="getAvatarUrl(user)" [src]="getAvatarUrl(user)" alt="Avatar" class="user-avatar" />
              <div class="user-meta">
                <div class="user-name">{{ getDisplayName(user) }}</div>
                <div class="user-email">{{ user.email }}</div>
              </div>
              <button class="logout-btn" (click)="logout()" [attr.title]="getCollapsedOnlyTitle('Cerrar sesión')">
                <span class="logout-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H9m4 8H7a2 2 0 01-2-2V6a2 2 0 012-2h6" />
                  </svg>
                </span>
                <span class="logout-label">Cerrar sesión</span>
              </button>
            </div>
          </aside>

          <header class="header">
            <button class="menu-toggle" (click)="toggleSidebarMobile()" aria-label="Toggle menu">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span class="header-title">Test Plan Manager</span>
          </header>

          <main class="main-content" [class.sidebar-expanded]="isSidebarExpandedView && !isMobile" [class.sidebar-collapsed]="!isSidebarExpandedView && !isMobile">
            <section class="onboarding-first" *ngIf="showOnboardingTip; else appContent">
              <button class="onboarding-skip" (click)="dismissOnboardingTip()">Omitir</button>
              <div class="onboarding-first-card">
                <div class="onboarding-icon" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <h2>Bienvenido</h2>
                <p>¿Qué deseas hacer primero?</p>
                <div class="onboarding-actions">
                  <button type="button" class="onboarding-btn onboarding-btn-secondary" (click)="goToViewerFromOnboarding()">Ver planes</button>
                  <button type="button" class="onboarding-btn onboarding-btn-primary" (click)="goToGeneratorFromOnboarding()">Crear plan</button>
                </div>
              </div>
            </section>
            <ng-template #appContent>
              <router-outlet></router-outlet>
            </ng-template>
          </main>
        </div>
      </ng-container>
    </ng-template>

    <ng-template #authScreen>
      <app-auth-ui></app-auth-ui>
    </ng-template>
  `,
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  private readonly destroyRef = inject(DestroyRef);
  title = 'test-plan-app';
  sidebarExpanded = false;
  sidebarOpen = false; // En móvil, sidebar cerrado por defecto
  isMobile = false;
  hoveredMenuItem: string | null = null; // Para controlar el hover en menú contraído
  temporaryExpanded = false; // Para expansión temporal en hover
  showOnboardingTip = false;

  readonly isAuthenticated$;

  get isSidebarExpandedView(): boolean {
    return this.isMobile || this.sidebarExpanded || this.temporaryExpanded;
  }

  constructor(public authService: AuthService, private router: Router) {
    this.isAuthenticated$ = this.authService.user$.pipe(map((user) => !!user));

    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (!user) {
          this.showOnboardingTip = false;
          return;
        }

        const onboardingDismissed = this.isOnboardingDismissed(user.id);
        const forceMobileOnboarding = this.consumeMobileOnboardingPending();
        this.showOnboardingTip = !onboardingDismissed || forceMobileOnboarding;
      });
  }

  menuItems: MenuItem[] = [
    {
      icon: '',
      label: 'Generar planes de prueba',
      route: '/generator'
    },
    {
      icon: '',
      label: 'Ver planes de prueba',
      route: '/viewer'
    }
  ];

  // Método para manejar hover en elementos del menú
  onMenuItemHover(itemLabel: string | null): void {
    if (!this.sidebarExpanded && !this.isMobile) {
      this.hoveredMenuItem = itemLabel;
      this.temporaryExpanded = true;
    }
  }

  // Método para limpiar hover
  clearMenuItemHover(): void {
    this.hoveredMenuItem = null;
    this.temporaryExpanded = false;
  }

  // Método para manejar hover en toda la sidebar
  onSidebarHover(): void {
    if (!this.sidebarExpanded && !this.isMobile) {
      this.temporaryExpanded = true;
    }
  }

  // Método para limpiar hover de la sidebar
  onSidebarLeave(): void {
    if (!this.sidebarExpanded && !this.isMobile) {
      this.temporaryExpanded = false;
      this.hoveredMenuItem = null;
    }
  }

  ngOnInit(): void {
    this.checkIfMobile();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => this.checkIfMobile());
    }
  }

  checkIfMobile(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.isMobile = window.innerWidth < 768;
    if (this.isMobile) {
      this.sidebarOpen = false;
    }
  }

  toggleSidebarMobile(): void {
    if (this.isMobile) {
      this.sidebarOpen = !this.sidebarOpen;
    }
  }

  toggleSidebar(): void {
    if (this.isMobile) {
      this.sidebarOpen = !this.sidebarOpen;
    } else {
      this.sidebarExpanded = !this.sidebarExpanded;
    }
  }

  closeSidebar(): void {
    if (this.isMobile) {
      this.sidebarOpen = false;
    }
  }

  onMenuItemClick(): void {
    this.closeSidebar();
  }

  getCollapsedOnlyTitle(text: string): string | null {
    return this.isSidebarExpandedView ? null : text;
  }

  toggleSubmenu(item: MenuItem): void {
    item.expanded = !item.expanded;
  }

  getDisplayName(user: User): string {
    return this.authService.getDisplayName(user);
  }

  getAvatarUrl(user: User): string {
    return this.authService.getAvatarUrl(user);
  }

  async logout(): Promise<void> {
    await this.authService.signOut();
  }

  showOnboarding(): void {
    this.showOnboardingTip = true;
    this.closeSidebar();
  }

  dismissOnboardingTip(): void {    const currentUserId = this.authService.user?.id;
    if (currentUserId) {
      this.markOnboardingDismissed(currentUserId);
    }

    this.showOnboardingTip = false;
  }

  async goToGeneratorFromOnboarding(): Promise<void> {
    this.dismissOnboardingTip();
    await this.router.navigateByUrl('/generator');
  }

  async goToViewerFromOnboarding(): Promise<void> {
    this.dismissOnboardingTip();
    await this.router.navigateByUrl('/viewer');
  }

  private getOnboardingStorageKey(userId: string): string {
    return `tp_onboarding_seen_${userId}`;
  }

  private isOnboardingDismissed(userId: string): boolean {
    if (typeof window === 'undefined') {
      return true;
    }

    return window.localStorage.getItem(this.getOnboardingStorageKey(userId)) === '1';
  }

  private markOnboardingDismissed(userId: string): void {
    if (typeof window === 'undefined') {
      return;
    }

    window.localStorage.setItem(this.getOnboardingStorageKey(userId), '1');
  }

  private consumeMobileOnboardingPending(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    const key = 'tp_mobile_onboarding_pending';
    const pending = window.sessionStorage.getItem(key) === '1';
    if (pending) {
      window.sessionStorage.removeItem(key);
    }

    return pending;
  }
}