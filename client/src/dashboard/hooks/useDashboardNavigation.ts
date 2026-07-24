import { useCallback } from 'react';
import { useLocation } from 'wouter';
import { getPathForView } from '../routes';
import type { DashboardView } from '../types';

/**
 * Navegação do Dashboard sincronizada com a URL.
 * Evita setActiveView isolado (que quebrava deep link / refresh / histórico).
 */
export function useDashboardNavigation(setActiveView: (view: DashboardView) => void) {
  const [, setLocation] = useLocation();

  const navigateView = useCallback(
    (view: DashboardView) => {
      setActiveView(view);
      setLocation(getPathForView(view));
    },
    [setActiveView, setLocation],
  );

  return { navigateView, setLocation };
}
