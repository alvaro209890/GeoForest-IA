const TRUE_VALUES = new Set(["1", "true", "TRUE", "True"]);
const FALSE_VALUES = new Set(["0", "false", "FALSE", "False"]);

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (TRUE_VALUES.has(raw)) return true;
  if (FALSE_VALUES.has(raw)) return false;
  throw new Error(
    `Variável de ambiente ${name} inválida: "${raw}". Use true/false/1/0.`
  );
}

function readInt(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Variável de ambiente ${name} inválida: "${raw}". Use um inteiro.`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Error(`Variável de ambiente ${name}=${value} abaixo do mínimo ${opts.min}.`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Error(`Variável de ambiente ${name}=${value} acima do máximo ${opts.max}.`);
  }
  return value;
}

function readNumber(name: string, fallback: number, opts: { min?: number; max?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Variável de ambiente ${name} inválida: "${raw}". Use um número.`);
  }
  if (opts.min !== undefined && value < opts.min) {
    throw new Error(`Variável de ambiente ${name}=${value} abaixo do mínimo ${opts.min}.`);
  }
  if (opts.max !== undefined && value > opts.max) {
    throw new Error(`Variável de ambiente ${name}=${value} acima do máximo ${opts.max}.`);
  }
  return value;
}

function readString(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
}

export type AuasV2Config = {
  enabled: boolean;
  phase2Enabled: boolean;
  phase3Enabled: boolean;
  visionModel: string;
  textModel: string;
  visionMaxImages: number;
  visionReasoningEffort: string;
  visionTimeoutMs: number;
  deepseekTimeoutMs: number;
  maxPolygonsPerJob: number;
};

/** Recalcula config a cada chamada — env pode mudar entre testes. Lança cedo em valor inválido. */
export function getAuasV2Config(): AuasV2Config {
  const visionMaxImages = readInt("SIMCAR_AUAS_VISION_MAX_IMAGES", 3, { min: 1, max: 3 });
  const maxPolygonsPerJob = readInt("SIMCAR_AUAS_MAX_POLYGONS_PER_JOB", 0, { min: 0 });
  const visionReasoningEffort = readString("SIMCAR_AUAS_VISION_REASONING_EFFORT", "none");
  if (visionReasoningEffort !== "none") {
    throw new Error(
      `SIMCAR_AUAS_VISION_REASONING_EFFORT="${visionReasoningEffort}" inválido: a Groq deve rodar com "none" nesta fase.`
    );
  }
  return {
    enabled: readBool("SIMCAR_AUAS_V2_ENABLED", false),
    phase2Enabled: readBool("SIMCAR_AUAS_POS2008_ENABLED", false),
    phase3Enabled: readBool("SIMCAR_AC_VEG_ENABLED", false),
    visionModel: readString("SIMCAR_AUAS_VISION_MODEL", "qwen/qwen3.6-27b"),
    textModel: readString("SIMCAR_AUAS_TEXT_MODEL", "deepseek-v4-pro"),
    visionMaxImages,
    visionReasoningEffort,
    visionTimeoutMs: readInt("SIMCAR_AUAS_VISION_TIMEOUT_MS", 120_000, { min: 1_000 }),
    deepseekTimeoutMs: readInt("SIMCAR_AUAS_DEEPSEEK_TIMEOUT_MS", 90_000, { min: 1_000 }),
    maxPolygonsPerJob,
  };
}

export type AcVegetacaoConfig = {
  currentLayer: string;
  nirLayer: string;
  nirStyle: string;
  nirYear: number;
  referenceLayer: string;
  minSliverM2: number;
  minDeclaredFraction: number;
  minDeclaredAreaHa: number;
};

/** Fontes da Fase 3 descobertas no GetCapabilities da SEMA (F0.1). */
export function getAcVegetacaoConfig(): AcVegetacaoConfig {
  return {
    currentLayer: readString("SIMCAR_AC_VEG_SCENE_CURRENT", "Mosaicos:SENTINEL_2_2024"),
    nirLayer: readString("SIMCAR_AC_VEG_SCENE_NIR_LAYER", "Mosaicos:SENTINEL_2_2025"),
    nirStyle: readString("SIMCAR_AC_VEG_SCENE_NIR_STYLE", "Geoportal_Sentinel_2_2025_NIR"),
    nirYear: readInt("SIMCAR_AC_VEG_SCENE_NIR_YEAR", 2025, { min: 2016, max: 2030 }),
    referenceLayer: readString("SIMCAR_AC_VEG_SCENE_REFERENCE", "Mosaicos:MOSAICO_SPOT_SEPLAN"),
    minSliverM2: readNumber("SIMCAR_AC_VEG_MIN_SLIVER_M2", 500, { min: 0 }),
    minDeclaredFraction: readNumber("SIMCAR_AC_VEG_MIN_DECLARED_FRACTION", 0.01, { min: 0, max: 1 }),
    minDeclaredAreaHa: readNumber("SIMCAR_AC_VEG_MIN_DECLARED_AREA_HA", 0.5, { min: 0 }),
  };
}

export const AUAS_REQUIRED_SOURCES: Array<{ year: 2003 | 2004 | 2005 | 2006 | 2007 | 2008; sensor: "LANDSAT_5" | "SPOT"; defaultLayer: string }> = [
  { year: 2003, sensor: "LANDSAT_5", defaultLayer: "Mosaicos:LANDSAT_5_2003" },
  { year: 2004, sensor: "LANDSAT_5", defaultLayer: "Mosaicos:LANDSAT_5_2004" },
  { year: 2005, sensor: "LANDSAT_5", defaultLayer: "Mosaicos:LANDSAT_5_2005" },
  { year: 2006, sensor: "LANDSAT_5", defaultLayer: "Mosaicos:LANDSAT_5_2006" },
  { year: 2007, sensor: "LANDSAT_5", defaultLayer: "Mosaicos:LANDSAT_5_2007" },
  { year: 2008, sensor: "SPOT", defaultLayer: "Mosaicos:MOSAICO_SPOT_SEPLAN" },
];

/** Permite override por env, ex.: SIMCAR_AUAS_LAYER_2003=Outro:Nome */
export function resolveAuasLayerName(year: number): string {
  const entry = AUAS_REQUIRED_SOURCES.find((s) => s.year === year);
  if (!entry) throw new Error(`Ano fora da série AUAS pré-2008: ${year}`);
  return readString(`SIMCAR_AUAS_LAYER_${year}`, entry.defaultLayer);
}

export const AUAS_RULES_VERSION = "auas-pre2008-v1" as const;

export const AUAS_VISION_WINDOWS = [
  { windowId: "W2003_2005" as const, years: [2003, 2004, 2005] as const },
  { windowId: "W2005_2007" as const, years: [2005, 2006, 2007] as const },
  { windowId: "W2007_2008" as const, years: [2007, 2008] as const },
];
