# 06 — Autofix (P5/P6): correções mecânicas + DeepSeek V4 Pro como planejador

## Decisões (D3/D4)

- **Aplicar**: SÓ rotinas determinísticas calibradas com o importador/ProcessarGeo reais.
- **DeepSeek V4 Pro** (`deepseek-v4-pro`): interpreta os erros da SEMA, monta/ordena o
  `FixPlan`, explica em pt-BR para o usuário e classifica o que NÃO é corrigível
  mecanicamente. **Não** inventa geometria nem decide casos ambíguos.
- **Loop automático até 3 rodadas** (`AUTOFIX_MAX_ROUNDS=3`), sem clique: reprova →
  corrige → reimporta → (aprovou? processa) → reprova → corrige…
- **Sem validação local** (D2): a única validação do ZIP corrigido é o próprio reenvio à
  SEMA. Sanidade mínima permitida (não é validação): ZIP abre, camadas e contagens de
  registros batem com o esperado pós-ação, .prj/.cpg preservados.

## Integração DeepSeek

| Item | Valor |
|------|-------|
| Modelo | `deepseek-v4-pro` (mesmo id usado no acompanhamento-de-processos) |
| Endpoint | `https://api.deepseek.com/v1/chat/completions` |
| Chave | env `DEEPSEEK_API_KEY` do backend; valor copiado de `~/.hermes/.env` deste PC (`grep '^DEEPSEEK_API_KEY' ~/.hermes/.env`) para o env do PC servidor. **Nunca hardcode/commit (repo público).** ⚠️ NÃO usar a chave do Atlas (401, inválida) |
| Reasoning | medium (subir p/ high só se plano sair ruim) |
| Gotchas (do acompanhamento) | `max_tokens` inclui o raciocínio → dar folga e retry se `content` vazio; `temperature` é ignorado; API oficial não tem visão (não mandar PDF binário — mandar TEXTO extraído) |
| Sem chave / API fora | fallback: mapeamento fixo erro→ação (tabela abaixo); explicação vira template. O loop NUNCA depende da IA para funcionar |

### Contrato da chamada (`autofix/deepseek.ts`)

Entrada (system+user): texto extraído do PDF SEMA + `errosResumo` + inventário de ações
disponíveis (com pré-condições) + resultado da rodada anterior (se houver).
Saída JSON estrita (validar com zod; 1 retry em JSON inválido; depois fallback):

```jsonc
{
  "acoes": [ { "type": "remove_duplicate_vertices", "layers": ["AREA_UMIDA"], "motivo": "…" } ],
  "naoCorrigivel": [ { "erro": "reservatório sem barramento", "porque": "exige decisão cadastral", "orientacao": "…GIS…" } ],
  "explicacaoUsuario": "A SEMA apontou 11 vértices repetidos…",
  "confianca": "alta|media|baixa"
}
```

Regra dura: `acoes[].type` FORA do inventário → descartada (log). IA propõe, código dispõe.

## Ações mecânicas (inventário v1 — todas já prototipadas nos `__tmp_fix_*`)

| Action | Origem/prova | Erro SEMA alvo |
|--------|--------------|----------------|
| `remove_duplicate_vertices` (tol 0,1 m) | v24 (`__tmp_fix_v24_umida_clean.ts`) | "pontos repetidos" |
| `clean_degenerate_rings` (área ≤0,01 m² OU largura ≤0,02 m) | calibração borda-se-cruza | "borda do polígono se cruza" (colapso) |
| `unkink_self_intersection` | `fixLayerGeometry` já em produção | "borda se cruza" (auto-interseção real) |
| `remove_glued_holes` (borda compartilhada ≥1 m) | v22 (`__tmp_fix_v22_umida_holes.ts`) | "bordas ou buracos se sobrepõem" |
| `clip_layer_to_cover` (AREA_UMIDA → AVN∪AUAS∪CONS) + `clean_after_clip` | v23 (`__tmp_fix_v23_umida_clip.ts`) | "deve ser completamente contida…" (process) |
| `split_complex_polygon` | regra do importador | "polígono complexo" |
| `drop_empty_features` | — | subproduto das demais |

### Regras de engenharia (aprendidas a caro preço — NÃO violar)

1. **NUNCA `turf.buffer`** — arcos reprovam "borda se cruza" no importador real.
2. Clip só com difference/intersect iterativos; **filtrar fragmentos <100 m²** pós-clip.
3. **Não clipar AVN por hidrografia** (abriu os 41 erros de úmida no v8→v9).
4. Clip que vira MultiPolygon: **IDs novos** para partes extras (v9), nunca duplicar linha do .dbf.
5. Encoste pontual de vértice é VÁLIDO (ESRI/SEMA) — não "corrigir".
6. Camadas não tocadas: **copiar bytes originais** (.shp/.dbf/.prj/.cpg intactos); regravar só a
   camada alterada (`shapefile-writer` não escreve .prj — copiar o original; dbf latin1 trunca).
7. Ações de decisão (qual duplicata ARL/AVN descartar, BARRAMENTO/SITUACAO, buraco de
   composição da AIR, fundir vs recortar úmida) → `naoCorrigivel` com orientação. NUNCA auto.
8. Fixes encadeiam: cada rodada parte do ZIP da rodada anterior (v22→v23→v24 provou).

## Estrutura

```
backend/simcar-oraculo/autofix/
  types.ts        # FixAction, FixPlan, FixResult
  plan.ts         # errosResumo(+texto PDF) → FixPlan  [DeepSeek → fallback tabela fixa]
  apply.ts        # ZIP + FixPlan → {novoZip, diffResumo[{camada, acao, feicoesAfetadas}]}
  deepseek.ts     # cliente (fetch nativo, sem SDK) + zod + retry content-vazio
  actions/
    remove-duplicate-vertices.ts
    clean-degenerate-rings.ts
    unkink-self-intersection.ts
    remove-glued-holes.ts
    clip-layer-to-cover.ts      # + clean-after-clip embutido
    split-complex-polygon.ts
  zip-rewrite.ts  # helper único: reabrir ZIP, substituir 1 camada, preservar resto byte a byte
```

Promover a lógica dos `__tmp_fix_*` para `actions/` COM testes; `__tmp_*` continuam
gitignorados e nunca importados em produção.

## Loop (dentro do pipeline)

```
round = 1
while true:
  importa (e processa se aprovar)
  if tudo FINALIZADO: done ✓
  if round >= AUTOFIX_MAX_ROUNDS: para ("teto de rodadas")
  erros = parse(pdf) ; plan = buildFixPlan(erros, historicoRodadas)
  if plan.acoes vazio: para ("nada corrigível mecanicamente" + orientações)
  if qtdErros(round) >= qtdErros(round-1) e mesmo conjunto de ações: para ("sem melhora")
  aplica → corrigido_r{N+1}.zip (artefato + fixplan.json) ; round++
```

Paradas sempre com motivo explícito na timeline + botão manual "Corrigir e reenviar"
habilitado apenas se ainda existir ação mapeada nova (ex.: usuário editou no GIS e re-subiu —
aí é outro job).

## P5 (import) vs P6 (process)

- **P5**: dups, anéis degenerados, unkink, buracos colados, polígono complexo. Oráculo de
  teste: V23 (11 pontos repetidos — a rodada deve produzir ZIP que importa FINALIZADO).
  **✅ fechado live T16.**
- **P6**: clip úmida→cover + limpeza pós-clip. Oráculo: V22 (41 contenções — após fix,
  reimporta e processa; meta: zerar os 41; pendências restantes de reservatório/ARL são
  `naoCorrigivel` esperado). **🔶 em progresso** — ver STATUS T17.

### Achados T17 (não violar ao retomar)

1. Clip local que altera dezenas de feições **pode** manter ×41 no PDF SEMA — gate só com
   ProcessarGeo real (`pipeline-process-live.test.ts`).
2. Preferir **pedaços por host** (AVN **ou** AUAS **ou** CONS) a unir pedaços multi-host numa
   única feição MultiPolygon.
3. Residual típico Santa Clara = úmida sobre hidro / buraco de AIR — autofix mecânico tem
   teto; **D7** (remover AREA_UMIDA do ZIP de teste após 3 lives) é escape autorizado no
   CAR 270069, não no produto do usuário final.
4. Variantes manuais no scratch chegaram a **1–3** erros de contenção: há margem de calibração
   fina (borda/precision), não só “clip ou nada”.

## Telemetria mínima

`fixplan.json` por rodada: erros de entrada, plano, fonte (deepseek|fallback), diffResumo,
resultado da rodada seguinte. É o dataset para calibrar futuras ações.
