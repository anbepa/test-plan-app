import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../../environments/environment';

@Injectable({
    providedIn: 'root'
})
export class SupabaseClientService {
    public supabase: SupabaseClient;

    constructor() {
        // Validar que las variables de entorno están configuradas
        if (!environment.supabaseUrl || environment.supabaseUrl === '${SUPABASE_URL}') {
            console.error('❌ SUPABASE_URL no está configurada correctamente');
            throw new Error('Variables de entorno de Supabase no configuradas. Verifica la configuración en Vercel.');
        }

        if (!environment.supabaseKey || environment.supabaseKey === '${SUPABASE_KEY}') {
            console.error('❌ SUPABASE_KEY no está configurada correctamente');
            throw new Error('Variables de entorno de Supabase no configuradas. Verifica la configuración en Vercel.');
        }

        // Inicializar cliente de Supabase con environment.ts
        this.supabase = createClient(
            environment.supabaseUrl,
            environment.supabaseKey
        );

        console.log('✅ SupabaseClientService inicializado con environment.ts');
    }

    /**
     * Verificar si la base de datos está lista
     */
    isReady(): boolean {
        return !!(environment.supabaseUrl && environment.supabaseKey);
    }
}
