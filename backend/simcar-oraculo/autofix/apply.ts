import { cleanDegenerateRings } from "./actions/clean-degenerate-rings";
import {
  CLIP_COVER_LAYER_CODES,
  clipLayerToCover,
} from "./actions/clip-layer-to-cover";
import { removeDuplicateVertices } from "./actions/remove-duplicate-vertices";
import { removeGluedHoles } from "./actions/remove-glued-holes";
import { splitComplexPolygon } from "./actions/split-complex-polygon";
import { unkinkSelfIntersection } from "./actions/unkink-self-intersection";
import {
  AUTOFIX_ACTION_TYPES,
  IMPORT_AUTOFIX_ACTION_TYPES,
  type ApplyFixPlanResult,
  type AutofixActionType,
  type FixAction,
  type ImportAutofixActionType,
  type LayerAction,
} from "./types";
import { rewriteZipLayer } from "./zip-rewrite";

const importActions: Record<ImportAutofixActionType, LayerAction> = {
  remove_duplicate_vertices: removeDuplicateVertices,
  clean_degenerate_rings: cleanDegenerateRings,
  unkink_self_intersection: unkinkSelfIntersection,
  remove_glued_holes: removeGluedHoles,
  split_complex_polygon: splitComplexPolygon,
};

const importActionTypes = new Set<string>(IMPORT_AUTOFIX_ACTION_TYPES);
const autofixActionTypes = new Set<string>(AUTOFIX_ACTION_TYPES);

const actions: Record<
  AutofixActionType,
  { action: LayerAction; relatedLayers?: string[] }
> = {
  ...Object.fromEntries(
    Object.entries(importActions).map(([type, action]) => [type, { action }])
  ),
  clip_layer_to_cover: {
    action: clipLayerToCover,
    relatedLayers: [...CLIP_COVER_LAYER_CODES],
  },
} as Record<
  AutofixActionType,
  { action: LayerAction; relatedLayers?: string[] }
>;

async function applyActions(
  zipBuffer: Buffer,
  requestedActions: FixAction[]
): Promise<ApplyFixPlanResult> {
  let currentZip = zipBuffer;
  const diffResumo: ApplyFixPlanResult["diffResumo"] = [];

  for (const requested of requestedActions) {
    if (!autofixActionTypes.has(requested.type)) {
      throw new Error(`Ação desconhecida ou não permitida: ${requested.type}.`);
    }
    const actionType = requested.type as AutofixActionType;
    const implementation = actions[actionType];
    const layers = [
      ...new Set(
        requested.layers
          .map(layer => String(layer || "").trim())
          .filter(Boolean)
      ),
    ];
    if (!layers.length)
      throw new Error(`Ação ${requested.type} não informou nenhuma camada.`);
    for (const layer of layers) {
      const rewritten = await rewriteZipLayer({
        zipBuffer: currentZip,
        layer,
        actionType,
        action: implementation.action,
        relatedLayers: implementation.relatedLayers,
      });
      currentZip = rewritten.zipBuffer;
      diffResumo.push(rewritten.diff);
    }
  }
  return { novoZip: currentZip, diffResumo };
}

/** Aplica o inventário completo; a fase do pipeline limita quais ações chegam aqui. */
export async function applyFixActions(
  zipBuffer: Buffer,
  requestedActions: FixAction[]
): Promise<ApplyFixPlanResult> {
  return applyActions(zipBuffer, requestedActions);
}

/** Aplica ações em ordem; cada passo recebe exatamente o ZIP produzido pelo anterior. */
export async function applyImportFixActions(
  zipBuffer: Buffer,
  requestedActions: FixAction[]
): Promise<ApplyFixPlanResult> {
  for (const requested of requestedActions) {
    if (!importActionTypes.has(requested.type)) {
      throw new Error(
        `Ação ${requested.type} ainda não pertence ao autofix de importação.`
      );
    }
  }
  return applyActions(zipBuffer, requestedActions);
}
