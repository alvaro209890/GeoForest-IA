/**
 * Constantes do módulo SIMCAR — thresholds, tabelas de lookup e configurações.
 * Extraídas de simcar-clip.ts (Plano 02).
 */
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ─── Paths ──────────────────────────────────────────────────── */

/**
 * Local do "Arquivo Modelo.zip" (template de shapefiles da SEMA usado no recorte).
 *
 * Em DEV (fonte) o módulo vive em `backend/simcar/`; em PRODUÇÃO o esbuild empacota
 * tudo em `dist/index.js`. Resolução por candidatos para funcionar nos dois mundos:
 *   1. env SIMCAR_MODELO_ZIP_PATH (override explícito);
 *   2. fonte:    backend/simcar/../../Arquivo Modelo.zip  → raiz do repo;
 *   3. dist:     dist/../Arquivo Modelo.zip               → raiz do repo;
 *   4. cwd:      a raiz do repo (systemd WorkingDirectory / dev server).
 * (Bug histórico: o candidato único `__dirname/../../` resolvia para a pasta ACIMA do
 * repo em produção — "Arquivo Modelo.zip não encontrado no servidor" no recorte.)
 */
function resolveModeloZipPath(): string {
    const fromEnv = String(process.env.SIMCAR_MODELO_ZIP_PATH || "").trim();
    if (fromEnv) return path.resolve(fromEnv);
    const candidatos = [
        path.resolve(__dirname, "..", "..", "Arquivo Modelo.zip"),
        path.resolve(__dirname, "..", "Arquivo Modelo.zip"),
        path.resolve(process.cwd(), "Arquivo Modelo.zip"),
    ];
    return candidatos.find((p) => fs.existsSync(p)) || candidatos[0];
}

export const MODELO_ZIP_PATH = resolveModeloZipPath();
export const SIMCAR_LOCAL_SHAPES_ROOT =
    process.env.SIMCAR_LOCAL_SHAPES_ROOT ||
    "/media/server/HD Backup/VETOR/CAR_Digital/current/datasets/simcar_digital";

/* ─── WFS / Cache ────────────────────────────────────────────── */

export const SEMA_CAR_REQUIRED_WFS_LAYER =
    process.env.SEMA_CAR_REQUIRED_WFS_LAYER || "Geoportal:MVW_REQUERIMENTO_ATP";
export const WFS_MAX_FEATURES = 50000;
export const CACHE_TTL_MS = 15 * 60 * 1000;       // 15 minutes
export const CACHE_MAX_JOBS = 10;
export const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes

/* ─── Layer Processing ──────────────────────────────────────── */

export const TEMPLATE_LAYERS = [
    "ATP",
    "AIR",
    "AREA_CONSOLIDADA",
    "RESERVA_LEGAL",
    "APP",
    "AVN",
    "AUAS",
    "HIDROGRAFIA",
    "NASCENTE",
    "RESERVATORIO_ARTIFICIAL",
    "LAGOA_NATURAL",
    "SERVIDAO_ADMINISTRATIVA",
] as const;

export const DIRECT_COPY_LAYERS = new Set(["AIR", "ATP"]);

export const RIVER_CLIP_LAYERS = new Set([
    "APP",
    "RESERVA_LEGAL",
    "AREA_CONSOLIDADA",
]);

export const SPRING_LAYER_NAME = "NASCENTE";
export const WHOLE_FEATURE_BUFFER_LAYERS = new Set(["RESERVATORIO_ARTIFICIAL", "LAGOA_NATURAL"]);
export const RIVER_CLIP_EXTENSION_METERS = Number(process.env.SIMCAR_RIVER_CLIP_EXTENSION_METERS || 500);

/* ─── Billing ───────────────────────────────────────────────── */

export const SIMCAR_OPERATION_BILLING_MODEL = "openai/gpt-oss-20b";

/* ─── SEMA WMS ──────────────────────────────────────────────── */

export const SEMA_WMS_BASE = process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
export const SEMA_WMS_AUTHKEY = process.env.SEMA_WMS_AUTHKEY || "541085de-9a2e-454e-bdba-eb3d57a2f492";
export const PUBLIC_API_BASE_URL = (
    process.env.PUBLIC_API_BASE_URL || "https://geoforest-api.cursar.space"
).trim().replace(/\/+$/, "");

/** Converte URLs internas (/api/...) para a URL pública da API. */
export function toPublicApiUrl(url: string | undefined | null): string {
    const clean = String(url || "").trim();
    if (!clean) return "";
    return clean.startsWith("/api/") ? `${PUBLIC_API_BASE_URL}${clean}` : clean;
}

/* ─── Satellite Layers ──────────────────────────────────────── */

export const SPOT_LAYER = "Mosaicos:MOSAICO_SPOT_SEPLAN";
export const WMS_FETCH_RETRY_ATTEMPTS = Math.max(1, Number(process.env.WMS_FETCH_RETRY_ATTEMPTS || 2));
export const WMS_RETRY_BASE_DELAY_MS = 1200;

export const AC_AVN_FIXED_KEYS = [
    "sentinel_2024",
    "sentinel_2023",
    "landsat_2022",
    "landsat_2021",
    "landsat_2020",
    "spot_2008",
] as const;

/* ─── AI Analysis ───────────────────────────────────────────── */

export const SIMCAR_ANALYSIS_MODE = String(process.env.SIMCAR_ANALYSIS_MODE || "efficient").trim().toLowerCase();
export const SIMCAR_CHAT_MAX_MESSAGES = Number(process.env.SIMCAR_CHAT_MAX_MESSAGES || 10);
export const SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE = Number(process.env.SIMCAR_CHAT_MAX_CHARS_PER_MESSAGE || 1400);
export const SIMCAR_CHAT_MAX_TOTAL_CHARS = Number(process.env.SIMCAR_CHAT_MAX_TOTAL_CHARS || 8500);
export const SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT = Number(process.env.SIMCAR_SYNTHESIS_MAX_CHARS_PER_SAT || 1800);

export const FORCE_AC_AVN_UNIFIED_ANALYSIS = true;

/* ─── Groq Rate Limiting ────────────────────────────────────── */

export const GROQ_RATE_LIMIT_DEFAULT_COOLDOWN_MS = 60_000;
export const GROQ_RATE_LIMIT_MIN_COOLDOWN_MS = 8_000;
export const GROQ_RATE_LIMIT_MAX_COOLDOWN_MS = 180_000;
export const GROQ_RATE_LIMIT_RETRY_BUFFER_MS = 3_000;

/* ─── Image Magic Bytes ─────────────────────────────────────── */

export const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
export const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff]);

/* ─── AI Continuation ───────────────────────────────────────── */

export const CONTINUATION_INSTRUCTION =
    "CONTINUE a resposta exatamente de onde parou. Não repita nada do que já foi dito. " +
    "Comece no meio da frase ou parágrafo em que a resposta anterior foi interrompida.";

/* ─── Report ────────────────────────────────────────────────── */

export const SIMCAR_REPORT_VERSION = "simcar-report-v1";
