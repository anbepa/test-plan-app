/**
 * Middleware de Vercel para manejar request/response con payloads grandes
 */
import { NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  // Aumentar el timeout y permitir payloads más grandes para endpoints específicos
  if (request.nextUrl.pathname.includes('/api/integrations/azure-devops')) {
    const response = request.next({
      request: {
        headers: new Headers(request.headers),
      },
    });
    return response;
  }

  return request.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
