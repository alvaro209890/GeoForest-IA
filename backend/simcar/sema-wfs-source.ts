/**
 * Fonte vetorial obrigatória do recorte SIMCAR.
 *
 * O nome do arquivo é mantido por compatibilidade, mas a fonte não é mais o
 * WFS remoto consultado durante cada job. O recorte usa o snapshot oficial
 * baixado mensalmente da SEMA, validado e publicado no GeoServer local.
 */
import {
  fetchLocalSimcarBboxFeatures,
  getLocalSimcarLayerNames,
  LocalSimcarSourceError,
  readValidatedSimcarSnapshot,
  resolveLocalSimcarWfsLayer,
  type SimcarSnapshotInfo,
} from "./local-wfs-client";
import type { WfsClipFetchResult } from "./types";

export const SIMCAR_SNAPSHOT_UNAVAILABLE_MESSAGE =
  "A cópia mensal oficial do SIMCAR Digital está indisponível ou inválida. O recorte foi cancelado e nenhum ZIP parcial foi gerado.";

export type SimcarSnapshotSourceFailure = "unavailable" | "partial" | "invalid";

export class SimcarSnapshotSourceError extends Error {
  readonly code = "SIMCAR_SNAPSHOT_SOURCE_UNAVAILABLE";

  constructor(
    message: string,
    readonly failure: SimcarSnapshotSourceFailure,
    readonly layerName?: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "SimcarSnapshotSourceError";
  }
}

export type SimcarSnapshotMapping = {
  layers: Map<string, string>;
  snapshot: SimcarSnapshotInfo;
};

export type SimcarSnapshotSourceDependencies = {
  readSnapshot: () => SimcarSnapshotInfo;
  getCapabilities: () => Promise<Set<string>>;
  resolveLayer: typeof resolveLocalSimcarWfsLayer;
  fetchByBbox: typeof fetchLocalSimcarBboxFeatures;
};

const DEFAULT_DEPS: SimcarSnapshotSourceDependencies = {
  readSnapshot: readValidatedSimcarSnapshot,
  getCapabilities: getLocalSimcarLayerNames,
  resolveLayer: resolveLocalSimcarWfsLayer,
  fetchByBbox: fetchLocalSimcarBboxFeatures,
};

function sourceError(
  error: unknown,
  failure: SimcarSnapshotSourceFailure,
  layerName?: string,
): SimcarSnapshotSourceError {
  if (error instanceof SimcarSnapshotSourceError) return error;
  const message = error instanceof LocalSimcarSourceError
    ? error.message
    : SIMCAR_SNAPSHOT_UNAVAILABLE_MESSAGE;
  return new SimcarSnapshotSourceError(message, failure, layerName, { cause: error });
}

export async function loadSimcarSnapshotLayerMapping(
  templateLayers: readonly string[],
  deps: SimcarSnapshotSourceDependencies = DEFAULT_DEPS,
): Promise<SimcarSnapshotMapping> {
  try {
    const snapshot = deps.readSnapshot();
    const published = await deps.getCapabilities();
    const layers = new Map<string, string>();

    for (const templateLayer of templateLayers) {
      const typeName = deps.resolveLayer(templateLayer);
      if (!typeName) continue;
      const storeName = typeName.split(":").pop() || "";
      if (!snapshot.storeNames.has(storeName)) continue;
      if (!published.has(typeName) && !published.has(storeName)) continue;
      layers.set(templateLayer, typeName);
    }

    const required = ["AREA_CONSOLIDADA", "AUAS", "AVN", "RIO_ATE_10"];
    const missing = required.filter((layerName) =>
      templateLayers.includes(layerName) && !layers.has(layerName)
    );
    if (missing.length > 0) {
      throw new SimcarSnapshotSourceError(
        `A cópia mensal oficial está incompleta: ${missing.join(", ")}. O recorte foi cancelado e nenhum ZIP foi gerado.`,
        "invalid",
      );
    }
    return { layers, snapshot };
  } catch (error) {
    throw sourceError(error, "unavailable");
  }
}

export async function fetchCompleteSimcarSnapshotLayer(
  args: {
    layerName: string;
    typeName: string;
    bbox: [number, number, number, number];
  },
  deps: SimcarSnapshotSourceDependencies = DEFAULT_DEPS,
): Promise<WfsClipFetchResult> {
  let result: WfsClipFetchResult;
  try {
    result = await deps.fetchByBbox(args.typeName, args.bbox);
  } catch (error) {
    throw sourceError(error, "unavailable", args.layerName);
  }

  if (!result || !Array.isArray(result.features)) {
    throw new SimcarSnapshotSourceError(
      `A cópia mensal oficial devolveu uma resposta inválida para ${args.layerName}. O recorte foi cancelado.`,
      "invalid",
      args.layerName,
    );
  }
  if (result.partial) {
    throw new SimcarSnapshotSourceError(
      `A consulta da cópia mensal oficial ficou incompleta em ${args.layerName}. O recorte foi cancelado e nenhum ZIP parcial foi gerado.`,
      "partial",
      args.layerName,
    );
  }
  return result;
}
