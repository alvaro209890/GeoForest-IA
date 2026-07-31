/** Catálogo de modelos de IA disponíveis para o frontend. */

export const MODEL_CATALOG = [
  {
    id: "meta-llama/llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    capabilities: ["text"],
  },
  {
    id: "meta-llama/llama-4-maverick-17b-128e-instruct",
    label: "Llama 4 Maverick",
    capabilities: ["text", "vision"],
  },
  {
    id: "meta-llama/llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout",
    capabilities: ["text", "vision"],
  },
  {
    id: "meta-llama/llama-guard-4-12b",
    label: "Llama Guard 4 12B",
    capabilities: ["text", "vision"],
  },
  {
    id: "qwen/qwen3-32b",
    label: "Qwen 3 32B",
    capabilities: ["text"],
  },
  {
    id: "moonshotai/kimi-k2-instruct-0905",
    label: "Kimi K2 Instruct (0905)",
    capabilities: ["text"],
  },
  {
    id: "openai/gpt-oss-20b",
    label: "GPT-OSS 20B",
    capabilities: ["text"],
  },
  {
    id: "openai/gpt-oss-120b",
    label: "GPT-OSS 120B",
    capabilities: ["text"],
  },
] as const;

export const MODEL_IDS = new Set<string>(MODEL_CATALOG.map((model) => model.id));

export const IMAGE_ANALYSIS_MODEL =
  process.env.IMAGE_ANALYSIS_MODEL || "openai/gpt-oss-120b";

export const IMAGE_ANALYSIS_FALLBACKS = (
  process.env.IMAGE_ANALYSIS_FALLBACKS ||
  "qwen/qwen3-32b,meta-llama/llama-4-maverick-17b-128e-instruct"
)
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);
