import { describe, expect, it } from 'vitest';
import { apiUrl, CONFIGURED_API_BASE } from './api';

describe('lib/api', () => {
  it('apiUrl preserva path relativo quando não há base configurada, ou prefixa a base', () => {
    const path = '/api/health';
    const result = apiUrl(path);
    if (CONFIGURED_API_BASE) {
      expect(result).toBe(`${CONFIGURED_API_BASE}/api/health`);
    } else {
      expect(result).toBe(path);
    }
  });

  it('apiUrl com string vazia retorna a base (ou vazio)', () => {
    expect(apiUrl('')).toBe(CONFIGURED_API_BASE || '');
  });
});
