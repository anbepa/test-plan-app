/**
 * Configuración para aumentar límites de payload en desarrollo local
 * También puedes usar esto como referencia para cambios en Vercel
 */

// En express/vercel function, antes de las rutas:
import express from 'express';

const app = express();

// Aumentar el límite de payload para multipart/form-data y JSON
app.use(express.json({ limit: '10mb' })); // 10MB para JSON
app.use(express.urlencoded({ limit: '10mb', extended: true })); // 10MB para URL encoded
app.use(express.raw({ limit: '10mb', type: 'application/octet-stream' })); // 10MB para binary

// Para rutas específicas de Azure DevOps
app.post('/api/integrations/azure-devops/*', express.json({ limit: '15mb' }));

export default app;
