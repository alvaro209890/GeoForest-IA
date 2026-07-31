// Helpers compartilhados para rotas de store/account
// Extraídos de backend/index.ts (plano 01)

export function normalizeStorePath(raw: unknown): string[] {
  return String(raw || "")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function materializeServerTimestamps(value: any): any {
  if (Array.isArray(value)) return value.map((item) => materializeServerTimestamps(item));
  if (value && typeof value === "object") {
    if ((value as any).__serverTimestamp === true) {
      return new Date().toISOString();
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, materializeServerTimestamps(item)]),
    );
  }
  return value;
}
