// src/app/services/app-config.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

/**
 * Configuración de base de datos
 */
export interface DatabaseConfig {
  provider: 'supabase' | 'appwrite' | 'pocketbase' | 'nhost' | 'none';
  url: string;
  apiKey: string;
  projectId?: string; // Para Appwrite
  endpoint?: string;  // Para PocketBase, Nhost
}

/**
 * Configuración general de la aplicación
 */
export interface AppConfiguration {
  database: DatabaseConfig;
  features: {
    useDatabase: boolean;
    enableRealtime: boolean;
    enableAuth: boolean;
  };
}

/**
 * Servicio para gestionar la configuración global de la aplicación
 */
@Injectable({
  providedIn: 'root'
})
export class AppConfigService {
  
  private configSubject = new BehaviorSubject<AppConfiguration>(this.getDefaultConfig());
  public config$ = this.configSubject.asObservable();

  constructor() {
    this.loadConfig();
  }

  /**
   * Configuración por defecto
   */
  private getDefaultConfig(): AppConfiguration {
    return {
      database: {
        provider: 'supabase',
        url: '',
        apiKey: ''
      },
      features: {
        useDatabase: true,
        enableRealtime: false,
        enableAuth: false
      }
    };
  }

  /**
   * Cargar configuración desde localStorage
   */
  private loadConfig(): void {
    try {
      const saved = localStorage.getItem('app_configuration');
      if (saved) {
        const config = JSON.parse(saved);
        this.configSubject.next({ ...this.getDefaultConfig(), ...config });
      }
    } catch (error) {
      console.warn('No se pudo cargar configuración guardada:', error);
    }
  }

  /**
   * Guardar configuración en localStorage
   */
  saveConfig(config: Partial<AppConfiguration>): void {
    const current = this.configSubject.getValue();
    const updated = { ...current, ...config };
    
    this.configSubject.next(updated);
    localStorage.setItem('app_configuration', JSON.stringify(updated));
    
    console.log('✅ Configuración guardada:', updated);
  }

  /**
   * Actualizar configuración de base de datos
   */
  updateDatabaseConfig(dbConfig: Partial<DatabaseConfig>): void {
    const current = this.configSubject.getValue();
    const updatedDb = { ...current.database, ...dbConfig };
    
    this.saveConfig({ database: updatedDb });
  }

  /**
   * Obtener configuración actual
   */
  getCurrentConfig(): AppConfiguration {
    return this.configSubject.getValue();
  }

  /**
   * Obtener configuración de base de datos actual
   */
  getCurrentDatabaseConfig(): DatabaseConfig {
    return this.configSubject.getValue().database;
  }
}
