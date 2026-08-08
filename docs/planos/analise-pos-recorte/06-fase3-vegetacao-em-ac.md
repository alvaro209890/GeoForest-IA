# 06 — Fase 3: vegetação nativa dentro da Área Consolidada

Botão **"Vegetação dentro da Área Consolidada"**, liberado só depois da Fase 2
concluída.

## 1. Pergunta que a fase responde

Para **cada polígono `AREA_CONSOLIDADA`** do recorte: existe vegetação de aparência
nativa **dentro** do polígono declarado como consolidado? Onde e quanto (faixa de área)?

Por que importa: AC é, por definição, área com uso antrópico consolidado antes de
22/07/2008. Vegetação nativa remanescente dentro dela indica erro de delimitação — ou
área que deveria estar declarada como AVN/ARL — e é exatamente o tipo de inconsistência
que a SEMA cobra na análise do CAR. A saída é **alerta técnico de conferência**, não
enquadramento jurídico.

## 2. Duas evidências independentes, combinadas por código

### 2.1 Evidência geométrica (determinística, roda primeiro)

O recorte **já entrega** as camadas necessárias no mesmo job:

| Camada | Papel na Fase 3 |
|---|---|
| `AREA_CONSOLIDADA` | unidade de análise |
| `AVN` | vegetação nativa **declarada** pelo próprio projeto |
| `TIPOLOGIA_VEGETAL` | tipologia mapeada pela SEMA — **cobertura do imóvel inteiro, não declaração de nativa** (medido 2026-08-07); entra como contexto, não como gatilho de alerta |
| `ARL`, `ARLREM` | reserva legal — sobreposição com AC é inconsistência grave |
| `AUAS` | uso alternativo — sobreposição com AC também é inconsistência |

Para cada polígono de AC, calcular com turf (sem rede, sem IA):

```
interseção(AC_i, AVN)                → area_ha, fração da AC, nº de partes
interseção(AC_i, TIPOLOGIA_VEGETAL)  → area_ha, fração, tipologias tocadas
interseção(AC_i, ARL ∪ ARLREM)       → area_ha, fração        [flag de inconsistência]
interseção(AC_i, AUAS)               → area_ha, fração        [flag de inconsistência]
```

Fragmentos menores que um limiar (sugestão: **500 m²**, decisão A3) são descartados
como ruído de borda/topologia e contabilizados à parte como `slivers`.

Isso sozinho já responde "o próprio projeto declara vegetação dentro da AC?" — de graça,
sem chamada de IA, sem risco de alucinação. **Esta evidência tem precedência.**

### 2.2 Evidência visual (Groq Vision, complementa)

Independe do que foi declarado: olha a imagem e diz se **parece** haver vegetação nativa
dentro do contorno.

Cenas por polígono de AC (uma janela de até 3 imagens):

| Ordem | Fonte proposta | Papel |
|---|---|---|
| 1 | `Mosaicos:SENTINEL_2_2024` | estado atual, maior resolução |
| 2 | `Mosaicos:SENTINEL_2_2021` **NIR** (`Mosaicos:Geoportal_Sentinel_2_2021_NIR`) | realce de vegetação — NIR separa nativa de pasto/cultura muito melhor que RGB |
| 3 | `Mosaicos:MOSAICO_SPOT_SEPLAN` (2008) | referência do marco: aquilo já era vegetação em 2008? |

Todos sujeitos à validação de catálogo do doc 03 — se o NIR de 2021 não estiver
publicado, cair para o NIR mais recente disponível (2020) e registrar. A cena de 2008 é
**contexto**, nunca base para datar nada (isso é a Fase 1).

Saída JSON por cena:

```
vegetationInside: NONE | SPARSE | PATCHES | LARGE_BLOCK | NOT_OBSERVABLE
estimatedFraction: 0..1 | null      // fração da AC coberta por vegetação aparente
distribution: EDGE | INTERIOR | RIPARIAN | SCATTERED | null
confidence + evidence[] + limitations[]
```

`RIPARIAN` importa: mata ciliar dentro de AC costuma ser APP mal delimitada — o texto
final deve destacar quando a vegetação acompanha as camadas de rio do próprio recorte.

## 3. Redutor determinístico

```text
Entrada: evidência geométrica (fração declarada) + evidência visual (fração aparente)

VEGETACAO_DECLARADA_DENTRO_DA_AC
    fração geométrica declarada ≥ limiar_geom (sugestão 1% ou 0,5 ha)
    → alerta ALTO, independe do que a visão disse (é o próprio projeto se contradizendo)

VEGETACAO_APARENTE_DENTRO_DA_AC
    sem interseção declarada relevante, mas visão ≥ PATCHES com confiança ≥ MEDIUM
    em pelo menos 2 das 3 cenas utilizáveis
    → alerta MÉDIO, "conferir em campo/GIS"

SEM_VEGETACAO_APARENTE
    todas as cenas obrigatórias utilizáveis, visão NONE/SPARSE e sem interseção declarada
    → sem alerta

INCONCLUSIVO
    cenas ausentes/nubladas, conflito entre cenas, ou polígono menor que a
    resolução efetiva do sensor
```

> ⚠️ **CORREÇÃO PELA MEDIÇÃO (2026-08-07).** Esta seção dizia `AVN ∪ TIPOLOGIA_VEGETAL`.
> Rodando contra o recorte real da Santa Clara (33 ACs), a `TIPOLOGIA_VEGETAL` cobre
> **~100% de toda AC** — ela é o mapa de tipologia do imóvel inteiro, incluindo classes
> antrópicas, não uma declaração de vegetação nativa. Com a união, **100% dos polígonos**
> batiam o limiar e saíam com alerta ALTO; a `AVN` no mesmo recorte deu **0 ha** dentro das
> ACs, que é o resultado correto. A implementação usa **só `AVN`** por padrão
> (`SIMCAR_AC_VEG_DECLARED_SOURCES=AVN,TIPOLOGIA_VEGETAL` restaura o texto original desta
> seção). Usar a tipologia como declaração exigiria filtrar pela **classe** no `.dbf`, que o
> pipeline geométrico atual não lê. Ver `docs/CHANGELOG_2026-08-07_AUDITORIA_BUGS_FASES.md`.

Bandas de área reportadas (nunca um número falsamente preciso da visão):
`< 0,5 ha` · `0,5–2 ha` · `2–10 ha` · `> 10 ha`. A área **declarada** (geométrica) sai
com o valor calculado, essa sim precisa.

Flags independentes do status, sempre reportadas quando existirem:
`AC_SOBREPOE_ARL`, `AC_SOBREPOE_AUAS`, `VEGETACAO_RIPARIA_NA_AC`.

## 4. Contrato de saída

```ts
type AcVegetacaoStatus =
  | "VEGETACAO_DECLARADA_DENTRO_DA_AC"
  | "VEGETACAO_APARENTE_DENTRO_DA_AC"
  | "SEM_VEGETACAO_APARENTE"
  | "INCONCLUSIVO";

type AcPolygonResult = {
  polygonId: string;          // "AC-0001"
  geometryHash: string;
  areaHa: number;
  status: AcVegetacaoStatus;
  alertLevel: "ALTO" | "MEDIO" | "NENHUM" | "INDETERMINADO";
  geometric: {
    avnAreaHa: number; avnFraction: number; avnParts: number;
    tipologiaAreaHa: number; tipologiaFraction: number; tipologias: string[];
    arlAreaHa: number; auasAreaHa: number;
    sliversDiscardedM2: number;
  };
  visual: {
    verdict: "NONE" | "SPARSE" | "PATCHES" | "LARGE_BLOCK" | "NOT_OBSERVABLE";
    estimatedFractionBand: "<0.5ha" | "0.5-2ha" | "2-10ha" | ">10ha" | null;
    distribution: string | null;
    sceneIds: string[];
  };
  flags: string[];
  confidence: "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";
  evidence: string[];
  limitations: string[];
};

type AcVegetacaoAnalysis = {
  schemaVersion: 1;
  rulesVersion: "ac-vegetacao-v1";
  phase: "AC_VEG";
  jobId: string;
  pos2008JobRef: { rulesVersion: string; completedAt: string };
  summary: { polygonCount, totalAcAreaHa,
             declaredVegetationCount, declaredVegetationAreaHa,
             apparentVegetationCount, cleanCount, inconclusiveCount };
  polygons: AcPolygonResult[];
  scenes: SceneProvenance[];
  windows: WindowRun[];
  report: { model; markdown; evidenceRefs };
  limitations: string[];
  startedAt: string; completedAt: string;
};
```

## 5. Rota

```
POST /api/simcar/clip/analyze-ac-vegetacao
body: { jobId, contextUrl?, outputZipUrl? }
→ SSE igual às demais fases
→ 409 { code: "PHASE_NOT_READY", requires: "POS_2008" }
→ 200 com summary vazio e aviso claro se não houver camada AREA_CONSOLIDADA no recorte
```

## 6. Custo e tempo

1 janela por polígono de AC (≤3 imagens) → **~1 min por polígono**, bem mais barata que
as fases 1 e 2. A parte geométrica é instantânea e **roda mesmo se a visão falhar**: se
a Groq cair, a fase ainda entrega o cruzamento determinístico com status
`INCONCLUSIVO` na parte visual, e isso é resultado útil, não falha.

## 7. Fronteira com o que já existe

A análise AC/AVN atual (`runAcAvnSatelliteAnalysis`) continua como está: ela olha a
propriedade inteira e escreve texto. A Fase 3 é **por polígono, com número e flag**.
No PDF elas aparecem em seções distintas; o texto da Fase 3 pode citar o veredito
global do AC/AVN como contexto, nunca como fonte da decisão.
