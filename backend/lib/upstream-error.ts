/**
 * Traduz o erro de uma chamada a serviço externo (SIMCAR público, portal APF,
 * GeoServer…) em texto que diga ao usuário O QUE falhou — em vez de uma frase
 * genérica tipo "Falha ao consultar".
 *
 * Cobre os três formatos que aparecem no backend:
 *  - códigos próprios `PREFIXO_<status>` (ex.: `SIMCAR_SEARCH_503`);
 *  - `TypeError: fetch failed` do undici, cuja causa real (ECONNREFUSED,
 *    ETIMEDOUT, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT…) fica em `error.cause`;
 *  - `AbortError` de timeout.
 */

const NETWORK_CODE_TEXT: Record<string, string> = {
  ECONNREFUSED: "conexão recusada",
  ECONNRESET: "conexão encerrada pelo servidor",
  ETIMEDOUT: "tempo de conexão esgotado",
  UND_ERR_CONNECT_TIMEOUT: "tempo de conexão esgotado",
  UND_ERR_HEADERS_TIMEOUT: "servidor não respondeu a tempo",
  UND_ERR_SOCKET: "conexão interrompida",
  ENOTFOUND: "endereço não encontrado (DNS)",
  EAI_AGAIN: "falha temporária de DNS",
  CERT_HAS_EXPIRED: "certificado TLS expirado",
};

export function describeUpstreamError(error: unknown, serviceName: string): string {
  const err = error as { name?: string; message?: string; cause?: { code?: string; message?: string } };
  const message = String(err?.message || error || "").trim();

  const httpCode = message.match(/^[A-Z][A-Z0-9_]*?_(\d{3})$/);
  if (httpCode) return `${serviceName} respondeu HTTP ${httpCode[1]}.`;

  if (err?.name === "AbortError") return `${serviceName} não respondeu dentro do tempo limite.`;

  if (message === "fetch failed" || err?.cause) {
    const code = String(err?.cause?.code || "").trim();
    const text = NETWORK_CODE_TEXT[code];
    if (text) return `falha de rede ao acessar ${serviceName}: ${text} (${code}).`;
    const causeMessage = String(err?.cause?.message || "").trim();
    if (code || causeMessage) {
      return `falha de rede ao acessar ${serviceName}: ${[code, causeMessage].filter(Boolean).join(" — ")}.`;
    }
    return `falha de rede ao acessar ${serviceName}.`;
  }

  return message ? `${message.replace(/\.$/, "")}.` : `erro sem mensagem ao acessar ${serviceName}.`;
}
