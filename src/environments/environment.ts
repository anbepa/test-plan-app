export const environment = {
  production: false,
  
  useGeminiProxy: true,
  geminiApiUrl: '/api/gemini-proxy',
  geminiApiKey: '',
  geminiApiEndpoint: '',
  
  // Variables de entorno para desarrollo local
  // No exponer credenciales en el repositorio
  supabaseUrl: 'https://pcygnqzxryaqiyhqfosi.supabase.co',
  supabaseKey: '${SUPABASE_KEY}',
  
  apiTimeout: 30000,
  maxRetries: 3,
  
  features: {
    useDatabase: true,
    enableRealtime: false,
    enableAuth: true
  }
};
