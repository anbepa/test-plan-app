export const environment = {
  production: true,
  
  useGeminiProxy: true,
  geminiApiUrl: '/api/gemini-proxy',
  geminiApiKey: '',
  geminiApiEndpoint: '',
  
  // Variables de entorno para producción - se reemplazarán en build time por Vercel
  // Si no se reemplazan, se mostrarán los placeholders y la app mostrará error
  supabaseUrl: '${SUPABASE_URL}',
  supabaseKey: '${SUPABASE_SERVICE_KEY}',
  
  apiTimeout: 30000,
  maxRetries: 3,
  
  features: {
    useDatabase: true,
    enableRealtime: false,
    enableAuth: false
  }
};
