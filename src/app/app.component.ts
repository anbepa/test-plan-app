import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';
import { ToastComponent } from './toast/toast.component';

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
    ToastComponent
  ],
  template: `
    <div class="app-container">
      <!-- Toast Component Global -->
      <app-toast></app-toast>
      
      <!-- Overlay para cerrar sidebar en móvil -->
      <div class="sidebar-overlay" 
           *ngIf="sidebarOpen && isMobile" 
           (click)="closeSidebar()"></div>
      
      <!-- Sidebar -->
      <aside class="sidebar" 
             [class.collapsed]="!sidebarExpanded" 
             [class.open]="sidebarOpen"
             [class.temporary-expanded]="temporaryExpanded"
             (mouseenter)="onSidebarHover()"
             (mouseleave)="onSidebarLeave()">
        
        <nav class="sidebar-nav">
          <!-- Logo/Brand section -->
          <div class="logo-section">
            <a [routerLink]="['/']" class="app-logo" (click)="onMenuItemClick()">
              <span class="logo-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M6.28 5.22a.75.75 0 010 1.06L2.56 10l3.72 3.72a.75.75 0 01-1.06 1.06L.97 10.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 010-1.06zM11.377 2.011a.75.75 0 01.612.867l-2.5 14.5a.75.75 0 01-1.478-.255l2.5-14.5a.75.75 0 01.866-.612z" clip-rule="evenodd" />
                </svg>
              </span>
              <span class="logo-title">Test Plan Manager</span>
            </a>
            
            <!-- Ícono compacto para modo contraído -->
            <div class="logo-compact" *ngIf="!sidebarExpanded && !temporaryExpanded">
              <span class="logo-compact-icon">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M6.28 5.22a.75.75 0 010 1.06L2.56 10l3.72 3.72a.75.75 0 01-1.06 1.06L.97 10.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 010-1.06zM11.377 2.011a.75.75 0 01.612.867l-2.5 14.5a.75.75 0 01-1.478-.255l2.5-14.5a.75.75 0 01.866-.612z" clip-rule="evenodd" />
                </svg>
              </span>
            </div>
          </div>

          <!-- Menu toggle button -->
          <div class="menu-header">
            <button class="menu-toggle-btn" 
                    (click)="toggleSidebarExpansion()" 
                    *ngIf="!isMobile"
                    [title]="sidebarExpanded ? 'Contraer menú' : 'Expandir menú'">
              <span class="menu-toggle-icon">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </span>
              <span class="menu-toggle-label">Menú</span>
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
                [title]="item.label">
                
                <span class="menu-icon">
                  <!-- Ícono para Generar Test Plans -->
                  <svg *ngIf="i === 0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  <!-- Ícono para Ver Test Plans -->
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
                  [title]="item.label">
                  
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
      </aside>

      <!-- Header (solo visible en móvil) -->
      <header class="header">
        <button class="menu-toggle" (click)="toggleSidebarMobile()" aria-label="Toggle menu">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <span class="header-title">Test Plan Manager</span>
      </header>

      <!-- Main Content -->
      <main class="main-content" [class.sidebar-expanded]="sidebarExpanded">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'test-plan-app';
  sidebarExpanded = true; // En desktop, sidebar expandido por defecto
  sidebarOpen = false; // En móvil, sidebar cerrado por defecto
  isMobile = false;
  hoveredMenuItem: string | null = null; // Para controlar el hover en menú contraído
  temporaryExpanded = false; // Para expansión temporal en hover
  
  menuItems: MenuItem[] = [
    {
      icon: '',
      label: 'Generar Test Plans',
      route: '/generator'
    },
    {
      icon: '',
      label: 'Ver Test Plans',
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
    window.addEventListener('resize', () => this.checkIfMobile());
  }

  checkIfMobile(): void {
    this.isMobile = window.innerWidth < 768;
    if (this.isMobile) {
      this.sidebarOpen = false;
    }
  }

  toggleSidebarExpansion(): void {
    this.sidebarExpanded = !this.sidebarExpanded;
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
    // Cerrar el sidebar al hacer clic en una opción del menú (solo en móvil)
    this.closeSidebar();
  }

  toggleSubmenu(item: MenuItem): void {
    item.expanded = !item.expanded;
  }
}