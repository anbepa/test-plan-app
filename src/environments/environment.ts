// src/environments/environment.ts
export const environment = {
  production: false,
  // Apunta a la ruta de tu proxy que `vercel dev` servirá localmente
  geminiApiUrl: 'http://localhost:3000/api/gemini-proxy', // El puerto puede variar
  // geminiApiKey: '', // Ya no se usa en el frontend
};