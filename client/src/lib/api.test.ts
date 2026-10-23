import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiUrl, CONFIGURED_API_BASE } from './api';

vi.mock('@/lib/auth', () => ({ getCurrentUserAsync: vi.fn() }));

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

describe('links salvos antes da troca do endereço da API', () => {
  const currentBase = 'https://geoforest-download-test.trycloudflare.com';

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('VITE_API_BASE', currentBase);
  });

  afterEach(() => vi.unstubAllEnvs());

  it('usa a conexão atual para baixar um recorte salvo com o domínio antigo', async () => {
    const { resolveBackendUrl } = await import('./api');
    expect(resolveBackendUrl('https://geoforest-api.cursar.space/api/simcar/clip/download/job-1?format=zip#download'))
      .toBe(`${currentBase}/api/simcar/clip/download/job-1?format=zip#download`);
  });

  it('resolve os ZIPs topológicos e caminhos relativos pela mesma conexão', async () => {
    const { resolveBackendUrl } = await import('./api');
    expect(resolveBackendUrl('https://geoforest-api.cursar.space/api/simcar/clip/download/job-1/topologia'))
      .toBe(`${currentBase}/api/simcar/clip/download/job-1/topologia`);
    expect(resolveBackendUrl('/api/simcar/clip/download/job-1'))
      .toBe(`${currentBase}/api/simcar/clip/download/job-1`);
    expect(resolveBackendUrl('https://geoforest-api.cursar.space/api/storage/users/user-1/simcar/output/recorte.zip'))
      .toBe(`${currentBase}/api/storage/users/user-1/simcar/output/recorte.zip`);
    expect(resolveBackendUrl('')).toBe('');
  });

  it('preserva arquivos externos e não confunde outros hosts com a API GeoForest', async () => {
    const { resolveBackendUrl } = await import('./api');
    for (const url of [
      'https://res.cloudinary.com/geoforest/raw/upload/recorte.zip',
      'https://external.example/api/download/file.zip',
      'https://geoforest-api.cursar.space.external.example/api/download/file.zip',
      'https://geoforest-api.cursar.space/arquivo.zip',
      `${currentBase}/api/simcar/clip/download/job-1`,
    ]) expect(resolveBackendUrl(url)).toBe(url);
  });

  it('funciona com a própria origem quando não há uma base configurada', async () => {
    vi.stubEnv('VITE_API_BASE', '');
    const { resolveBackendUrl } = await import('./api');
    expect(resolveBackendUrl('https://geoforest-api.cursar.space/api/simcar/clip/download/job-1'))
      .toBe('/api/simcar/clip/download/job-1');
  });
});
