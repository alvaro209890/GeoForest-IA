/**
 * Helpers puros do fluxo de análise SIMCAR (plano 03, passo 11).
 * Extraídos do Dashboard.tsx — sem estado, sem hooks.
 */

/** Divide conteúdo bruto em texto limpo + thinking (blocos <think>...</think>). */
export function splitThinkContent(raw: string): {
  cleanText: string;
  thinkingText: string;
} {
  const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
  const thinkParts: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = thinkRegex.exec(raw)) !== null) {
    thinkParts.push((match[1] || '').trim());
  }
  const cleanText = raw.replace(thinkRegex, '').trim();
  return {
    cleanText: cleanText || 'Desculpe, não consegui formular uma resposta.',
    thinkingText: thinkParts.join('\n\n').trim(),
  };
}

/** Lê um File como Data URL. */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Falha ao ler arquivo anexado.'));
    reader.readAsDataURL(file);
  });
}

/** Lê um File e retorna o payload base64 (sem prefixo data:*). */
export async function readFileAsBase64Payload(file: File): Promise<string> {
  const dataUrl = await readFileAsDataUrl(file);
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('Falha ao preparar arquivo ZIP para envio.');
  return dataUrl.slice(comma + 1);
}

/**
 * Sinaliza parada do stream SSE (equivalente ao antigo `break readLoop`).
 * Lançado pelo callback de evento e capturado pelo `readSseEvents`.
 */
export class SseStopError extends Error {
  constructor() {
    super('SSE_STOP');
    this.name = 'SseStopError';
  }
}

/**
 * Lê um stream SSE (`data: {...}\n`) e invoca `onEvent` para cada evento parseado.
 * Ignora linhas malformadas (try/catch interno). Usado pelos fluxos de análise SIMCAR.
 * O callback pode lançar `SseStopError` para interromper a leitura imediatamente.
 */
export async function readSseEvents(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (event: any) => void | Promise<void>
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (!payload) continue;
      let event: any;
      try {
        event = JSON.parse(payload);
      } catch {
        continue; // ignore malformed SSE frame
      }
      try {
        await onEvent(event);
      } catch (err) {
        if (err instanceof SseStopError) return;
        throw err;
      }
    }
  }
}
