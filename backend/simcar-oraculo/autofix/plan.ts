import { normalizeLayerName, recognizeSimcarLayer } from "../../simcar-rules";
import {
  requestDeepseekFixPlan,
  type DeepseekActionInventoryItem,
  type DeepseekPlannerOptions,
  type DeepseekRawFixPlan,
} from "./deepseek";
import {
  AUTOFIX_ACTION_TYPES,
  type AutofixActionType,
  type BuildFixPlanInput,
  type FixAction,
  type FixPlan,
  type NonFixableIssue,
} from "./types";

export const AUTOFIX_ACTION_INVENTORY: DeepseekActionInventoryItem[] = [
  {
    type: "remove_duplicate_vertices",
    objetivo: "Remover vértices consecutivos separados por no máximo 0,1 m.",
    precondicoes: ["Erro SEMA de pontos repetidos na mesma camada."],
  },
  {
    type: "clean_degenerate_rings",
    objetivo: "Descartar anéis com área ≤0,01 m² ou largura ≤0,02 m.",
    precondicoes: ["Erro SEMA de borda que se cruza por colapso do anel."],
  },
  {
    type: "unkink_self_intersection",
    objetivo: "Dividir auto-interseções reais em polígonos simples.",
    precondicoes: [
      "Erro SEMA de borda que se cruza; encoste pontual não é corrigido.",
    ],
  },
  {
    type: "remove_glued_holes",
    objetivo: "Remover buraco que compartilha pelo menos 1 m com sua casca.",
    precondicoes: [
      "Erro SEMA de bordas ou buracos da mesma geometria sobrepostos.",
    ],
  },
  {
    type: "split_complex_polygon",
    objetivo:
      "Separar registro com mais de uma casca em registros simples com IDs novos.",
    precondicoes: [
      "Erro SEMA: era esperado polígono simples, mas veio polígono complexo.",
    ],
  },
  {
    type: "clip_layer_to_cover",
    objetivo: "Recortar AREA_UMIDA pela união AVN∪AUAS∪AREA_CONSOLIDADA.",
    precondicoes: [
      "Somente AREA_UMIDA.",
      "Erro de processamento: deve estar completamente contida na cobertura.",
      "Disponível apenas na fase P6.",
    ],
  },
];

const actionTypes = new Set<string>(AUTOFIX_ACTION_TYPES);
const actionPriority: Record<AutofixActionType, number> = {
  remove_duplicate_vertices: 1,
  clean_degenerate_rings: 2,
  unkink_self_intersection: 3,
  remove_glued_holes: 4,
  split_complex_polygon: 5,
  clip_layer_to_cover: 6,
};

export type BuildFixPlanOptions = DeepseekPlannerOptions;

function normalizeText(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function canonicalLayer(value: unknown): string {
  const raw = String(value || "").trim();
  return recognizeSimcarLayer(raw) || normalizeLayerName(raw);
}

export function mappedActionsForError(args: {
  camada: string;
  erro: string;
}): AutofixActionType[] {
  const layer = canonicalLayer(args.camada);
  const error = normalizeText(args.erro);
  if (
    /pontos? repetid|vertices? duplicad|geometria contem pontos repetidos/.test(
      error
    )
  ) {
    return ["remove_duplicate_vertices"];
  }
  if (/bordas? ou buracos?/.test(error) && /sobrepo/.test(error)) {
    return ["remove_glued_holes"];
  }
  if (
    /esperad[oa] um poligono simples/.test(error) &&
    /poligono complexo/.test(error)
  ) {
    return ["split_complex_polygon"];
  }
  if (
    /borda (?:do )?poligono se cruza|borda se cruza|auto-?interse/.test(error)
  ) {
    return ["clean_degenerate_rings", "unkink_self_intersection"];
  }
  if (
    layer === "AREA_UMIDA" &&
    /completamente contid|deve (?:estar|ser) contid/.test(error)
  ) {
    return ["clip_layer_to_cover"];
  }
  return [];
}

function nonFixableForError(error: {
  camada: string;
  erro: string;
  qtd: number;
}): NonFixableIssue {
  const normalized = normalizeText(error.erro);
  const label = `${canonicalLayer(error.camada)}: ${error.erro} (${error.qtd})`;
  if (
    /reservatorio|barramento|situacao|atributo|campo obrigatorio/.test(
      normalized
    )
  ) {
    return {
      erro: label,
      porque:
        "Exige confirmar um atributo ou enquadramento cadastral; a geometria não determina a resposta.",
      orientacao:
        "Conferir a documentação e editar o atributo no cadastro/GIS antes de reenviar.",
    };
  }
  if (/sobreposi|duplicad/.test(normalized)) {
    return {
      erro: label,
      porque:
        "Exige decidir qual feição representa a realidade e qual deve ser mantida, fundida ou recortada.",
      orientacao:
        "Comparar as feições no GIS com a fonte técnica e remover/fundir somente após decisão humana.",
    };
  }
  if (/air|composi|vazio|lacuna|area total/.test(normalized)) {
    return {
      erro: label,
      porque:
        "A correção depende da composição ambiental declarada e não pode ser inferida mecanicamente.",
      orientacao:
        "Revisar a composição da AIR e as classes de cobertura no GIS com responsável técnico.",
    };
  }
  return {
    erro: label,
    porque: "Não há ação determinística calibrada para este erro da SEMA.",
    orientacao:
      "Abrir os artefatos oficiais no GIS, corrigir com decisão técnica e iniciar um novo envio.",
  };
}

function mergeActionsInOrder(actions: FixAction[]): FixAction[] {
  const merged = new Map<AutofixActionType, FixAction>();
  for (const action of actions) {
    const previous = merged.get(action.type);
    if (!previous) {
      merged.set(action.type, {
        type: action.type,
        layers: [...new Set(action.layers)],
        motivo: action.motivo,
      });
      continue;
    }
    previous.layers = [...new Set([...previous.layers, ...action.layers])];
  }
  return [...merged.values()];
}

function dedupeNonFixable(items: NonFixableIssue[]): NonFixableIssue[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = normalizeText(item.erro);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fallbackFromInput(
  input: BuildFixPlanInput,
  allowed: Set<AutofixActionType>,
  warnings: string[] = []
): FixPlan {
  const actions: FixAction[] = [];
  const nonFixable: NonFixableIssue[] = [];
  const orderedErrors = [...input.errosResumo].sort((a, b) =>
    `${canonicalLayer(a.camada)}\0${a.erro}`.localeCompare(
      `${canonicalLayer(b.camada)}\0${b.erro}`,
      "pt-BR"
    )
  );
  for (const error of orderedErrors) {
    const mapped = mappedActionsForError(error).filter(type =>
      allowed.has(type)
    );
    if (!mapped.length) {
      nonFixable.push(nonFixableForError(error));
      continue;
    }
    for (const type of mapped) {
      actions.push({
        type,
        layers: [canonicalLayer(error.camada)],
        motivo: `${error.erro} — ${Math.max(0, Number(error.qtd) || 0)} ocorrência(s) informada(s) pela SEMA.`,
      });
    }
  }
  const merged = mergeActionsInOrder(actions).sort(
    (a, b) => actionPriority[a.type] - actionPriority[b.type]
  );
  const total = input.errosResumo.reduce(
    (sum, error) => sum + Math.max(0, Number(error.qtd) || 0),
    0
  );
  const explanation = merged.length
    ? `A SEMA informou ${total} ocorrência(s). O plano aplicará ${merged.length} ação(ões) mecânica(s) calibrada(s)` +
      `${nonFixable.length ? `; ${nonFixable.length} item(ns) ainda exigem decisão técnica.` : "."}`
    : `A SEMA informou ${total} ocorrência(s), mas nenhuma possui correção mecânica calibrada; é necessária revisão técnica no GIS/cadastro.`;
  return {
    acoes: merged,
    naoCorrigivel: dedupeNonFixable(nonFixable),
    explicacaoUsuario: explanation,
    confianca:
      merged.length && !nonFixable.length
        ? "alta"
        : merged.length
          ? "media"
          : "baixa",
    fonte: "fallback",
    modelo: null,
    avisos: warnings,
  };
}

export function buildFallbackFixPlan(
  input: BuildFixPlanInput,
  warning?: string
): FixPlan {
  const allowed = new Set<AutofixActionType>(
    (input.allowedActions || AUTOFIX_ACTION_TYPES).filter(type =>
      actionTypes.has(type)
    )
  );
  return fallbackFromInput(input, allowed, warning ? [warning] : []);
}

function actionPairs(actions: FixAction[]): Set<string> {
  return new Set(
    actions.flatMap(action =>
      action.layers.map(layer => `${action.type}\0${canonicalLayer(layer)}`)
    )
  );
}

function sanitizeDeepseekPlan(args: {
  raw: DeepseekRawFixPlan;
  fallback: FixPlan;
  allowed: Set<AutofixActionType>;
  model: string;
  attempts: number;
}): FixPlan {
  const eligible = actionPairs(args.fallback.acoes);
  const warnings: string[] = [];
  const accepted: FixAction[] = [];
  for (const rawAction of args.raw.acoes) {
    if (
      !actionTypes.has(rawAction.type) ||
      !args.allowed.has(rawAction.type as AutofixActionType)
    ) {
      warnings.push(
        `Ação fora do inventário permitido descartada: ${rawAction.type}.`
      );
      continue;
    }
    const type = rawAction.type as AutofixActionType;
    const layers = [
      ...new Set(
        rawAction.layers
          .map(canonicalLayer)
          .filter(layer => eligible.has(`${type}\0${layer}`))
      ),
    ];
    if (!layers.length) {
      warnings.push(
        `Ação ${type} descartada: nenhuma camada satisfez as pré-condições determinísticas.`
      );
      continue;
    }
    accepted.push({ type, layers, motivo: rawAction.motivo });
  }

  const acceptedPairs = actionPairs(accepted);
  for (const fallbackAction of args.fallback.acoes) {
    const missingLayers = fallbackAction.layers.filter(
      layer =>
        !acceptedPairs.has(`${fallbackAction.type}\0${canonicalLayer(layer)}`)
    );
    if (!missingLayers.length) continue;
    warnings.push(
      `Ação determinística ${fallbackAction.type} acrescentada porque a IA a omitiu para ${missingLayers.join(", ")}.`
    );
    accepted.push({ ...fallbackAction, layers: missingLayers });
  }
  if (args.attempts > 1)
    warnings.push(
      "DeepSeek precisou da segunda tentativa para produzir JSON válido."
    );

  return {
    acoes: mergeActionsInOrder(accepted),
    naoCorrigivel: dedupeNonFixable([
      ...args.raw.naoCorrigivel,
      ...args.fallback.naoCorrigivel,
    ]),
    explicacaoUsuario: args.raw.explicacaoUsuario,
    confianca: args.raw.confianca,
    fonte: "deepseek",
    modelo: args.model,
    avisos: warnings,
  };
}

/** DeepSeek ordena/explica; a elegibilidade e o fallback continuam determinísticos. */
export async function buildFixPlan(
  input: BuildFixPlanInput,
  options: BuildFixPlanOptions = {}
): Promise<FixPlan> {
  const allowed = new Set<AutofixActionType>(
    (input.allowedActions || AUTOFIX_ACTION_TYPES).filter(type =>
      actionTypes.has(type)
    )
  );
  const fallback = fallbackFromInput(input, allowed);
  const apiKey = String(
    options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? ""
  ).trim();
  if (!apiKey) {
    return {
      ...fallback,
      avisos: [
        ...fallback.avisos,
        "DEEPSEEK_API_KEY ausente; fallback determinístico aplicado.",
      ],
    };
  }

  try {
    const response = await requestDeepseekFixPlan(
      {
        ...input,
        inventory: AUTOFIX_ACTION_INVENTORY.filter(item =>
          allowed.has(item.type)
        ),
      },
      { ...options, apiKey }
    );
    return sanitizeDeepseekPlan({
      raw: response.plan,
      fallback,
      allowed,
      model: response.model,
      attempts: response.attempts,
    });
  } catch (error: any) {
    const diagnostic = String(error?.message || "erro sem detalhe")
      .replace(/\s+/g, " ")
      .slice(0, 500);
    return {
      ...fallback,
      avisos: [
        ...fallback.avisos,
        `DeepSeek indisponível (${error?.code || "erro"}: ${diagnostic}); fallback determinístico aplicado.`,
      ],
    };
  }
}
