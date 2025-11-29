// src/app/services/ai-providers.service.ts
import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, BehaviorSubject, throwError } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';

/**
 * Interface para proveedores de IA
 */
export interface AiProvider {
  id: string;
  name: string;
  displayName: string;
  endpointUrl: string;
  defaultModel: string | null;
  isActive: boolean;
  hasApiKey: boolean;
  metadata?: Record<string, any>;
}

/**
 * Interface para respuesta de la API
 */
interface ApiResponse<T> {
  status: 'success' | 'error';
  message?: string;
  providers?: T[];
  provider?: string;
  activeProvider?: string;
}

/**
 * Servicio para gestionar proveedores de IA
 * Comunica con los endpoints /api/admin/*
 */
@Injectable({
  providedIn: 'root'
})
export class AiProvidersService {
  
  private readonly baseUrl = '/api/admin';
  
  // Estado reactivo de proveedores
  private providersSubject = new BehaviorSubject<AiProvider[]>([]);
  public providers$ = this.providersSubject.asObservable();
  
  constructor(private http: HttpClient) {
    // Cargar proveedores al iniciar
    this.loadProviders();
  }

  private extractProviders(response: ApiResponse<AiProvider>): AiProvider[] {
    if (response.status !== 'success' || !response.providers) {
      throw new Error(response.message || 'Error al obtener proveedores');
    }

    return response.providers;
  }

  private logAndPropagateError(error: unknown): Observable<never> {
    console.error('❌ Error en AiProvidersService:', error);
    return throwError(() => error);
  }

  /**
   * Cargar lista de proveedores desde el backend
   */
  loadProviders(): void {
    this.getProviders().subscribe({
      next: (providers) => {
        this.providersSubject.next(providers);
        console.log('✅ Proveedores cargados:', providers.length);
      },
      error: (error) => {
        console.error('❌ Error al cargar proveedores:', error);
      }
    });
  }

  /**
   * Obtener lista de proveedores (sin API keys)
   */
  getProviders(): Observable<AiProvider[]> {
    return this.http.get<ApiResponse<AiProvider>>(`${this.baseUrl}/get-providers`).pipe(
      map((response) => this.extractProviders(response)),
      tap((providers) => console.log('✅ Proveedores obtenidos desde API:', providers.length)),
      // Mantener interfaz Observable<AiProvider[]> propagando el error original
      // para que los consumidores puedan gestionarlo adecuadamente.
      catchError((error) => this.logAndPropagateError(error))
    );
  }

  /**
   * Guardar o actualizar proveedor
   */
  saveProvider(
    provider: string,
    displayName: string,
    apiKey: string,
    endpointUrl: string,
    defaultModel?: string,
    isActive?: boolean
  ): Observable<any> {
    const body = {
      provider,
      displayName,
      apiKey,
      endpointUrl,
      defaultModel,
      isActive
    };

    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/save-provider`, body).pipe(
      tap(() => {
        // Recargar proveedores después de guardar
        this.loadProviders();
      })
    );
  }

  /**
   * Activar un proveedor específico
   */
  setActiveProvider(provider: string): Observable<any> {
    return this.http.post<ApiResponse<any>>(`${this.baseUrl}/set-active-provider`, { provider }).pipe(
      tap(() => {
        // Recargar proveedores después de activar
        this.loadProviders();
      })
    );
  }

  /**
   * Obtener el proveedor activo actual
   */
  getActiveProvider(): AiProvider | null {
    const providers = this.providersSubject.getValue();
    return providers.find(p => p.isActive) || null;
  }

  /**
   * Verificar si hay al menos un proveedor configurado
   */
  hasConfiguredProviders(): boolean {
    return this.providersSubject.getValue().length > 0;
  }
}
