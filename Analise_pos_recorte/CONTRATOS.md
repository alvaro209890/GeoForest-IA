# Contratos planejados — AUAS pré-2008 V2

Este documento fixa os dados entre visão, regras, DeepSeek, SSE, persistência e
frontend. Os nomes podem ser ajustados na implementação, mas a semântica não
deve voltar a depender de regex em texto livre.

## 1. Status

```ts
type SceneUsability =
  | "USABLE"
  | "CLOUD_OR_OCCLUSION"
  | "LOW_RESOLUTION"
  | "MISSING"
  | "INVALID";

type VisualLandState =
  | "NATIVE_VEGETATION"
  | "ANTHROPIZED"
  | "MIXED"
  | "NOT_OBSERVABLE";

type PolygonPre2008Status =
  | "ALERTA_PRE_2008"
  | "SEM_EVIDENCIA_PRE_2008"
  | "INCONCLUSIVO_NO_MARCO_2008"
  | "INCONCLUSIVO";

type PropertyPre2008Status =
  | "ALERTA_PRE_2008"
  | "SEM_EVIDENCIA_PRE_2008"
  | "INCONCLUSIVO";
```

`SEM_EVIDENCIA_PRE_2008` significa somente que a série analisada não mostrou
evidência suficiente. Não equivale a certidão de inexistência de desmate.

## 2. Proveniência da cena

```ts
type AuasScene = {
  sceneId: string;                 // ex.: AUAS-0001:landsat5:2005
  polygonId: string;
  geometryHash: string;
  year: 2003 | 2004 | 2005 | 2006 | 2007 | 2008;
  sensor: "LANDSAT_5" | "SPOT";
  layer: string;
  imageSha256: string;
  width: number;
  height: number;
  bbox: [number, number, number, number];
  usability: SceneUsability;
  qualityScore: number | null;     // 0..1
  qualityFlags: string[];
  fetchedAt: string;
  // URL sanitizada/armazenada; nunca incluir authkey da SEMA
  storedImageUrl?: string;
};
```

## 3. Saída obrigatória da Groq Vision

Uma chamada cobre uma janela de no máximo três cenas.

```ts
type GroqWindowObservation = {
  schemaVersion: 1;
  polygonId: string;
  windowId: "W2003_2005" | "W2005_2007" | "W2007_2008";
  inspectedSceneIds: string[];
  observations: Array<{
    sceneId: string;
    year: number;
    state: VisualLandState;
    observableFraction: number | null; // 0..1, estimativa visual
    confidence: "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";
    evidence: string[];                // frases curtas, sem conclusão legal
    limitations: string[];
  }>;
  transitions: Array<{
    fromSceneId: string;
    toSceneId: string;
    fromYear: number;
    toYear: number;
    change:
      | "ANTHROPIZATION_APPEARED"
      | "NO_RELEVANT_CHANGE"
      | "POSSIBLE_CHANGE"
      | "NOT_OBSERVABLE";
    confidence: "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";
    evidence: string[];
  }>;
  conflicts: string[];
};
```

Validações antes de aceitar:

- `polygonId` igual ao solicitado;
- `windowId` igual ao solicitado;
- `inspectedSceneIds` sem IDs inventados;
- uma observação para cada cena utilizável;
- transições somente entre cenas fornecidas e em ordem;
- enums fechados;
- arrays e textos com limites;
- nenhum campo jurídico (`legal`, `passivo`, `infração`, `regular`).

Resposta fora do schema é repetida uma vez. Na segunda falha, a janela vira
inconclusiva.

## 4. Evidência reduzida por polígono

```ts
type AuasPolygonResult = {
  polygonId: string;
  geometryHash: string;
  sourceIndex: number;
  areaHa: number;
  bbox: [number, number, number, number];
  status: PolygonPre2008Status;
  pre2008Alert: boolean;
  evidenceKind:
    | "ANTHROPIZED_BY_2003"
    | "TRANSITION_BEFORE_2008"
    | "NO_PRE2008_CHANGE_OBSERVED"
    | "ONLY_2007_TO_2008_CHANGE"
    | "INSUFFICIENT_EVIDENCE";
  observedInterval: {
    fromYear: number | null;
    toYear: number | null;
    wording: string;
  } | null;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";
  sceneIds: string[];
  windowIds: string[];
  evidence: string[];
  limitations: string[];
};
```

Regras mínimas:

- `ANTHROPIZED_BY_2003` → alerta, texto “antropização já observável no mosaico
  de 2003; início não datável por esta série”;
- `TRANSITION_BEFORE_2008` → alerta somente se `toYear <= 2007`;
- `ONLY_2007_TO_2008_CHANGE` → sem alerta booleano e
  `INCONCLUSIVO_NO_MARCO_2008`;
- conflito entre janelas sobrepostas → `INCONCLUSIVO`;
- cena obrigatória ausente/ilegível impede `SEM_EVIDENCIA_PRE_2008`.

## 5. Resultado persistido

```ts
type AuasPre2008AnalysisV2 = {
  schemaVersion: 2;
  rulesVersion: "auas-pre2008-v1";
  jobId: string;
  status: PropertyPre2008Status;
  pre2008Alert: boolean;
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";
  summary: {
    polygonCount: number;
    alertCount: number;
    inconclusiveCount: number;
    noEvidenceCount: number;
    totalAuasAreaHa: number;
    alertAreaHa: number;
  };
  sources: {
    required: string[];
    used: string[];
    missing: string[];
  };
  polygons: AuasPolygonResult[];
  scenes: AuasScene[];
  windows: Array<{
    polygonId: string;
    windowId: string;
    status: "COMPLETED" | "FAILED" | "SKIPPED";
    model: string;
    requestId?: string;
    inputTokens?: number;
    outputTokens?: number;
    observation?: GroqWindowObservation;
    errorCode?: string;
  }>;
  report: {
    model: "deepseek-v4-pro" | "deterministic-fallback";
    markdown: string;
    evidenceRefs: string[];
  };
  limitations: string[];
  startedAt: string;
  completedAt: string;
};
```

## 6. Checkpoint e idempotência

Chave de uma unidade cara:

```text
jobId + geometryHash + windowId + rulesVersion + imageSha256[]
```

Se essa chave já estiver `COMPLETED`, a retomada reutiliza a observação. Mudança
de geometria, imagem, regra ou janela invalida somente a unidade afetada.

Estados do job:

```ts
type AuasV2JobState =
  | "QUEUED"
  | "PREPARING_SCENES"
  | "ANALYZING_POLYGONS"
  | "REDUCING_EVIDENCE"
  | "WRITING_REPORT"
  | "GENERATING_PDF"
  | "COMPLETED"
  | "CANCEL_REQUESTED"
  | "CANCELLED"
  | "FAILED";
```

## 7. SSE

Eventos existentes continuam válidos. O `progress` ganha dados opcionais:

```json
{
  "type": "progress",
  "step": "analyzing_polygons",
  "percent": 47,
  "message": "Analisando AUAS-0003, janela 2005–2007",
  "polygonIndex": 3,
  "polygonTotal": 8,
  "windowIndex": 2,
  "windowTotal": 3,
  "etaSeconds": 620
}
```

Evento final:

```json
{
  "type": "complete",
  "percent": 100,
  "analysis": "markdown produzido pelo DeepSeek ou fallback",
  "images": [],
  "auasMeta": {
    "schemaVersion": 2,
    "rulesVersion": "auas-pre2008-v1",
    "pre2008Status": "ALERTA_PRE_2008",
    "pre2008Alert": true,
    "confidence": "HIGH",
    "summary": {},
    "polygons": [],
    "sources": {},
    "limitations": []
  }
}
```

Não enviar `model_thinking` no V2. `reasoning_content`, prompts completos e
respostas brutas ficam fora do frontend e da persistência de produto.

## 8. Entrada do DeepSeek

O payload textual deve ser montado de um objeto sanitizado:

```ts
type DeepseekAuasReportInput = {
  rulesVersion: string;
  aggregateStatus: PropertyPre2008Status;
  pre2008Alert: boolean;
  summary: AuasPre2008AnalysisV2["summary"];
  sources: AuasPre2008AnalysisV2["sources"];
  polygons: Array<{
    polygonId: string;
    areaHa: number;
    status: PolygonPre2008Status;
    evidenceKind: AuasPolygonResult["evidenceKind"];
    observedInterval: AuasPolygonResult["observedInterval"];
    confidence: AuasPolygonResult["confidence"];
    evidence: string[];
    limitations: string[];
  }>;
  limitations: string[];
  acAvnContext?: {
    source: string;
    summary: string;
  };
};
```

O backend valida que a saída:

- cita somente `polygonId` existente;
- não troca status ou intervalo;
- não adiciona área;
- não usa “passivo”, “ilegal”, “regular” ou equivalentes como conclusão;
- contém aviso de revisão por responsável técnico;
- distingue claramente “não observado” de “não existe”.

