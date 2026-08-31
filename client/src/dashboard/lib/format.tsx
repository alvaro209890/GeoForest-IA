/**
 * Helpers puros de formatação/limpeza do Dashboard GeoForest.
 * Extraídos de Dashboard.tsx (plano 03, passo 1) — sem hooks, sem estado.
 */
import React from 'react';
import { apiUrl, resolveBackendUrl } from '@/lib/api';
import type { ChatMessage } from '@/dashboard/types/history';
import { isPlainObject } from './values';

export { isPlainObject } from './values';

export const sanitizeMessagesForFirestore = (msgs: ChatMessage[]) =>
  msgs.map((m) => {
    const meta = m.meta
      ? Object.fromEntries(Object.entries(m.meta).filter(([, v]) => v !== undefined))
      : undefined;
    const clean = {
      ...m,
      meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
    };
    if (!clean.meta) delete (clean as any).meta;
    return clean;
  });

export const stripUndefinedDeep = <T,>(value: T): T => {
  if (Array.isArray(value)) {
    return value
      .map((item) => stripUndefinedDeep(item))
      .filter((item) => item !== undefined) as T;
  }
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    Object.entries(value).forEach(([key, item]) => {
      const clean = stripUndefinedDeep(item);
      if (clean !== undefined) out[key] = clean;
    });
    return out as T;
  }
  return (value === undefined ? undefined : value) as T;
};

export const toCloudinaryDownloadUrl = (url?: string) => {
  if (!url) return '';
  if (url.includes('/upload/fl_attachment/')) return url;
  if (url.includes('/upload/')) return url.replace('/upload/', '/upload/fl_attachment/');
  return url;
};

export const toFileProxyUrl = (url?: string, name?: string, mode: 'inline' | 'download' = 'inline') => {
  if (!url) return '';
  const safeName = (name || 'documento.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return apiUrl(
    `/api/file-proxy?mode=${mode}&url=${encodeURIComponent(url)}&name=${encodeURIComponent(safeName)}`
  );
};

export const resolveBackendDownloadUrl = (downloadUrl?: string, persistentUrl?: string) => {
  const persistent = resolveBackendUrl(persistentUrl);
  if (persistent) return persistent;
  return resolveBackendUrl(downloadUrl);
};

export const renderInlineRichText = (text: string) => {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(<span key={`txt-${idx++}`}>{text.slice(cursor, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`b-${idx++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={`c-${idx++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`i-${idx++}`}>{token.slice(1, -1)}</em>);
    } else {
      parts.push(<span key={`u-${idx++}`}>{token}</span>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parts.push(<span key={`txt-${idx++}`}>{text.slice(cursor)}</span>);
  }

  return parts;
};

export const isMarkdownTableSeparator = (line: string) =>
  /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line.trim());

export const splitMarkdownTableRow = (line: string) => {
  const trimmed = String(line || '').trim();
  if (!trimmed.includes('|')) return [];
  const noEdgePipes = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const parts = noEdgePipes.split('|').map((cell) => cell.trim());
  return parts.filter((cell, idx) => cell.length > 0 || idx < parts.length - 1);
};

export const renderRichText = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (!trimmed) {
      nodes.push(<div key={`chat-gap-${key++}`} className="chat-gap" />);
      i += 1;
      continue;
    }

    const tableHeader = splitMarkdownTableRow(rawLine);
    const nextLine = lines[i + 1] || '';
    if (tableHeader.length >= 2 && isMarkdownTableSeparator(nextLine)) {
      const bodyRows: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length) {
        const rowLine = lines[cursor];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowTrimmed.includes('|')) break;
        if (isMarkdownTableSeparator(rowLine)) {
          cursor += 1;
          continue;
        }
        const cells = splitMarkdownTableRow(rowLine);
        if (cells.length < 2) break;
        bodyRows.push(cells);
        cursor += 1;
      }
      const cols = Math.max(tableHeader.length, ...bodyRows.map((r) => r.length));
      const normalizedHeader = Array.from({ length: cols }, (_, idx) => tableHeader[idx] || '');
      const normalizedBody = bodyRows.map((row) => Array.from({ length: cols }, (_, idx) => row[idx] || ''));
      nodes.push(
        <div key={`chat-table-wrap-${key++}`} className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                {normalizedHeader.map((cell, idx) => (
                  <th key={`chat-th-${idx}`}>{renderInlineRichText(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedBody.map((row, rowIdx) => (
                <tr key={`chat-tr-${rowIdx}`}>
                  {row.map((cell, cellIdx) => (
                    <td key={`chat-td-${rowIdx}-${cellIdx}`}>{renderInlineRichText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = cursor;
      continue;
    }

    const title = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (title) {
      nodes.push(
        <p key={`chat-title-${key++}`} className="chat-p font-semibold text-slate-100">
          {renderInlineRichText(title[2])}
        </p>
      );
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      nodes.push(
        <div key={`chat-ol-${key++}`} className="pl-2">
          <span className="mr-2 text-emerald-300">{numbered[1]}.</span>
          {renderInlineRichText(numbered[2])}
        </div>
      );
      i += 1;
      continue;
    }

    const bulletMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    if (bulletMatch) {
      nodes.push(
        <div key={`chat-ul-${key++}`} className="pl-2">
          <span className="mr-2 text-emerald-300">•</span>
          {renderInlineRichText(bulletMatch[1])}
        </div>
      );
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      nodes.push(
        <div key={`chat-quote-${key++}`} className="border-l-2 border-emerald-500/40 pl-3 text-slate-300/95">
          {renderInlineRichText(quote[1])}
        </div>
      );
      i += 1;
      continue;
    }

    nodes.push(
      <p key={`chat-p-${key++}`} className="chat-p">
        {renderInlineRichText(rawLine)}
      </p>
    );
    i += 1;
  }

  return nodes;
};

export const renderAnalysisRichText = (text: string) => {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const nodes: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      nodes.push(<div key={`analysis-gap-${key++}`} className="analysis-gap" />);
      i += 1;
      continue;
    }

    const tableHeader = splitMarkdownTableRow(line);
    const nextLine = lines[i + 1] || '';
    if (tableHeader.length >= 2 && isMarkdownTableSeparator(nextLine)) {
      const bodyRows: string[][] = [];
      let cursor = i + 2;
      while (cursor < lines.length) {
        const rowLine = lines[cursor];
        const rowTrimmed = rowLine.trim();
        if (!rowTrimmed || !rowTrimmed.includes('|')) break;
        if (isMarkdownTableSeparator(rowLine)) {
          cursor += 1;
          continue;
        }
        const cells = splitMarkdownTableRow(rowLine);
        if (cells.length < 2) break;
        bodyRows.push(cells);
        cursor += 1;
      }
      const cols = Math.max(tableHeader.length, ...bodyRows.map((r) => r.length));
      const normalizedHeader = Array.from({ length: cols }, (_, idx) => tableHeader[idx] || '');
      const normalizedBody = bodyRows.map((row) => Array.from({ length: cols }, (_, idx) => row[idx] || ''));
      nodes.push(
        <div key={`analysis-table-wrap-${key++}`} className="chat-table-wrap">
          <table className="chat-table">
            <thead>
              <tr>
                {normalizedHeader.map((cell, idx) => (
                  <th key={`analysis-th-${idx}`}>{renderInlineRichText(cell)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {normalizedBody.map((row, rowIdx) => (
                <tr key={`analysis-tr-${rowIdx}`}>
                  {row.map((cell, cellIdx) => (
                    <td key={`analysis-td-${rowIdx}-${cellIdx}`}>{renderInlineRichText(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = cursor;
      continue;
    }

    const divider = trimmed.match(/^[-_*]{3,}$/);
    if (divider) {
      nodes.push(<div key={`analysis-divider-${key++}`} className="analysis-divider" />);
      i += 1;
      continue;
    }

    const title = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (title) {
      const level = title[1].length;
      const klass = level === 1 ? 'analysis-h1' : level === 2 ? 'analysis-h2' : 'analysis-h3';
      nodes.push(
        <div key={`analysis-title-${key++}`} className={klass}>
          {renderInlineRichText(title[2])}
        </div>
      );
      i += 1;
      continue;
    }

    const numbered = trimmed.match(/^(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      nodes.push(
        <div key={`analysis-ol-${key++}`} className="analysis-item">
          <span className="analysis-marker">{numbered[1]}.</span>
          <span className="analysis-content">{renderInlineRichText(numbered[2])}</span>
        </div>
      );
      i += 1;
      continue;
    }

    const bullet = trimmed.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      nodes.push(
        <div key={`analysis-ul-${key++}`} className="analysis-item">
          <span className="analysis-marker">•</span>
          <span className="analysis-content">{renderInlineRichText(bullet[1])}</span>
        </div>
      );
      i += 1;
      continue;
    }

    const quote = trimmed.match(/^>\s+(.+)$/);
    if (quote) {
      nodes.push(
        <div key={`analysis-quote-${key++}`} className="analysis-quote">
          {renderInlineRichText(quote[1])}
        </div>
      );
      i += 1;
      continue;
    }

    nodes.push(
      <p key={`analysis-p-${key++}`} className="analysis-p">
        {renderInlineRichText(line)}
      </p>
    );
    i += 1;
  }

  return nodes;
};

export const normalizeImageCaption = (rawCaption: string): string => {
  const input = String(rawCaption || '').trim();
  if (!input) return 'Imagem';
  const suspicious = /Ã|Â|â€”|â€“|â€˜|â€™|â€œ|â€|â€¦/.test(input);
  if (!suspicious) return input;
  try {
    const bytes = Uint8Array.from(Array.from(input).map((ch) => ch.charCodeAt(0) & 0xff));
    const decoded = new TextDecoder('utf-8').decode(bytes).trim();
    if (decoded && !/Ã|Â|â€”|â€“|â€˜|â€™|â€œ|â€|â€¦/.test(decoded)) {
      return decoded;
    }
  } catch {
    // fallback below
  }
  return input
    .replace(/â€”/g, '—')
    .replace(/â€“/g, '–')
    .replace(/â€˜/g, '‘')
    .replace(/â€™/g, '’')
    .replace(/â€œ/g, '“')
    .replace(/â€/g, '”')
    .replace(/â€¦/g, '…')
    .replace(/Ã§/g, 'ç')
    .replace(/Ã£/g, 'ã')
    .replace(/Ã¡/g, 'á')
    .replace(/Ã©/g, 'é')
    .replace(/Ã­/g, 'í')
    .replace(/Ã³/g, 'ó')
    .replace(/Ãº/g, 'ú')
    .replace(/Ã‰/g, 'É')
    .replace(/Ã‡/g, 'Ç')
    .replace(/\s+/g, ' ')
    .trim();
};

export const normalizeBackendText = (rawText: string): string => {
  const normalized = normalizeImageCaption(String(rawText || ''));
  return normalized || String(rawText || '');
};

export const removeRoboticAuasLines = (rawText: string): string => {
  const text = String(rawText || '');
  return text
    .split('\n')
    .filter((line) => {
      const l = line.trim();
      if (!l) return true;
      if (/^[-*•]?\s*STATUS_FINAL\s*=/i.test(l)) return false;
      if (/^[-*•]?\s*ANO_PROVAVEL_INICIO_DESMATE\s*=/i.test(l)) return false;
      return true;
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};

export const buildIntegratedVectorizedReport = (acAvnText: string, auasText: string): string => {
  const acText = String(acAvnText || '').trim();
  const auasClean = removeRoboticAuasLines(auasText);
  return [
    '## Analise Integrada SIMCAR',
    '',
    '### Validacao AC e AVN',
    acText || 'Sem dados consolidados de AC/AVN.',
    '',
    '### Validacao AUAS',
    auasClean || 'Sem dados consolidados de AUAS.',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
