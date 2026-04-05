import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { Session, User } from '@supabase/supabase-js';
import { SupabaseClientService } from '../database/supabase-client.service';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly disposableEmailDomains = new Set([
    '10minutemail.com',
    'guerrillamail.com',
    'mailinator.com',
    'tempmail.com',
    'yopmail.com'
  ]);
  private readonly sessionSubject = new BehaviorSubject<Session | null>(null);
  private readonly userSubject = new BehaviorSubject<User | null>(null);
  private readonly loadingSubject = new BehaviorSubject<boolean>(true);

  readonly session$ = this.sessionSubject.asObservable();
  readonly user$ = this.userSubject.asObservable();
  readonly loading$ = this.loadingSubject.asObservable();

  constructor(private supabaseClient: SupabaseClientService) {
    this.initialize();
    this.supabaseClient.supabase.auth.onAuthStateChange((_event, session) => {
      this.sessionSubject.next(session);
      this.userSubject.next(session?.user ?? null);
      this.loadingSubject.next(false);
    });
  }

  get session(): Session | null {
    return this.sessionSubject.value;
  }

  get user(): User | null {
    return this.userSubject.value;
  }

  get isAuthenticated(): boolean {
    return !!this.user;
  }

  async ensureSession(): Promise<boolean> {
    if (this.userSubject.value) {
      return true;
    }

    const { data, error } = await this.supabaseClient.supabase.auth.getSession();

    if (error) {
      console.error('Error validando sesión:', error);
      return false;
    }

    this.sessionSubject.next(data.session);
    this.userSubject.next(data.session?.user ?? null);
    return !!data.session?.user;
  }

  /**
   * Inicia sesión usando nombre de usuario.
   * Internamente resuelve el email via RPC y usa signInWithPassword de Supabase.
   * Los mensajes de error son genéricos para evitar enumeración de usuarios.
   */
  async signInWithUsername(username: string, password: string): Promise<void> {
    const usernameError = this.validateUsername(username);
    if (usernameError) {
      throw new Error(usernameError);
    }

    // Resolución segura: la función RPC retorna NULL si no existe el usuario,
    // lo que produce el mismo error de Supabase que una contraseña incorrecta.
    const { data: emailData, error: rpcError } = await this.supabaseClient.supabase
      .rpc('get_email_by_username', { p_username: username.trim().toLowerCase() });

    if (rpcError) {
      throw new Error('No fue posible autenticarte. Intenta de nuevo.');
    }

    // Si el username no existe, usamos un email ficticio para normalizar el tiempo
    // de respuesta y no revelar si el usuario existe o no.
    const resolvedEmail = (emailData as string | null) ?? `${Date.now()}@no-reply.invalid`;

    const { error } = await this.supabaseClient.supabase.auth.signInWithPassword({
      email: resolvedEmail,
      password
    });

    if (error) {
      // Mensaje genérico para no revelar si el username existe o la clave es incorrecta
      throw new Error('Usuario o contraseña incorrectos.');
    }
  }

  /**
   * Registra un nuevo usuario con username + email + contraseña.
   * El username se guarda en user_metadata y el trigger lo persiste en perfiles.
   */
  async signUpWithUsername(
    username: string,
    email: string,
    password: string,
    fullName?: string
  ): Promise<{ requiresEmailConfirmation: boolean }> {
    const usernameError = this.validateUsername(username);
    if (usernameError) throw new Error(usernameError);

    const normalizedEmail = this.normalizeEmail(email);
    const emailError = this.validateEmail(normalizedEmail);
    if (emailError) throw new Error(emailError);

    // Verificar disponibilidad del username antes de registrar
    const { data: available, error: availError } = await this.supabaseClient.supabase
      .rpc('is_username_available', { p_username: username.trim().toLowerCase() });

    if (availError) {
      throw new Error('Error verificando disponibilidad del nombre de usuario.');
    }

    if (!available) {
      throw new Error('El nombre de usuario ya está en uso. Elige otro.');
    }

    const { data, error } = await this.supabaseClient.supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          username: username.trim().toLowerCase(),
          full_name: fullName ?? username,
          display_name: fullName ?? username
        }
      }
    });

    if (error) {
      throw error;
    }

    return { requiresEmailConfirmation: !data.session };
  }

  /** @internal Uso interno: login directo por email (no expuesto en UI) */
  private async signInWithEmail(email: string, password: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const { error } = await this.supabaseClient.supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });
    if (error) throw error;
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabaseClient.supabase.auth.signOut();

    if (error) {
      throw error;
    }

    this.sessionSubject.next(null);
    this.userSubject.next(null);
  }

  getDisplayName(user: User | null): string {
    if (!user) {
      return '';
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, any>;
    return metadata['full_name'] || metadata['name'] || metadata['user_name'] || user.email || 'Usuario';
  }

  getAvatarUrl(user: User | null): string {
    if (!user) {
      return '';
    }

    const metadata = (user.user_metadata ?? {}) as Record<string, any>;
    return metadata['avatar_url'] || metadata['picture'] || '';
  }

  /**
   * Valida el formato de un nombre de usuario (público para uso en UI).
   * Reglas: 3–20 caracteres, solo letras, números y guión bajo (_).
   * No puede comenzar ni terminar con guión bajo.
   */
  public validateUsername(username: string): string | null {
    const trimmed = username?.trim() ?? '';

    if (!trimmed) {
      return 'Ingresa un nombre de usuario.';
    }

    if (trimmed.length < 3) {
      return 'El nombre de usuario debe tener al menos 3 caracteres.';
    }

    if (trimmed.length > 20) {
      return 'El nombre de usuario no puede superar 20 caracteres.';
    }

    if (!/^[a-z0-9_]+$/i.test(trimmed)) {
      return 'Solo se permiten letras, números y guión bajo (_).';
    }

    if (trimmed.startsWith('_') || trimmed.endsWith('_')) {
      return 'El nombre de usuario no puede empezar ni terminar con guión bajo.';
    }

    return null;
  }

  validateEmail(email: string): string | null {
    const normalizedEmail = this.normalizeEmail(email);

    if (!normalizedEmail) {
      return 'Ingresa un correo electrónico.';
    }

    if (normalizedEmail.length > 254) {
      return 'El correo electrónico es demasiado largo.';
    }

    const emailParts = normalizedEmail.split('@');
    if (emailParts.length !== 2) {
      return 'Ingresa un correo electrónico válido.';
    }

    const [localPart, domain] = emailParts;

    if (!localPart || !domain) {
      return 'Ingresa un correo electrónico válido.';
    }

    if (localPart.length > 64 || localPart.startsWith('.') || localPart.endsWith('.') || localPart.includes('..')) {
      return 'Ingresa un correo electrónico válido.';
    }

    if (!/^[A-Z0-9.!#$%&''*+/=?^_`{|}~-]+$/i.test(localPart)) {
      return 'Ingresa un correo electrónico válido.';
    }

    if (domain.includes('..') || !domain.includes('.')) {
      return 'Ingresa un correo electrónico válido.';
    }

    const domainLabels = domain.split('.');
    if (domainLabels.some((label) => !label || label.startsWith('-') || label.endsWith('-') || !/^[a-z0-9-]+$/i.test(label))) {
      return 'Ingresa un correo electrónico válido.';
    }

    const topLevelDomain = domainLabels[domainLabels.length - 1];
    if (!topLevelDomain || topLevelDomain.length < 2) {
      return 'Ingresa un correo electrónico válido.';
    }

    if (this.disposableEmailDomains.has(domain.toLowerCase())) {
      return 'No se permiten correos temporales o desechables.';
    }

    return null;
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async initialize(): Promise<void> {
    const { data, error } = await this.supabaseClient.supabase.auth.getSession();

    if (error) {
      console.error('Error obteniendo sesión inicial:', error);
      this.loadingSubject.next(false);
      return;
    }

    this.sessionSubject.next(data.session);
    this.userSubject.next(data.session?.user ?? null);
    this.loadingSubject.next(false);
  }
}
