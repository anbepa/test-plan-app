// src/app/services/ai/ai-providers.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

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
 * Servicio simplificado para gestionar proveedores de IA
 * Usa localStorage para persistir la configuración
 */
@Injectable({
  providedIn: 'root'
})
export class AiProvidersService {

  private readonly STORAGE_KEY = 'active_ai_provider';

  // Proveedores disponibles (hardcoded)
  private readonly availableProviders: AiProvider[] = [
    {
      id: 'gemini',
      name: 'gemini',
      displayName: 'Google Gemini',
      endpointUrl: 'https://generativelanguage.googleapis.com/v1/models/',
      defaultModel: 'gemini-2.5-flash-lite',
      isActive: false, // Desactivado (alcanzó cuota)
      hasApiKey: true,
      metadata: { tier: 'free', rateLimit: '20/day' }
    },
    {
      id: 'deepseek',
      name: 'deepseek',
      displayName: 'DeepSeek',
      endpointUrl: 'https://api.deepseek.com/chat/completions',
      defaultModel: 'deepseek-chat',
      isActive: true, // ACTIVO POR DEFECTO
      hasApiKey: true,
      metadata: { tier: 'paid', rateLimit: 'varies' }
    }
  ];

  // Estado reactivo de proveedores
  private providersSubject = new BehaviorSubject<AiProvider[]>(this.availableProviders);
  public providers$ = this.providersSubject.asObservable();

  constructor() {
    // Cargar proveedor activo desde localStorage
    this.loadActiveProviderFromStorage();
  }

  /**
   * Cargar el proveedor activo desde localStorage
   */
  private loadActiveProviderFromStorage(): void {
    const savedProviderId = localStorage.getItem(this.STORAGE_KEY);

    if (savedProviderId) {
      console.log(`[AI Providers] Proveedor guardado en localStorage: ${savedProviderId}`);
      this.setActiveProvider(savedProviderId);
    } else {
      console.log('[AI Providers] Usando proveedor por defecto: deepseek');
    }
  }

  /**
   * Obtener lista de proveedores disponibles
   */
  getProviders(): AiProvider[] {
    return this.providersSubject.getValue();
  }

  /**
   * Activar un proveedor específico
   */
  setActiveProvider(providerId: string): void {
    const providers = this.availableProviders.map(p => ({
      ...p,
      isActive: p.id === providerId
    }));

    this.providersSubject.next(providers);

    // Guardar en localStorage
    localStorage.setItem(this.STORAGE_KEY, providerId);

    console.log(`✅ Proveedor activo cambiado a: ${providerId}`);
  }

  /**
   * Obtener el proveedor activo actual
   */
  getActiveProvider(): AiProvider | null {
    const providers = this.providersSubject.getValue();
    const activeProvider = providers.find(p => p.isActive);

    if (!activeProvider) {
      console.warn('[AI Providers] No hay proveedor activo, usando DeepSeek por defecto');
      return providers.find(p => p.id === 'deepseek') || null;
    }

    return activeProvider;
  }

  /**
   * Verificar si hay al menos un proveedor configurado
   */
  hasConfiguredProviders(): boolean {
    return this.availableProviders.length > 0;
  }

  /**
   * Obtener ID del proveedor activo
   */
  getActiveProviderId(): string {
    return this.getActiveProvider()?.id || 'deepseek';
  }
}
