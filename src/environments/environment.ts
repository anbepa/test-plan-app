export const environment = {
  production: false,
  
  useGeminiProxy: true,
  geminiApiUrl: '/api/gemini-proxy',
  geminiApiKey: '',
  geminiApiEndpoint: '',
  
  supabaseUrl: 'https://pcygnqzxryaqiyhqfosi.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBjeWducXp4cnlhcWl5aHFmb3NpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTk3NTkwOTIsImV4cCI6MjA3NTMzNTA5Mn0.BVtAZee3SdcNDNV8fCHaaJ-dIDPlhSmsTjFvDSkgAjM',
  
  apiTimeout: 30000,
  maxRetries: 3,
  
  features: {
    useDatabase: true,
    enableRealtime: false,
    enableAuth: false
  }
};
