import { cleanDegenerateRings } from "./actions/clean-degenerate-rings";
import { removeDuplicateVertices } from "./actions/remove-duplicate-vertices";
import { removeGluedHoles } from "./actions/remove-glued-holes";
import { splitComplexPolygon } from "./actions/split-complex-polygon";
import { unkinkSelfIntersection } from "./actions/unkink-self-intersection";
import {
  IMPORT_AUTOFIX_ACTION_TYPES,
  type ApplyFixPlanResult,
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

/** Aplica ações em ordem; cada passo recebe exatamente o ZIP produzido pelo anterior. */
export async function applyImportFixActions(
  zipBuffer: Buffer,
  actions: FixAction[]
): Promise<ApplyFixPlanResult> {
  let currentZip = zipBuffer;
  const diffResumo: ApplyFixPlanResult["diffResumo"] = [];

  for (const requested of actions) {
    if (!importActionTypes.has(requested.type)) {
      throw new Error(
        `Ação ${requested.type} ainda não pertence ao autofix de importação.`
      );
    }
    const actionType = requested.type as ImportAutofixActionType;
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
        action: importActions[actionType],
      });
      currentZip = rewritten.zipBuffer;
      diffResumo.push(rewritten.diff);
    }
  }
  return { novoZip: currentZip, diffResumo };
}
