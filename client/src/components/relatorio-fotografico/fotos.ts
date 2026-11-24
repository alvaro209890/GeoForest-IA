/**
 * Leitura das fotos no navegador e da resposta da IA (SSE) da aba Fotos.
 *
 * Cada foto é reduzida duas vezes antes de sair do navegador:
 * - `iaBase64` (lado maior 900 px): vai para a IA, que só precisa reconhecer o assunto;
 * - `base64` (lado maior 1400 px): vai para o Word (15 cm a ~240 dpi).
 * Assim a análise sobe bem menos dados e o Word continua nítido.
 */
import { orientacaoDe, type Orientacao } from '../../../../shared/relatorio-fotografico/layout';

export type FotoLocal = {
  id: string;
  nome: string;
  tamanho: number;
  base64: string;
  iaBase64: string;
  previewUrl: string;
  width: number;
  height: number;
  orientation: Orientacao;
};

export type ParcialLocal = {
  key: string;
  titulo: string;
  legenda: string;
  fotoIds: string[];
};

export type FotoFora = { id: string; motivo: string };

export type SelecaoResposta = {
  resumo?: string;
  parciais?: Array<{
    titulo?: string;
    legenda?: string;
    fotos?: Array<{ id?: string; motivo?: string } | string>;
  }>;
  excluidas?: Array<{ id?: string; motivo?: string }>;
};

/** Em que ponto a organização com IA está. */
export type FaseAnalise = 'enviando' | 'recebidas' | 'pensando' | 'escrevendo';

export const MAX_FOTOS = 50;
const LADO_WORD = 1400;
const LADO_IA = 900;

export function novoId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function carregarImagem(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(file.name));
    };
    img.src = url;
  });
}

function reduzir(img: HTMLImageElement, ladoMaximo: number, qualidade: number) {
  const escala = Math.min(1, ladoMaximo / Math.max(img.naturalWidth, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * escala));
  const height = Math.max(1, Math.round(img.naturalHeight * escala));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);
  const dataUrl = canvas.toDataURL('image/jpeg', qualidade);
  return { dataUrl, base64: dataUrl.split(',')[1] || '', width, height };
}

export async function lerArquivo(file: File): Promise<FotoLocal> {
  const img = await carregarImagem(file);
  const word = reduzir(img, LADO_WORD, 0.82);
  const ia = reduzir(img, LADO_IA, 0.72);
  return {
    id: novoId(),
    nome: file.name,
    tamanho: file.size,
    base64: word.base64,
    iaBase64: ia.base64,
    previewUrl: ia.dataUrl,
    width: word.width,
    height: word.height,
    orientation: orientacaoDe(word.width, word.height),
  };
}

/** Fotos de câmera saem em ordem pelo nome (IMG_0001, IMG_0002...). */
export function ordenarPorNome(files: File[]): File[] {
  return [...files].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }));
}

export function ehHeic(file: File): boolean {
  return /\.(heic|heif)$/i.test(file.name) || /image\/hei[cf]/i.test(file.type);
}

export type ResultadoAnalise = { selecao: SelecaoResposta; modelo: string };

export async function lerEventos(
  response: Response,
  onFase: (fase: FaseAnalise, mensagem: string) => void,
): Promise<ResultadoAnalise> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('O servidor não respondeu.');
  const decoder = new TextDecoder();
  let buffer = '';
  let final: ResultadoAnalise | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      let event: any;
      try {
        event = JSON.parse(line.slice(6));
      } catch {
        continue;
      }
      if (event.type === 'progress') {
        const fase = ['recebidas', 'pensando', 'escrevendo'].includes(event.fase) ? event.fase : 'pensando';
        onFase(fase, String(event.message || ''));
      }
      if (event.type === 'error') throw new Error(event.message || 'A IA não conseguiu organizar as fotos.');
      if (event.type === 'complete') {
        final = { selecao: event.selecao || {}, modelo: String(event.modelo || '') };
      }
    }
  }
  if (!final) throw new Error('A análise terminou sem resposta. Tente de novo.');
  return final;
}

export function tempoDecorrido(segundos: number): string {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
