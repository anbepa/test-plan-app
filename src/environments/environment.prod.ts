export const environment = {
    production: true,
    geminiApiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
     // En producción, esta clave DEBE ser manejada por un backend seguro.
    // Puedes poner un valor dummy aquí si siempre usarás un proxy.
    geminiApiKey: 'CLAVE_PROD_SEGURA_O_VACIA_SI_USAS_PROXY',
  };