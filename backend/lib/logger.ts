/**
 * Logger estruturado em JSON para o backend.
 * Extraído de backend/index.ts (plano 01).
 */

export type LogLevel = "info" | "warn" | "error";

export interface Logger {
  (event: string, payload: Record<string, unknown>, level?: LogLevel): void;
}

export function createLogger(
  bootId: string,
  renderInfo: Record<string, unknown>,
): Logger {
  return (event, payload, level = "info") => {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event,
      bootId,
      ...renderInfo,
      ...payload,
    });
    if (level === "error") {
      console.error(line);
      return;
    }
    if (level === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };
}
