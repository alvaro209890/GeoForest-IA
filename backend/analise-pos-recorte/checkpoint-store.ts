import crypto from "crypto";
import fs from "fs";
import path from "path";

import { STORAGE_ROOT } from "../local-storage";
import type { CheckpointStore } from "./orchestrator";
import type { AuasWindowRun } from "./types";

const CHECKPOINT_DIR = path.join(STORAGE_ROOT, "auas_v2_checkpoints");

/** As três fases encadeadas da análise pós-recorte. */
export type AnalysisPhaseId = "PRE_2008" | "POS_2008" | "AC_VEG";

/**
 * Catálogo estático da Fase 1 (anos e layers fixos em `config.ts`). As fases 2 e
 * 3 descobrem os anos em tempo de execução e passam o `catalogVersion` real, que
 * invalida checkpoints quando a SEMA troca um mosaico.
 */
export const STATIC_CATALOG_VERSION = "static-pre2008";

export type PhaseCheckpointKeyInput = {
  jobId: string;
  phase: AnalysisPhaseId;
  rulesVersion: string;
  /** Versão do catálogo WMS usado nesta execução. Ausente = catálogo estático. */
  catalogVersion?: string;
  geometryHash: string;
  windowId: string;
  imageSha256s: string[];
};

/**
 * Chave de checkpoint por janela, namespaced por fase.
 *
 * Formato: `<phase>::<rulesVersion>::<catalogVersion>::<sha256 do resto>`.
 * O prefixo legível impede colisão entre fases no mesmo job e faz com que mudar
 * `rulesVersion` ou `catalogVersion` gere chave nova — ou seja, recomputa em vez
 * de reaproveitar observação feita sobre outra imagem/regra.
 */
export function buildPhaseCheckpointKey(input: PhaseCheckpointKeyInput): string {
  const catalogVersion = input.catalogVersion || STATIC_CATALOG_VERSION;
  const payload = JSON.stringify({
    jobId: input.jobId,
    geometryHash: input.geometryHash,
    windowId: input.windowId,
    images: [...input.imageSha256s].sort(),
  });
  const digest = crypto.createHash("sha256").update(payload).digest("hex");
  return `${input.phase}::${input.rulesVersion}::${catalogVersion}::${digest}`;
}

function ensureDir(): void {
  fs.mkdirSync(CHECKPOINT_DIR, { recursive: true });
}

function fileNameFor(jobId: string): string {
  const safe = crypto.createHash("sha256").update(jobId).digest("hex");
  return path.join(CHECKPOINT_DIR, `${safe}.json`);
}

function readAll(jobId: string): Record<string, AuasWindowRun> {
  try {
    const raw = fs.readFileSync(fileNameFor(jobId), "utf8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeAll(jobId: string, data: Record<string, AuasWindowRun>): void {
  ensureDir();
  const filePath = fileNameFor(jobId);
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data));
  fs.renameSync(tmpPath, filePath);
}

/**
 * Checkpoint durável em disco (um arquivo JSON por job), para retomar jobs
 * da análise pós-recorte após reinício/queda sem repetir janelas concluídas.
 *
 * O arquivo é comum às três fases — quem separa é o prefixo da chave. Chaves
 * gravadas por versões anteriores continuam legíveis (o store não interpreta a
 * chave); elas apenas não colidem com as novas.
 */
export function createFileCheckpointStore(jobId: string): CheckpointStore {
  return {
    get: (key) => readAll(jobId)[key],
    set: (key, value) => {
      const all = readAll(jobId);
      all[key] = value;
      writeAll(jobId, all);
    },
  };
}
