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

  async signInWithEmail(email: string, password: string): Promise<void> {
    const normalizedEmail = this.normalizeEmail(email);
    const validationError = this.validateEmail(normalizedEmail);

    if (validationError) {
      throw new Error(validationError);
    }

    const { error } = await this.supabaseClient.supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (error) {
      throw error;
    }
  }

  async signUpWithEmail(email: string, password: string, fullName?: string): Promise<{ requiresEmailConfirmation: boolean }> {
    const normalizedEmail = this.normalizeEmail(email);
    const validationError = this.validateEmail(normalizedEmail);

    if (validationError) {
      throw new Error(validationError);
    }

    const { data, error } = await this.supabaseClient.supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: fullName ?? '',
          display_name: fullName ?? ''
        }
      }
    });

    if (error) {
      throw error;
    }

    return {
      requiresEmailConfirmation: !data.session
    };
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
