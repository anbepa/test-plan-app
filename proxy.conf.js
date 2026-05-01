/**
 * Proxy configuration para Angular CLI
 * Versión .js en lugar de .json para poder configurar SSE (Server-Sent Events)
 * sin buffering, necesario para el modo streaming de DeepSeek.
 */
module.exports = [
  {
    context: ['/api'],
    target: 'http://localhost:3000',
    secure: false,
    changeOrigin: true,
    logLevel: 'debug',

    // Deshabilitar cualquier transformación de respuesta para que los chunks
    // SSE pasen directamente sin ser bufferizados por el proxy de webpack
    selfHandleResponse: false,

    on: {
      proxyRes: (proxyRes, req, res) => {
        // Para respuestas SSE: deshabilitar buffering en nginx/intermediarios
        if (proxyRes.headers['content-type']?.includes('text/event-stream')) {
          proxyRes.headers['x-accel-buffering'] = 'no';
          proxyRes.headers['cache-control'] = 'no-cache, no-transform';
          console.log('[PROXY] SSE response detectada, buffering deshabilitado');
        }
      },
      error: (err, req, res) => {
        console.error('[PROXY ERROR]', err.message);
        if (!res.headersSent) {
          res.writeHead(502, { 'Content-Type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
      }
    }
  }
];
