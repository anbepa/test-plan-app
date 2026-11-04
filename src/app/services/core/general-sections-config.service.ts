import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientService } from '../database/supabase-client.service';
import { DEFAULT_PLAN_TITLE_TEMPLATE } from '../../shared/utils/plan-title';

export interface GeneralSectionsConfig {
  repositoryLink: string;
  teamContent: string;
  /** Plantilla del nombre del test plan ({HU}, {SPRINT}). */
  planTitleTemplate: string;
}

/** De dónde salen los valores que se muestran. */
export type GeneralSectionsSource = 'database' | 'local' | 'defaults';

export interface GeneralSectionsMeta {
  source: GeneralSectionsSource;
  /** Última vez que se guardó en la base de datos (si aplica). */
  updatedAt: string | null;
}

export interface GeneralSectionsSaveResult {
  config: GeneralSectionsConfig;
  /** true si quedó guardado en la base de datos; false si solo en este navegador. */
  savedToDatabase: boolean;
  error?: string;
}

/**
 * Parámetros globales (repositorio, equipo y plantilla del nombre del plan) usados al crear y previsualizar planes.
 *
 *  - Fuente de verdad: Supabase, tabla user_general_sections (una fila por usuario, RLS).
 *  - Cache local POR USUARIO para un arranque rápido y para no perder datos si la
 *    base de datos no responde. Antes se guardaban solo en el navegador, con una
 *    clave compartida por todos los usuarios.
 *  - La primera vez se reutiliza lo que el usuario tenía guardado en el navegador
 *    (clave anterior) para no perder su configuración.
 */
@Injectable({
  providedIn: 'root'
})
export class GeneralSectionsConfigService {
  private readonly TABLE = 'user_general_sections';
  /** Clave anterior (global, sin usuario). Solo se lee para migrar. */
  private readonly LEGACY_KEY = 'general_sections_config';
  private readonly CACHE_PREFIX = 'general_sections_config:';

  private readonly defaults: GeneralSectionsConfig = {
    repositoryLink: 'https://dev.azure.com/YOUR_ORG/YOUR_PROJECT/_git/NU0139001_SAF_MR_Test - Repos (visualstudio.com)',
    teamContent: 'Dueño del Producto – Bancolombia: Diego Fernando Giraldo Hincapie\nAnalista de Desarrollo – Pragma: Eddy Johana Cristancho\nAnalista de Desarrollo: Luis Alfredo Chuscano Remolina\nAnalista de Desarrollo: Kevin David Cuadros Estupinan\nAnalista de Pruebas – TCS: Gabriel Ernesto Montoya Henao\nAnalista de Pruebas – TCS: Andrés Antonio Bernal Padilla',
    planTitleTemplate: DEFAULT_PLAN_TITLE_TEMPLATE
  };

  private readonly configSubject = new BehaviorSubject<GeneralSectionsConfig>(this.getDefaults());
  readonly config$: Observable<GeneralSectionsConfig> = this.configSubject.asObservable();

  private readonly metaSubject = new BehaviorSubject<GeneralSectionsMeta>({ source: 'defaults', updatedAt: null });
  readonly meta$: Observable<GeneralSectionsMeta> = this.metaSubject.asObservable();

  private currentUserId: string | null = null;
  private loading: Promise<void> = Promise.resolve();

  constructor(
    private authService: AuthService,
    private supabaseClient: SupabaseClientService
  ) {
    this.authService.user$.subscribe((user) => {
      const userId = user?.id ?? null;
      if (userId === this.currentUserId) return;
      this.currentUserId = userId;
      this.loading = this.loadForUser(userId);
    });
  }

  getDefaults(): GeneralSectionsConfig {
    return { ...this.defaults };
  }

  /** Valores actuales (sin esperar a la base de datos). */
  getConfig(): GeneralSectionsConfig {
    return { ...this.configSubject.value };
  }

  /** Valores actuales una vez terminada la carga desde la base de datos. */
  async ready(): Promise<GeneralSectionsConfig> {
    await this.loading;
    return this.getConfig();
  }

  get meta(): GeneralSectionsMeta {
    return this.metaSubject.value;
  }

  async saveConfig(config: Partial<GeneralSectionsConfig>): Promise<GeneralSectionsSaveResult> {
    const current = this.getConfig();
    const updated = this.normalize({
      repositoryLink: config.repositoryLink ?? current.repositoryLink,
      teamContent: config.teamContent ?? current.teamContent,
      planTitleTemplate: config.planTitleTemplate ?? current.planTitleTemplate
    });

    const userId = this.currentUserId;
    this.configSubject.next(updated);
    if (userId) this.writeCache(userId, updated);

    if (!userId) {
      this.metaSubject.next({ source: 'local', updatedAt: null });
      return { config: updated, savedToDatabase: false, error: 'No hay sesión activa.' };
    }

    const { data, error } = await this.supabaseClient.supabase
      .from(this.TABLE)
      .upsert(
        {
          user_id: userId,
          repository_link: updated.repositoryLink,
          team_content: updated.teamContent,
          plan_title_template: updated.planTitleTemplate
        },
        { onConflict: 'user_id' }
      )
      .select('updated_at')
      .maybeSingle();

    if (error) {
      console.warn('[GeneralSectionsConfig] No se pudo guardar en la base de datos:', error.message);
      this.metaSubject.next({ source: 'local', updatedAt: null });
      return { config: updated, savedToDatabase: false, error: error.message };
    }

    this.metaSubject.next({ source: 'database', updatedAt: (data as any)?.updated_at ?? new Date().toISOString() });
    return { config: updated, savedToDatabase: true };
  }

  private async loadForUser(userId: string | null): Promise<void> {
    if (!userId) {
      this.configSubject.next(this.getDefaults());
      this.metaSubject.next({ source: 'defaults', updatedAt: null });
      return;
    }

    // 1) Arranque rápido: cache del usuario o, la primera vez, la clave anterior del navegador.
    const local = this.readCache(userId) ?? this.readLegacy();
    if (local) {
      this.configSubject.next(local);
      this.metaSubject.next({ source: 'local', updatedAt: null });
    } else {
      this.configSubject.next(this.getDefaults());
      this.metaSubject.next({ source: 'defaults', updatedAt: null });
    }

    // 2) Fuente de verdad: Supabase.
    try {
      const { data, error } = await this.supabaseClient.supabase
        .from(this.TABLE)
        .select('repository_link, team_content, plan_title_template, updated_at')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (userId !== this.currentUserId) return; // cambió el usuario mientras cargaba

      if (error) {
        console.warn('[GeneralSectionsConfig] Error al leer los parámetros del usuario:', error.message);
        return; // se mantiene lo local
      }

      if (data) {
        const config = this.normalize({
          repositoryLink: (data as any).repository_link,
          teamContent: (data as any).team_content,
          planTitleTemplate: (data as any).plan_title_template
        });
        this.configSubject.next(config);
        this.metaSubject.next({ source: 'database', updatedAt: (data as any).updated_at ?? null });
        this.writeCache(userId, config);
      } else if (local) {
        // Sin fila en BD pero con datos en este navegador: se copian a la BD
        // para que no se pierdan al cambiar de equipo o de navegador.
        await this.saveConfig(local);
      }
    } catch (err) {
      console.warn('[GeneralSectionsConfig] Excepción al cargar los parámetros:', err);
    }
  }

  private normalize(config: Partial<GeneralSectionsConfig>): GeneralSectionsConfig {
    return {
      repositoryLink: (config.repositoryLink || '').trim() || this.defaults.repositoryLink,
      teamContent: (config.teamContent || '').trim() || this.defaults.teamContent,
      planTitleTemplate: (config.planTitleTemplate || '').trim() || this.defaults.planTitleTemplate
    };
  }

  private readCache(userId: string): GeneralSectionsConfig | null {
    return this.readKey(this.CACHE_PREFIX + userId);
  }

  private readLegacy(): GeneralSectionsConfig | null {
    return this.readKey(this.LEGACY_KEY);
  }

  private readKey(key: string): GeneralSectionsConfig | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      return this.normalize(JSON.parse(raw) as Partial<GeneralSectionsConfig>);
    } catch {
      return null;
    }
  }

  private writeCache(userId: string, config: GeneralSectionsConfig): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(this.CACHE_PREFIX + userId, JSON.stringify(config));
    } catch { /* cuota llena o modo privado: se ignora */ }
  }
}
