# 06 — Roadmap: auto-correção de erros (próximas atualizações)

> Esta aba do plano é **explícita e adiada** (P5/P6).  
> Não implementar na primeira entrega do oráculo, mas **desenhar o encaixe** já na UI e no job.

## Visão do Álvaro

1. Usuário envia ZIP → oráculo SIMCAR reprova import ou process.
2. GeoForest **propõe/aplica correções** automáticas (offline no backend).
3. Botão **“Corrigir e reenviar ao SIMCAR”** → gera ZIPvN+1 → reimporta/reprocessa no projeto-teste.
4. Usuário acompanha o loop **sem loop infinito cego** (máx. tentativas + diff do que mudou).

## Princípios (aprendizados 16/07/2026)

| # | Princípio |
|---|-----------|
| 1 | **Detectar = SEMA** (calibração dinâmica). **Corrigir = offline** com scripts, nunca “esconder” erro no detector. |
| 2 | Ordem: calibrar detector → corrigir shape → reimportar SIMCAR → comparar. |
| 3 | Não clipar AVN por hidro (piora contenção de úmida). |
| 4 | Remover dups (0,1 m) e anéis colados **antes** de process. |
| 5 | Contenção de AREA_UMIDA é cartográfica (úmida ⊆ AVN∪AUAS∪CONS); clip da úmida gera dups — limpar depois. |
| 6 | Cap de iterações: `AUTOFIX_MAX_ROUNDS=3` default. |
| 7 | Sempre guardar ZIP intermediário + log de patches. |

## Arquitetura do auto-fix

```
backend/simcar-oraculo/autofix/
  types.ts
  plan.ts              # a partir de erros SEMA → lista de FixAction
  apply.ts             # aplica actions no ZIP → novo Buffer
  actions/
    remove-duplicate-vertices.ts
    fix-shared-boundary-holes.ts   # AREA_UMIDA buracos colados
    clip-umida-to-cover.ts
    clean-after-clip.ts
    drop-empty-features.ts
  index.ts
```

### `FixAction` (contrato)

```ts
export type FixAction =
  | { type: "remove_duplicate_vertices"; tolM: 0.1; layers?: string[] }
  | { type: "remove_glued_holes"; sharedEdgeM: 1.0; layers: ["AREA_UMIDA"] }
  | { type: "clip_layer_to_cover"; layer: "AREA_UMIDA"; cover: ["AVN","AUAS","AREA_CONSOLIDADA"] }
  | { type: "clean_degenerate_rings"; minAreaM2: 0.01 }
  | { type: "noop"; reason: string };

export type FixPlan = {
  actions: FixAction[];
  rationale: string[];
  source: "import_pdf" | "process_pdf" | "local_detector";
};
```

### Mapeamento erro SEMA → action (v1)

| Erro SEMA (mensagem / tipo) | Action |
|-----------------------------|--------|
| “A geometria contém pontos repetidos” | `remove_duplicate_vertices` |
| “Borda do polígono se cruza” | limpeza anel + dups; se colapso, `clean_degenerate_rings` |
| “Duas ou mais bordas ou buracos… se sobrepõem” | `remove_glued_holes` |
| “Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA” | `clip_layer_to_cover` + `clean_after_clip` + dups |
| Reservatório / SITUACAO / ARL duplicado | **não auto** na v1 — só reportar “pendência cartográfica / atributo” |

## UI (desde P4, botão disabled)

```tsx
<button
  disabled={!canAutofix || autofixRounds >= maxRounds}
  onClick={onAutofixAndResend}
>
  Corrigir automaticamente e reenviar ({autofixRounds}/{maxRounds})
</button>
```

Após P5: `canAutofix` se `errosResumo` tiver action mapeada.

## Fluxo do botão

1. Parse erros do último import/process (PDF ou resumo).
2. `plan = buildFixPlan(erros)`.
3. Mostrar modal: “Vamos aplicar: remover 11 dups em AREA_UMIDA; recortar 40 úmidas… Continuar?”
4. `newZip = applyFixPlan(oldZip, plan)`.
5. Salvar artefato `corrigido_r{N}.zip`.
6. Reentrar no fluxo import ORACULO (e process se import OK e user marcou).
7. Se piorar (mais erros qty): rollback opção + parar.

## Reuso de scripts de laboratório

| Script / conhecimento | Action |
|----------------------|--------|
| `__tmp_fix_v24_umida_clean.ts` | `remove_duplicate_vertices` |
| `__tmp_fix_v22_umida_holes.ts` | `remove_glued_holes` |
| `__tmp_fix_v23_umida_clip.ts` | `clip_layer_to_cover` |
| `detectOverlappingRings` / `SIMCAR_RING_SHARED_EDGE_M` | critério glue |
| `detectUmidaContainment` | validação pós-fix local (HYBRID) |
| `shapefile-writer.ts` | regravação shp/dbf |

**Regra:** promover scripts `__tmp_*` estáveis para `backend/simcar-oraculo/autofix/actions/*` com testes; não importar `__tmp_` em produção.

## Fases do roadmap

### P5 — Auto-fix import (prioridade)

- [ ] remove dups 0,1 m
- [ ] remove buracos colados (shared edge ≥ 1 m)
- [ ] limpa anéis degenerados
- [ ] testes com ZIP sintético + v23 (11 dups SEMA)
- [ ] botão ativo só para erros de import mapeados

### P6 — Auto-fix process

- [ ] clip úmida → cover + clean dups pós-clip
- [ ] **não** auto-fundir AVN com hidro
- [ ] se ainda ≥ N erros de contenção: mensagem “exige edição cartográfica”
- [ ] teste com v22 process (41 úmidas) → após clip+clean, reimport+process

### P7 — (opcional) Diff visual

- Mapa antes/depois (GeoJSON) no front
- Lista feições alteradas

## Limites anti-loop (obrigatório)

```ts
const AUTOFIX_MAX_ROUNDS = 3;
// parar se:
// - plan.actions vazio
// - qty erros não diminui
// - import ok mas process piora e actions esgotadas
// - usuário cancela
```

## Documentação na aba (texto para o usuário)

> “A correção automática aplica só regras mecânicas já calibradas com o SIMCAR (pontos repetidos, anéis colados, recorte de úmida). Problemas de desenho (reservatório sem barramento, ARL duplicado, sobreposição de usos) continuam exigindo ajuste no GIS.”

## Commits sugeridos (quando chegar a hora)

```
feat(autofix): remove duplicate vertices (SEMA 0.1m)
feat(autofix): remove glued holes on AREA_UMIDA
feat(autofix): clip AREA_UMIDA to AVN∪AUAS∪CONS + clean
feat(ui): botão corrigir e reenviar no oráculo SIMCAR
```
