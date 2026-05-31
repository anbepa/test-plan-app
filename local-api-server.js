require('dotenv').config({ path: '.env.local' });
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = 3000;

// Configuración básica
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Logging inicial
console.log('\n[0] [dotenv@17.2.3] injecting env from .env.local');
console.log('[0] ');
console.log(`[0] [SERVER] Local API server running on http://localhost:${PORT}`);
console.log(`[0] [ENDPOINT] http://localhost:${PORT}/api/gemini-proxy`);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
if (GEMINI_API_KEY) {
    console.log('[0] [API_KEY] GEMINI_API_KEY: Configured');
} else {
    console.warn('[0] [API_KEY] GEMINI_API_KEY: NOT FOUND in .env.local');
}

const MODEL_NAME = 'gemini-2.5-flash-lite';
console.log(`[0] [MODEL] Using ${MODEL_NAME} (v1 REST API)`);
console.log('[0] ');

async function resolveImageUrls(apiBody) {
    if (!apiBody || !apiBody.contents) return;

    for (const content of apiBody.contents) {
        if (!content.parts) continue;

        const resolvedParts = [];
        for (const part of content.parts) {
            if (part.image_url) {
                const url = part.image_url;
                try {
                    console.log(`[PROXY-LOCAL] Resolviendo imagen: ${url}`);
                    const res = await fetch(url);

                    if (!res.ok) {
                        console.error(`[PROXY-LOCAL] Error descarga (${res.status}): ${url}`);
                        continue;
                    }

                    const buffer = await res.buffer();
                    const mimeType = res.headers.get('content-type') || 'image/jpeg';
                    const base64 = buffer.toString('base64');

                    resolvedParts.push({
                        inline_data: {
                            mime_type: mimeType,
                            data: base64
                        }
                    });
                } catch (e) {
                    console.error(`[PROXY-LOCAL] Error procesando URL:`, e.message);
                }
            } else {
                resolvedParts.push(part);
            }
        }
        content.parts = resolvedParts;
    }
}

// Proxy para Gemini
app.post('/api/gemini-proxy', async (req, res) => {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: {
                code: 500,
                message: 'GEMINI_API_KEY not configured in .env.local',
                status: 'INTERNAL_ERROR'
            }
        });
    }

    try {
        const { payload } = req.body;
        const apiBody = payload || req.body;

        // RESOLVER URLs ANTES DE LLAMAR A GEMINI
        await resolveImageUrls(apiBody);

        console.log(`[API] Calling Original Google API - Model: ${MODEL_NAME}`);

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(apiBody)
        });

        const responseData = await response.json();

        // Enviar respuesta original (incluyendo errores de Google)
        if (!response.ok || responseData.error) {
            console.error('[API] Google API returned an error:', responseData.error || responseData);
            return res.status(response.status).json(responseData);
        }

        console.log('[API] Success response from Google');
        return res.json(responseData);

    } catch (error) {
        console.error('[API] Fatal Error calling Google API:', error.message);
        return res.status(500).json({
            error: {
                code: 500,
                message: 'Fatal error connecting to Google API: ' + error.message,
                status: 'INTERNAL_ERROR'
            }
        });
    }
});

app.listen(PORT, () => {
    // Servidor listo
});
