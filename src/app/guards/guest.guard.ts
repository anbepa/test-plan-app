import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

export const guestGuard: CanActivateFn = async (route) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const hasSession = await authService.ensureSession();

  if (!hasSession) {
    return true;
  }

  const redirectTo = route.queryParamMap.get('redirectTo') || '/welcome';
  return router.createUrlTree([redirectTo === '/auth' ? '/welcome' : redirectTo]);
};