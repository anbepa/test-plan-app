import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { SupabaseClientService } from '../database/supabase-client.service';

/**
 * Gestiona la lista de "Nombre Célula" usada en el generador.
 *
 * Reglas de negocio:
 *  - DEFAULT_CELLS aplica a TODOS los usuarios por defecto (viven en código).
 *  - Si un usuario personaliza su lista, se guarda en Supabase (tabla
 *    user_cell_lists) como override TOTAL y solo ese usuario la ve (RLS).
 *  - Fallbacks: sin sesión o error de red -> se usan los defaults.
 *  - Cache local por usuario para un arranque rápido y sin parpadeos.
 */
@Injectable({
  providedIn: 'root'
})
export class CellsConfigService {
  /** Valores por defecto (globales) para todos los usuarios. */
  static readonly DEFAULT_CELLS: string[] = ['BRAINSTORM', 'WAYRA', 'FURY', 'WAKANDA'];

  private readonly TABLE = 'user_cell_lists';
  private readonly CACHE_PREFIX = 'cells_config:';

  private readonly cellsSubject = new BehaviorSubject<string[]>([...CellsConfigService.DEFAULT_CELLS]);
  /** Lista efectiva de células que debe mostrar la UI. */
  readonly cells$: Observable<string[]> = this.cellsSubject.asObservable();

  private currentUserId: string | null = null;

  constructor(
    private authService: AuthService,
    private supabaseClient: SupabaseClientService
  ) {
    // Reaccionar a login/logout / cambio de usuario.
    this.authService.user$.subscribe((user) => {
      const userId = user?.id ?? null;
      if (userId === this.currentUserId) {
        return;
      }
      this.currentUserId = userId;
      this.loadForUser(userId);
    });
  }

  /** Devuelve una copia de los defaults globales. */
  getDefaults(): string[] {
    return [...CellsConfigService.DEFAULT_CELLS];
  }

  /** Snapshot de la lista efectiva actual. */
  getCurrent(): string[] {
    return [...this.cellsSubject.value];
  }

  /**
   * Carga la lista efectiva para un usuario:
   *  cache local -> Supabase -> defaults.
   */
  private async loadForUser(userId: string | null): Promise<void> {
    // Sin usuario -> defaults (y no filtramos datos del usuario previo)
    if (!userId) {
      this.cellsSubject.next(this.getDefaults());
      return;
    }

    // 1) Arranque rápido con cache local si existe.
    const cached = this.readCache(userId);
    if (cached && cached.length) {
      this.cellsSubject.next(cached);
    } else {
      this.cellsSubject.next(this.getDefaults());
    }

    // 2) Fuente de verdad: Supabase.
    try {
      const { data, error } = await this.supabaseClient.supabase
        .from(this.TABLE)
        .select('cells')
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error) {
        console.warn('[CellsConfig] Error al leer células del usuario:', error.message);
        return; // Se mantiene cache/defaults ya emitidos.
      }

      const cells = (data?.['cells'] as string[] | undefined) ?? null;
      if (cells && cells.length) {
        const normalized = this.normalize(cells);
        this.cellsSubject.next(normalized);
        this.writeCache(userId, normalized);
      } else {
        // El usuario no tiene override -> defaults globales.
        this.cellsSubject.next(this.getDefaults());
        this.clearCache(userId);
      }
    } catch (err) {
      console.warn('[CellsConfig] Excepción al cargar células:', err);
    }
  }

  /**
   * Guarda (upsert) la lista personalizada del usuario actual.
   * Requiere sesión activa.
   */
  async saveForCurrentUser(cells: string[]): Promise<string[]> {
    const userId = this.authService.user?.id ?? null;
    if (!userId) {
      throw new Error('Debes iniciar sesión para guardar tu lista de células.');
    }

    const normalized = this.normalize(cells);
    if (!normalized.length) {
      throw new Error('La lista de células no puede quedar vacía.');
    }

    const { error } = await this.supabaseClient.supabase
      .from(this.TABLE)
      .upsert({ user_id: userId, cells: normalized }, { onConflict: 'user_id' });

    if (error) {
      throw new Error(error.message || 'No se pudo guardar la lista de células.');
    }

    this.cellsSubject.next(normalized);
    this.writeCache(userId, normalized);
    return normalized;
  }

  /**
   * Restaura la lista del usuario a los defaults globales
   * (elimina su override en BD).
   */
  async resetForCurrentUser(): Promise<string[]> {
    const userId = this.authService.user?.id ?? null;
    if (!userId) {
      throw new Error('Debes iniciar sesión para restaurar tu lista de células.');
    }

    const { error } = await this.supabaseClient.supabase
      .from(this.TABLE)
      .delete()
      .eq('user_id', userId);

    if (error) {
      throw new Error(error.message || 'No se pudo restaurar la lista de células.');
    }

    const defaults = this.getDefaults();
    this.cellsSubject.next(defaults);
    this.clearCache(userId);
    return defaults;
  }

  /** Normaliza: trim, sin vacíos, sin duplicados (case-insensitive), máx 200. */
  private normalize(cells: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of cells || []) {
      const value = (raw || '').trim();
      if (!value) continue;
      const key = value.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(value);
      if (out.length >= 200) break;
    }
    return out;
  }

  // ── Cache local por usuario ──────────────────────────────────────────
  private cacheKey(userId: string): string {
    return `${this.CACHE_PREFIX}${userId}`;
  }

  private readCache(userId: string): string[] | null {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    try {
      const raw = localStorage.getItem(this.cacheKey(userId));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? this.normalize(parsed) : null;
    } catch {
      return null;
    }
  }

  private writeCache(userId: string, cells: string[]): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.setItem(this.cacheKey(userId), JSON.stringify(cells));
    } catch {
      /* ignore */
    }
  }

  private clearCache(userId: string): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try {
      localStorage.removeItem(this.cacheKey(userId));
    } catch {
      /* ignore */
    }
  }
}
