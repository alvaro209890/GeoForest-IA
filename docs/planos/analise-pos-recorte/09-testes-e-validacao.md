# 09 — Testes e validação

Stack: **vitest** (`pnpm test`), `pnpm run check` (tsc) e `pnpm run build`. A suíte atual
do repo está em 503 testes verdes — o gate de cada tarefa é "suíte inteira verde", não
só o arquivo novo.

## 1. Fixture oficial

```text
Analise_pos_recorte/fase/SIMCAR_Recorte_Digital.zip
```

Contém a camada `AIR` — o teste **começa pelo recorte SIMCAR normal**, que produz os
polígonos AUAS e AC. Nunca tratar o ZIP como se já fosse um shapefile AUAS. É entrada
imutável: descompactar em diretório temporário, nunca regravar.

Caso de negócio conhecido: o recorte dessa fixture contém **pelo menos um AUAS com
evidência pré-2008**. O E2E da Fase 1 falha se não retornar ≥1 `ALERTA_PRE_2008`.

## 2. Conjunto dourado (bloqueia o rollout)

Uma única sessão de conferência humana, cobrindo as três fases nos mesmos polígonos:

| Categoria | Fase que valida |
|---|---|
| antropizado já em 2003 | 1 |
| transição clara entre 2003 e 2007 | 1 |
| mudança só entre 2007 e SPOT 2008 | 1 |
| sem mudança até 2008 | 1 |
| conversão em ano único e claro (ex.: 2014) | 2 |
| conversão em fronteira de sensor (2011/2012 ou 2017/2018) | 2 |
| já antropizado em 2009 | 2 |
| sem mudança até 2019 (e com alerta SCCON depois) | 2 |
| AC com AVN declarada dentro | 3 |
| AC com vegetação aparente não declarada | 3 |
| AC limpa | 3 |
| polígono pequeno, MultiPolygon, cena com nuvem, ano ausente | 1, 2 e 3 |

Registrar por caso: `geometryHash`, veredito humano, justificativa e as cenas usadas —
nunca chaves. O rollout de cada fase exige paridade com o dourado dela.

## 3. Testes unitários (sem rede, sem LLM)

| ID | Alvo | Espera |
|---|---|---|
| U-01 | `polygons.ts` genérico | `extractPolygons(map,"AUAS","AUAS")` idêntico ao `extractAuasPolygons` atual; `"AREA_CONSOLIDADA"` → `AC-0001…`; MultiPolygon e buracos preservados |
| U-02 | `computeGeometryHash` | estável entre execuções e sensível a mudança de coordenada |
| U-03 | `pos2008/timeline.ts` | monta as 5 janelas; pula ano ausente; marca fronteira de sensor |
| U-04 | `pos2008/evidence-reducer.ts` | nativo→antrópico consecutivo = `CONFIRMADO_ANO` |
| U-05 | idem | lacuna entre último nativo e primeiro antrópico = `CONFIRMADO_INTERVALO`, nunca ano |
| U-06 | idem | antrópico já em 2009 = `JA_ANTROPIZADO_NO_INICIO_DA_SERIE` |
| U-07 | idem | transição em fronteira de sensor **sem** ponte = intervalo; **com** ponte confirmando = ano |
| U-08 | idem | janelas que discordam do ano compartilhado → aquele ano vira não observável + limitação |
| U-09 | idem | regeneração (`ANTHROPIZED_TO_NATIVE`) não apaga conversão anterior |
| U-10 | `ac-vegetacao/geometry-evidence.ts` | interseção AC×AVN correta em ha e fração; slivers < limiar descartados e contabilizados |
| U-11 | idem | flags `AC_SOBREPOE_ARL` / `AC_SOBREPOE_AUAS` |
| U-12 | `ac-vegetacao/evidence-reducer.ts` | geométrica ≥ limiar vence a visão; visão sozinha → alerta médio; conflito → inconclusivo |
| U-13 | `checkpoint-store` com fase | chaves de fases diferentes não colidem; `catalogVersion` diferente invalida |
| U-14 | schemas Zod das fases 2 e 3 | JSON inválido/campo inventado é rejeitado; um retry e depois inconclusivo |
| U-15 | gate de fase | Fase 2 sem Fase 1 → `PHASE_NOT_READY`; hash divergente → `PHASE1_MISMATCH` |
| U-16 | teto de imagens | qualquer janela com >3 imagens falha **antes** da requisição |

## 4. Testes de contrato de rota

| ID | Cenário | Espera |
|---|---|---|
| R-01 | as 3 rotas sem token | 401 (allowlist de `app.ts`) |
| R-02 | `POST analyze-auas-pos2008` com job inexistente | erro claro, sem 500 |
| R-03 | `GET /phases/:jobId` logo após o recorte | `PRE_2008: AVAILABLE`, demais `BLOCKED` com motivo |
| R-04 | fase já rodando | `PHASE_ALREADY_RUNNING` |
| R-05 | recorte sem `AREA_CONSOLIDADA` | Fase 3 responde 200 com `LAYER_EMPTY`, não erro |
| R-06 | `complete` só após persistir | ler o histórico logo após o evento devolve o bloco |

## 5. Integração WMS (rede, sem LLM)

| ID | Cenário | Espera |
|---|---|---|
| W-01 | `GetCapabilities` real | anos 2009–2019 presentes; `catalogVersion` estável entre chamadas |
| W-02 | `GetMap` por ano habilitado | PNG válido, dimensão certa, não uniforme; ano reprovado sai da série |
| W-03 | comparabilidade | todas as cenas de um polígono com mesma bbox/dimensão; hashes distintos entre anos |
| W-04 | sanitização | nenhuma URL persistida contém `authkey` |
| W-05 | cenas da Fase 3 | 2024 / NIR / SPOT 2008 resolvem; ausência cai no alternativo e registra limitação |

## 6. Testes live (opt-in, não rodam na suíte padrão)

Guardados por env (`SIMCAR_LIVE=1` + chaves), no padrão que o repo já usa no oráculo.

| ID | Cenário | Espera |
|---|---|---|
| L-01 | Fase 1 completa sobre a fixture | ≥1 `ALERTA_PRE_2008`; contrato v2 completo |
| L-02 | Fase 2 encadeada na mesma fixture | preserva e referencia o pré-2008; não o recalcula |
| L-03 | Fase 3 encadeada | cruzamento geométrico bate com conferência manual no GIS |
| L-04 | cancelar no meio de uma janela e retomar | nenhuma chamada de visão repetida para a mesma chave |
| L-05 | DeepSeek indisponível | fallback determinístico; resultado estruturado intacto |
| L-06 | 429 da Groq | respeita `retry-after`, não perde checkpoint |

Cada execução live registra: SHA-256 do ZIP, commit, `rulesVersion`, `catalogVersion`,
layers/anos/hashes das cenas, IDs dos polígonos e o resultado — **sem** chaves.

## 7. Frontend

| ID | Cenário | Espera |
|---|---|---|
| F-01 | painel logo após o recorte | 3 cards; 1 habilitado; 2 e 3 bloqueados com motivo legível |
| F-02 | Fase 1 concluída | Fase 2 habilita; frase "Evidência de desmate/antropização anterior a 2008" aparece quando houver alerta |
| F-03 | recarregar a página no meio da Fase 2 | reconecta ao job ativo e mostra progresso |
| F-04 | refazer a Fase 1 | fases 2 e 3 voltam a bloqueadas e resultados antigos ficam `stale`, não somem |
| F-05 | card V1 antigo | continua abrindo sem quebrar |
| F-06 | tabela da Fase 2 | filtros por status; clicar na linha mostra as cenas com ano/sensor |

## 8. Definição de pronto por fase

Uma fase só é considerada pronta quando:

1. todos os polígonos da camada recebem resultado individual;
2. todas as cenas obrigatórias são tentadas e as ausências ficam registradas;
3. nenhuma chamada de visão excede 3 imagens;
4. a decisão sai do redutor determinístico, não de texto do LLM;
5. cancelar/retomar não repete janela concluída;
6. SSE, histórico, UI e PDF concordam;
7. o conjunto dourado daquela fase atinge a paridade acordada;
8. nenhuma chave aparece em git, log, payload ou frontend.
