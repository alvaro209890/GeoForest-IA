/** Configuração centralizada do backend GeoForest. */

/** Porta do servidor — Render: 3000, local: 3001. */
export const PORT = Number(
  process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001)
);

/** Ambiente de desenvolvimento (sem CORS restrito). */
export const IS_DEVELOPMENT = process.env.NODE_ENV !== "production";

/** Origens CORS permitidas por padrão (Firebase Hosting + localhost). */
const normalizeOrigin = (value: string) =>
  value.trim().replace(/\/+$/, "").toLowerCase();

export const DEFAULT_CORS_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
  "http://127.0.0.1:4173",
  "http://127.0.0.1:3000",
  "https://ia-florestal.web.app",
  "http://ia-florestal.web.app",
  "https://ia-florestal.firebaseapp.com",
  "http://ia-florestal.firebaseapp.com",
  "https://geoforest-admin.web.app",
  "http://geoforest-admin.web.app",
  "https://geoforest-admin.firebaseapp.com",
  "http://geoforest-admin.firebaseapp.com",
].map(normalizeOrigin);

/** Regex para origens CORS permitidas. */
export const CORS_ORIGIN_REGEX = [
  /^https?:\/\/localhost(?::\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i,
  /^https?:\/\/ia-florestal\.web\.app$/i,
  /^https?:\/\/ia-florestal\.firebaseapp\.com$/i,
  /^https?:\/\/geoforest-admin\.web\.app$/i,
  /^https?:\/\/geoforest-admin\.firebaseapp\.com$/i,
];

/** Monta o conjunto de origens CORS permitidas (defaults + env). */
export function buildCorsOriginSet(): Set<string> {
  const origins = new Set(DEFAULT_CORS_ORIGINS);
  const env = process.env.CORS_ORIGINS;
  if (env) {
    env
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean)
      .forEach((o) => origins.add(normalizeOrigin(o)));
  }
  return origins;
}

/** Verifica se uma origem está na whitelist. */
export function isOriginAllowed(
  origin: string,
  originSet: Set<string>,
  regexList: RegExp[]
): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (originSet.has(normalized)) return true;
  return regexList.some((re) => re.test(normalized));
}

/** Informações do ambiente Render (nulo se local). */
export const RENDER_INFO = {
  provider: process.env.RENDER ? "render" : "local",
  service: process.env.RENDER_SERVICE_NAME || null,
  instance: process.env.RENDER_INSTANCE_ID || null,
  region: process.env.RENDER_REGION || null,
  commit: process.env.RENDER_GIT_COMMIT || null,
} as const;

/** Keep-alive (ping periódico para evitar cold start). */
export const KEEP_ALIVE_URL = process.env.KEEP_ALIVE_URL;
export const KEEP_ALIVE_INTERVAL_MS = Number(
  process.env.KEEP_ALIVE_INTERVAL_MS ?? "300000"
);
