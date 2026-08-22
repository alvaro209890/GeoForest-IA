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

/**
 * Camadas do "Arquivo Modelo" (template SEMA) processadas no recorte.
 *
 * ⚠️ Lista CANÔNICA — 28 camadas, idêntica ao monólito `simcar-clip.ts` anterior ao
 * Plano 02 (commit 74a5c3b11 trocou por 12 nomes errados — RESERVA_LEGAL/APP/
 * HIDROGRAFIA/SERVIDAO_ADMINISTRATIVA não existem no template nem no WFS, e os 5
 * rios + 13 outras camadas sumiram do recorte). Teste de regressão em
 * `backend/simcar/constants.test.ts` trava esta lista contra o ZIP do modelo.
 */
export const TEMPLATE_LAYERS = [
    "AIR", "ATP",
    "AREA_CONSOLIDADA", "AREA_USO_RESTRITO", "INTERESSE_SOCIAL", "UTILIDADE_PUBLICA",
    "RIO_ATE_10", "RIO_10_A_50", "RIO_50_A_200", "RIO_200_A_600", "RIO_ACIMA_600",
    "NASCENTE", "RESERVATORIO_ARTIFICIAL", "LAGOA_NATURAL",
    "TIPOLOGIA_VEGETAL", "MANGUEZAL", "RESTINGA", "VEREDA",
    "AREA_ALTITUDE_1800", "AREA_DECLIVIDADE", "AREA_TOPO_MORRO", "BORDA_CHAPADA",
    "ARL", "ARLREM", "AUAS", "AURD", "AVN", "AREA_UMIDA",
] as const;

export const DIRECT_COPY_LAYERS = new Set(["AIR", "ATP"]);

/**
 * Camadas que **não saem em nenhum artefato entregue** — ZIP, XLSX de
 * quantitativos, laudo PDF e laudo DOCX.
 *
 * `TIPOLOGIA_VEGETAL` é o mapa de tipologia do imóvel inteiro: cobre ~100% da
 * área, vem truncada pelo WFS em 50.000 feições e não é declaração de nada (ver
 * o gotcha registrado em `.claude/CLAUDE.md` — somá-la à área declarada fazia
 * 100% dos polígonos saírem com alerta ALTO na Fase 3). No pacote entregue ao
 * cliente ela só polui: ocupa a maior parte do ZIP e domina a tabela do laudo
 * com um número que não significa sobreposição.
 *
 * Isto é filtro de **saída**, não de análise: a camada continua sendo recortada
 * e continua disponível internamente para as fases que a consultam.
 */
export const EXPORT_EXCLUDED_LAYERS = new Set(["TIPOLOGIA_VEGETAL"]);

/** `true` quando a camada não deve aparecer em artefato entregue. */
export function isExcludedFromExport(layerName: unknown): boolean {
    return EXPORT_EXCLUDED_LAYERS.has(String(layerName || "").trim().toUpperCase());
}

/**
 * Remove do ZIP os arquivos das camadas excluídas.
 *
 * Precisa existir porque o ZIP de saída repassa **todo** o template do
 * `Modelo.zip`: mesmo sem recorte, os `.shp/.shx/.dbf/.prj` vazios de
 * `TIPOLOGIA_VEGETAL` entrariam pelo passthrough.
 */
export function isExcludedExportEntry(entryName: unknown): boolean {
    const base = String(entryName || "").split("/").pop() || "";
    const stem = base.replace(/\.[^.]+$/, "").trim().toUpperCase();
    return EXPORT_EXCLUDED_LAYERS.has(stem);
}

/** Camadas de rio: buscadas por BBOX e recortadas com margem além da divisa (500m). */
export const RIVER_CLIP_LAYERS = new Set([
    "RIO_ATE_10",
    "RIO_10_A_50",
    "RIO_50_A_200",
    "RIO_200_A_600",
    "RIO_ACIMA_600",
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
