/**
 * Ações de download/abertura do Dashboard GeoForest (SIMCAR).
 * Plano 03 — extraídas de Dashboard.tsx (sem hooks).
 */
import { toast } from 'sonner';
import { auth } from '@/lib/firebase';
import { apiUrl, readApiError, resolveBackendUrl } from '@/lib/api';
import { normalizeImageCaption, toFileProxyUrl } from './format';
import type { SimcarAnalysisImage } from '@/dashboard/types/history';

export async function downloadSimcarZip(url?: string | null, filename = 'SIMCAR_Recorte.zip') {
  const rawUrl = String(url || '').trim();
  const resolved = resolveBackendUrl(rawUrl);
  const safeFilename = filename.replace(/[^a-zA-Z0-9._-]/g, '_') || 'SIMCAR_Recorte.zip';
  if (!resolved) {
    toast.error('Link do ZIP indisponível. Processe o recorte novamente.');
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
    const a = document.createElement('a');
    a.href = resolved;
    a.download = safeFilename;
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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
