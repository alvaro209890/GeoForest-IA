import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getIdToken: vi.fn().mockResolvedValue('test-id-token'),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/firebase', () => ({ auth: { currentUser: { getIdToken: mocks.getIdToken } } }));
vi.mock('@/lib/auth', () => ({ getCurrentUserAsync: vi.fn() }));
vi.mock('sonner', () => ({ toast: { success: mocks.success, error: mocks.error } }));
vi.mock('./format', () => ({ normalizeImageCaption: vi.fn(), toFileProxyUrl: vi.fn() }));

describe('download do recorte após troca do endereço da API', () => {
  const currentBase = 'https://geoforest-download-test.trycloudflare.com';
  let fetchMock: ReturnType<typeof vi.fn>;
  let anchor: { href: string; download: string; rel: string; click: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('VITE_API_BASE', currentBase);
    anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => anchor),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    vi.stubGlobal('window', { location: { origin: 'https://ia-florestal.web.app' }, setTimeout: vi.fn() });
    fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(['PK-test-zip']), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:downloaded-zip');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('envia o token ao endereço atual e baixa o ZIP sem abrir o túnel antigo', async () => {
    const { downloadSimcarZip } = await import('./download-actions');
    await downloadSimcarZip('https://geoforest-api.cursar.space/api/simcar/clip/download/job-1', 'recorte.zip');
    expect(fetchMock).toHaveBeenCalledWith(`${currentBase}/api/simcar/clip/download/job-1`, {
      headers: { Authorization: 'Bearer test-id-token' },
    });
    expect(anchor.href).toBe('blob:downloaded-zip');
    expect(anchor.download).toBe('recorte.zip');
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it('mantém o download externo sem enviar o token Firebase para outro host', async () => {
    const { downloadSimcarZip } = await import('./download-actions');
    const externalUrl = 'https://res.cloudinary.com/geoforest/raw/upload/recorte.zip';
    await downloadSimcarZip(externalUrl);
    expect(anchor.href).toBe(externalUrl);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.getIdToken).not.toHaveBeenCalled();
  });
});
