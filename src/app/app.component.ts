import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet, RouterLink } from '@angular/router';

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
    RouterLink
  ],
  template: `
    <div class="app-container">
      <!-- Overlay para cerrar sidebar al hacer clic fuera -->
      <div class="sidebar-overlay" 
           *ngIf="!sidebarCollapsed" 
           (click)="closeSidebar()"></div>
      
      <!-- Header -->
      <header class="header">
        <button class="menu-toggle" (click)="toggleSidebar()" aria-label="Toggle menu">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          <span>Menú</span>
        </button>
        <a [routerLink]="['/']" class="header-brand" (click)="closeSidebar()">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" class="brand-icon">
            <path fill-rule="evenodd" d="M6.28 5.22a.75.75 0 010 1.06L2.56 10l3.72 3.72a.75.75 0 01-1.06 1.06L.97 10.53a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.06 0zm7.44 0a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L17.44 10l-3.72-3.72a.75.75 0 010-1.06zM11.377 2.011a.75.75 0 01.612.867l-2.5 14.5a.75.75 0 01-1.478-.255l2.5-14.5a.75.75 0 01.866-.612z" clip-rule="evenodd" />
          </svg>
          <span class="brand-title">Test Plan Manager</span>
        </a>
      </header>

      <!-- Sidebar -->
      <aside class="sidebar" [class.collapsed]="sidebarCollapsed">
        <nav class="sidebar-nav">
          <ul class="menu-list">
            <li *ngFor="let item of menuItems" class="menu-item">
              <a 
                *ngIf="!item.subItems" 
                [routerLink]="item.route" 
                routerLinkActive="active"
                class="menu-link"
                (click)="onMenuItemClick()"
                [title]="item.label">
                <span class="menu-icon" [innerHTML]="item.icon"></span>
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

      <!-- Main Content -->
      <main class="main-content" [class.sidebar-collapsed]="sidebarCollapsed">
        <router-outlet></router-outlet>
      </main>
    </div>
  `,
  styleUrls: ['./app.component.css']
})
export class AppComponent {
  title = 'test-plan-app';
  sidebarCollapsed = false;
  
  menuItems: MenuItem[] = [
    {
      icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>',
      label: 'Generar Test Plans',
      route: '/generator'
    },
    {
      icon: '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>',
      label: 'Ver Test Plans',
      route: '/viewer'
    }
  ];

  toggleSidebar(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
  }

  closeSidebar(): void {
    this.sidebarCollapsed = true;
  }

  onMenuItemClick(): void {
    // Cerrar el sidebar al hacer clic en una opción del menú
    this.closeSidebar();
  }

  toggleSubmenu(item: MenuItem): void {
    item.expanded = !item.expanded;
  }
}