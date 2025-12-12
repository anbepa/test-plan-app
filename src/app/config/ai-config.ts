// Configuración centralizada de proveedores de IA
// Funciona en local (.env.local) y Vercel (variables de entorno)

export interface AIProviderConfig {
    id: string;
    name: string;
    displayName: string;
    model: string;
    apiKey: string;
    enabled: boolean;
}

export interface AIConfig {
    activeProvider: string;
    providers: {
        gemini: AIProviderConfig;
        deepseek: AIProviderConfig;
    };
}

/**
 * Obtiene la configuración de IA desde variables de entorno
 * Funciona tanto en desarrollo local como en Vercel
 */
export function getAIConfig(): AIConfig {
    // Proveedor activo (por defecto: deepseek)
    const activeProvider = process.env['AI_PROVIDER'] || 'deepseek';

    return {
        activeProvider,
        providers: {
            gemini: {
                id: 'gemini',
                name: 'gemini',
                displayName: 'Google Gemini',
                model: 'gemini-2.5-flash-lite',
                apiKey: process.env['GEMINI_API_KEY'] || '',
                enabled: !!process.env['GEMINI_API_KEY']
            },
            deepseek: {
                id: 'deepseek',
                name: 'deepseek',
                displayName: 'DeepSeek',
                model: process.env['DEEPSEEK_MODEL'] || 'deepseek-chat',
                apiKey: process.env['DEEPSEEK_API_KEY'] || '',
                enabled: !!process.env['DEEPSEEK_API_KEY']
            }
        }
    };
}

/**
 * Obtiene la configuración del proveedor activo
 */
export function getActiveProviderConfig(): AIProviderConfig {
    const config = getAIConfig();
    const activeId = config.activeProvider as keyof typeof config.providers;

    if (!config.providers[activeId]) {
        console.warn(`[AI Config] Proveedor "${activeId}" no encontrado, usando deepseek`);
        return config.providers.deepseek;
    }

    return config.providers[activeId];
}

/**
 * Obtiene la configuración de un proveedor específico
 */
export function getProviderConfig(providerId: string): AIProviderConfig | null {
    const config = getAIConfig();
    const provider = config.providers[providerId as keyof typeof config.providers];
    return provider || null;
}
