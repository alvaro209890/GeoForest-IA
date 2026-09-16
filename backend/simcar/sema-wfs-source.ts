/**
 * Fonte vetorial obrigatoria do recorte automatico SIMCAR.
 *
 * O recorte usa exclusivamente o WFS oficial da SEMA-MT. A copia local pode
 * continuar existindo para outros fluxos, mas nunca e fallback do recorte: se
 * o WFS falhar ou devolver uma pagina truncada, o job para sem gerar ZIP.
 */
import { getCapabilitiesCached } from "../wfs-intersection";
import { discoverLayerMapping } from "./shapefile-io";
import { fetchWfsBboxFeatures, fetchWfsClipFeatures } from "./wfs-client";
import type { WfsClipFetchResult } from "./types";

export const SEMA_WFS_UNAVAILABLE_MESSAGE =
  "O WFS da SEMA-MT está indisponível. O recorte foi cancelado e nenhum ZIP parcial foi gerado. Tente novamente quando o serviço voltar.";

export type SemaWfsSourceFailure = "unavailable" | "partial" | "invalid";

export class SemaWfsSourceError extends Error {
  readonly code = "SEMA_WFS_SOURCE_UNAVAILABLE";

  constructor(
    message: string,
    readonly failure: SemaWfsSourceFailure,
    readonly layerName?: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = "SemaWfsSourceError";
  }
}

type CapabilitiesResult = Awaited<ReturnType<typeof getCapabilitiesCached>>;

export type SemaWfsSourceDependencies = {
  getCapabilities: (forceRefresh: boolean) => Promise<CapabilitiesResult>;
  discoverMapping: typeof discoverLayerMapping;
  fetchByBbox: typeof fetchWfsBboxFeatures;
  fetchByPolygon: typeof fetchWfsClipFeatures;
};

const DEFAULT_DEPS: SemaWfsSourceDependencies = {
  getCapabilities: getCapabilitiesCached,
  discoverMapping: discoverLayerMapping,
  fetchByBbox: fetchWfsBboxFeatures,
  fetchByPolygon: fetchWfsClipFeatures,
};

function unavailableError(
  cause: unknown,
  layerName?: string
): SemaWfsSourceError {
  return new SemaWfsSourceError(
    SEMA_WFS_UNAVAILABLE_MESSAGE,
    "unavailable",
    layerName,
    { cause }
  );
}

export async function loadSemaWfsLayerMapping(
  templateLayers: readonly string[],
  deps: SemaWfsSourceDependencies = DEFAULT_DEPS
): Promise<Map<string, string>> {
  try {
    // O refresh é proposital: cache antigo não pode mascarar uma queda atual.
    const capabilities = await deps.getCapabilities(true);
    const mapping = deps.discoverMapping(templateLayers, [
      ...capabilities.layerNames,
    ]);
    if (capabilities.featureTypeCount <= 0 || mapping.size <= 0) {
      throw new Error("GetCapabilities sem camadas SIMCAR utilizáveis");
    }
    return mapping;
  } catch (error) {
    if (error instanceof SemaWfsSourceError) throw error;
    throw unavailableError(error);
  }
}

export async function fetchCompleteSemaWfsLayer(
  args: {
    layerName: string;
    typeName: string;
    polygonWkt?: string;
    bbox?: [number, number, number, number];
    srsName?: string;
  },
  deps: SemaWfsSourceDependencies = DEFAULT_DEPS
): Promise<WfsClipFetchResult> {
  let result: WfsClipFetchResult;
  try {
    if (args.bbox) {
      result = await deps.fetchByBbox(
        args.typeName,
        args.bbox,
        args.srsName || "EPSG:4674"
      );
    } else if (args.polygonWkt) {
      result = await deps.fetchByPolygon(
        args.typeName,
        args.polygonWkt,
        args.srsName || "EPSG:4674"
      );
    } else {
      throw new SemaWfsSourceError(
        `Consulta WFS inválida para a camada ${args.layerName}. O recorte foi cancelado e nenhum ZIP foi gerado.`,
        "invalid",
        args.layerName
      );
    }
  } catch (error) {
    if (error instanceof SemaWfsSourceError) throw error;
    throw unavailableError(error, args.layerName);
  }

  if (!result || !Array.isArray(result.features)) {
    throw new SemaWfsSourceError(
      `O WFS da SEMA-MT devolveu uma resposta inválida para a camada ${args.layerName}. O recorte foi cancelado e nenhum ZIP parcial foi gerado.`,
      "invalid",
      args.layerName
    );
  }
  if (result.partial) {
    throw new SemaWfsSourceError(
      `O WFS da SEMA-MT devolveu dados incompletos para a camada ${args.layerName}. O recorte foi cancelado e nenhum ZIP parcial foi gerado.`,
      "partial",
      args.layerName
    );
  }
  return result;
}
