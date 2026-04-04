import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

export const authGuard: CanActivateFn = async (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  const isAllowed = await authService.ensureSession();

  if (isAllowed) {
    return true;
  }

  return router.createUrlTree(['/auth'], {
    queryParams: { redirectTo: state.url }
  });
};
