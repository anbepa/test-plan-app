export const environment = {
  production: true,
  
  useGeminiProxy: true,
  geminiApiUrl: '/api/gemini-proxy',
  geminiApiKey: '',
  geminiApiEndpoint: '',
  
  // Variables de entorno para producción - se reemplazarán en build time por Vercel
  supabaseUrl: '${SUPABASE_URL}',
  supabaseKey: '${SUPABASE_KEY}',
  
  apiTimeout: 30000,
  maxRetries: 3,
  
  features: {
    useDatabase: true,
    enableRealtime: false,
    enableAuth: false
  }
};
