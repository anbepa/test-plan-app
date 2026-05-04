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
import { SupabaseClientService } from './services/database/supabase-client.service';

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
                <a class="app-logo" *ngIf="isSidebarExpandedView" (click)="goToWelcome()" style="cursor:pointer">
                  <div class="logo-svg-wrap">
                    <svg width="38" height="38" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="64" height="64" rx="14" fill="#0071e3"/>
                      <rect x="14" y="12" width="24" height="32" rx="3" fill="white" opacity="0.18"/>
                      <rect x="14" y="12" width="24" height="32" rx="3" stroke="white" stroke-width="2"/>
                      <line x1="19" y1="20" x2="32" y2="20" stroke="white" stroke-width="2" stroke-linecap="round"/>
                      <line x1="19" y1="26" x2="32" y2="26" stroke="white" stroke-width="2" stroke-linecap="round"/>
                      <line x1="19" y1="32" x2="27" y2="32" stroke="white" stroke-width="2" stroke-linecap="round"/>
                      <circle cx="42" cy="43" r="12" fill="white"/>
                      <path d="M37 43l3.5 3.5L47 39" stroke="#0071e3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                  <div class="logo-text-block">
                    <span class="logo-name">TestPlan</span>
                    <span class="logo-tagline">Gestor QA</span>
                  </div>
                </a>

                <a class="logo-compact" *ngIf="!isSidebarExpandedView" (click)="goToWelcome()" style="cursor:pointer">
                  <div class="logo-isotipo">
                    <svg width="32" height="32" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect width="64" height="64" rx="14" fill="#0071e3"/>
                      <rect x="14" y="12" width="24" height="32" rx="3" fill="white" opacity="0.18"/>
                      <rect x="14" y="12" width="24" height="32" rx="3" stroke="white" stroke-width="2"/>
                      <line x1="19" y1="20" x2="32" y2="20" stroke="white" stroke-width="2" stroke-linecap="round"/>
                      <line x1="19" y1="26" x2="32" y2="26" stroke="white" stroke-width="2" stroke-linecap="round"/>
                      <circle cx="42" cy="43" r="12" fill="white"/>
                      <path d="M37 43l3.5 3.5L47 39" stroke="#0071e3" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
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
                    [class.active]="isMenuItemActive(item.route || '')"
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
                      <svg *ngIf="i === 2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
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
              <div class="user-row">
                <div class="user-avatar-wrap">
                  <img *ngIf="getAvatarUrl(user)" [src]="getAvatarUrl(user)" alt="Avatar" class="user-avatar" />
                  <div *ngIf="!getAvatarUrl(user)" class="user-avatar-fallback">{{ (getDisplayName(user) || user.email || '?')[0].toUpperCase() }}</div>
                </div>
                <div class="user-meta">
                  <div class="user-name">{{ getDisplayName(user) }}</div>
                  <div class="user-email">{{ user.email }}</div>
                </div>
                <button class="logout-btn" (click)="logout()" title="Cerrar sesión">
                  <span class="logout-icon" aria-hidden="true">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H9m4 8H7a2 2 0 01-2-2V6a2 2 0 012-2h6" />
                    </svg>
                  </span>
                  <span class="logout-label">Cerrar sesión</span>
                </button>
              </div>
            </div>
          </aside>

          <header class="header">
            <button class="menu-toggle" (click)="toggleSidebarMobile()" aria-label="Toggle menu">
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <span class="header-title"><img src="/logo.png" alt="Gestor de Planes de Prueba" class="header-logo-img" /></span>
          </header>

          <main class="main-content" [class.sidebar-expanded]="isSidebarExpandedView && !isMobile" [class.sidebar-collapsed]="!isSidebarExpandedView && !isMobile">
            <router-outlet></router-outlet>
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
  recentPlans: any[] = [];

  readonly isAuthenticated$;

  get isSidebarExpandedView(): boolean {
    return this.isMobile || this.sidebarExpanded || this.temporaryExpanded;
  }

  constructor(public authService: AuthService, public router: Router, private supabaseClient: SupabaseClientService) {
    this.isAuthenticated$ = this.authService.user$.pipe(map((user) => !!user));

    this.authService.user$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((user) => {
        if (!user) {
          this.showOnboardingTip = false;
          return;
        }

        // Solo navegar a /welcome si estás en la raíz o sin navegar específicamente
        const currentUrl = this.router.url;
        if (currentUrl === '/' || currentUrl === '') {
          this.router.navigateByUrl('/welcome');
        }
      });
  }

  private async loadRecentPlans(userId: string): Promise<void> {
    try {
      const { data } = await this.supabaseClient.supabase
        .from('test_plans')
        .select('id, hu_title, updated_at')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false })
        .limit(4);
      this.recentPlans = data || [];
    } catch { this.recentPlans = []; }
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
    },
    {
      icon: '',
      label: 'Ejecución manual',
      route: '/manual-execution'
    }
  ];

  isMenuItemActive(route: string): boolean {
    const url = this.router.url.split('?')[0];
    if (route === '/viewer') {
      // Only active for /viewer and its sub-routes EXCEPT /execute-plan
      return url === '/viewer' || (url.startsWith('/viewer/') && !url.startsWith('/viewer/execute-plan'));
    }
    if (route === '/manual-execution') {
      return url === '/manual-execution' || url.startsWith('/viewer/execute-plan');
    }
    return url === route || url.startsWith(route + '/');
  }

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

  goToWelcome(): void {
    this.closeSidebar();
    this.router.navigateByUrl('/welcome');
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