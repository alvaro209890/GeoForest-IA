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
