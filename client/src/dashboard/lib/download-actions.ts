/**
 * Ações de download/abertura do Dashboard GeoForest (SIMCAR).
 * Plano 03 — extraídas de Dashboard.tsx (sem hooks).
 */
import { toast } from 'sonner';
import { auth } from '@/lib/firebase';
import { apiUrl, readApiError, resolveBackendUrl } from '@/lib/api';
import { normalizeImageCaption, toFileProxyUrl } from './format';
import type { SimcarAnalysisImage } from '@/dashboard/types/history';

/** Pathname de uma URL de download, ignorando query string e origem. */
export function zipUrlPathname(url: string): string {
  const raw = String(url || '').trim();
  if (!raw) return '';
  try {
    if (/^https?:\/\//i.test(raw)) return new URL(raw).pathname;
    return new URL(raw, 'https://geoforest.local').pathname;
  } catch {
    return raw.split('?')[0].split('#')[0];
  }
}

/**
 * ZIP do WMS CBERS/Landsat é GeoTIFF de vários GB. `fetch` + `blob()` carregaria
 * o arquivo inteiro na RAM e em geral não inicia o download. O navegador precisa
 * fazer o GET sozinho (`<a href>` real).
 */
export function isNativeAttachmentZipUrl(url: string): boolean {
  const pathname = zipUrlPathname(url);
  return (
    pathname === '/api/cbers-wpm/wms-download' ||
    pathname === '/api/landsat/wms-download' ||
    pathname.startsWith('/api/raster/')
  );
}

export function startNativeAttachmentDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'download.zip';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => a.remove(), 2000);
}

export async function downloadSimcarZip(url?: string | null, filename = 'SIMCAR_Recorte.zip') {
  const rawUrl = String(url || '').trim();
  const resolved = resolveBackendUrl(rawUrl);
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'SIMCAR_Recorte.zip';
  if (!resolved) {
    toast.error('Link do ZIP indisponível. Processe o recorte novamente.');
    return;
  }

  if (isNativeAttachmentZipUrl(rawUrl) || isNativeAttachmentZipUrl(resolved)) {
    startNativeAttachmentDownload(resolved, safeFilename);
    toast.success('Download do ZIP iniciado.');
    return;
  }

  const isBackendApiDownload = rawUrl.startsWith('/api/') || (() => {
    try {
      const parsed = new URL(resolved, window.location.origin);
      return parsed.pathname.startsWith('/api/') && parsed.origin === new URL(apiUrl('/api/health'), window.location.origin).origin;
    } catch {
      return false;
    }
  })();

  if (!isBackendApiDownload) {
    startNativeAttachmentDownload(resolved, safeFilename);
    return;
  }

  try {
    const user = auth.currentUser;
    if (!user) throw new Error('Usuário não autenticado. Faça login novamente para baixar o ZIP.');
    const token = await user.getIdToken();
    const response = await fetch(resolved, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) {
      const payload = await readApiError(response);
      throw new Error(payload?.error || `Falha ao baixar ZIP (${response.status}).`);
    }
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = safeFilename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    toast.success('Download do ZIP iniciado.');
  } catch (error: any) {
    toast.error(error?.message || 'Falha ao baixar ZIP.');
  }
}

export function openSimcarPdfInNewTab(url?: string | null) {
  const resolved = resolveBackendUrl(url || '');
  if (!resolved) {
    toast.error('Link do PDF indisponível. Gere o relatório novamente.');
    return;
  }
  window.open(resolved, '_blank', 'noopener,noreferrer');
}

/**
 * Baixa o DOCX do laudo.
 *
 * Vai pelo `file-proxy` em modo `download` porque o navegador abriria o .docx
 * numa aba em branco (o Word nao renderiza inline) — e porque e o proxy que
 * carimba o nome do arquivo que o RT vai ver na pasta de downloads.
 */
export function downloadSimcarReportDocx(url?: string | null, filename?: string | null) {
  const resolved = resolveBackendUrl(url || '');
  if (!resolved) {
    toast.error('Link do DOCX indisponível. Gere o laudo novamente.');
    return;
  }
  const safeName = String(filename || 'Laudo_Tecnico_SIMCAR.docx').trim() || 'Laudo_Tecnico_SIMCAR.docx';
  window.open(toFileProxyUrl(resolved, safeName, 'download'), '_blank', 'noopener,noreferrer');
}

export function downloadSimcarAnalysisImage(image?: SimcarAnalysisImage | null) {
  const resolved = resolveBackendUrl(image?.url || '');
  if (!resolved) {
    toast.error('Imagem indisponível para download.');
    return;
  }
  const baseName = normalizeImageCaption(image?.caption || 'imagem-simcar')
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 80) || 'imagem-simcar';
  window.open(toFileProxyUrl(resolved, `${baseName}.png`, 'download'), '_blank', 'noopener,noreferrer');
}
