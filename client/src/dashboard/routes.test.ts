import { describe, expect, it } from 'vitest';
import { getPathForView, getViewFromPath } from './routes';
import type { DashboardView } from './types';

describe('dashboard routes', () => {
  const cases: Array<[string, DashboardView]> = [
    ['/dashboard', 'simcar-clip'],
    ['/dashboard/simcar', 'simcar-clip'],
    ['/dashboard/recibos', 'simcar-receipts'],
    ['/dashboard/cbers', 'cbers-wpm'],
    ['/dashboard/landsat', 'landsat'],
    ['/dashboard/erros', 'vertices-proximas'],
    ['/dashboard/auas', 'auas-sccon'],
    ['/dashboard/manual', 'features'],
    ['/dashboard/configuracoes', 'settings'],
    ['/dashboard/chat', 'simcar-clip'],
    ['/dashboard/cbers/job/123', 'cbers-wpm'],
    ['/dashboard/unknown', 'simcar-clip'],
  ];

  it.each(cases)('getViewFromPath(%s) → %s', (path, view) => {
    expect(getViewFromPath(path)).toBe(view);
  });

  it('getPathForView é o inverso canônico das views principais', () => {
    const views: DashboardView[] = [
      'simcar-clip',
      'simcar-receipts',
      'cbers-wpm',
      'landsat',
      'vertices-proximas',
      'auas-sccon',
      'features',
      'settings',
    ];
    for (const view of views) {
      const path = getPathForView(view);
      expect(getViewFromPath(path)).toBe(view);
    }
  });
});
