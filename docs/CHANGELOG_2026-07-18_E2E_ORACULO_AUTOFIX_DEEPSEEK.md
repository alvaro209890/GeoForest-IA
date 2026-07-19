# Teste E2E ao vivo — Oráculo SIMCAR + autorreção com DeepSeek — 2026-07-18

Bateria de teste **ao vivo** do oráculo SIMCAR e da autorreção de shapes movida a
DeepSeek, executada no **PC servidor** contra a **API real da SEMA-MT** e a **API
real do DeepSeek**. Sem mudança de código de produção — só verificação. Fixtures
`.oraculo-scratch/santa_clara/*` (V22/V23/SEM_UMIDA) foram purgados em sessões
anteriores; por isso os testes live versionados (`pipeline-live`,
`pipeline-process-live`, `pipeline-process-d7-live`, que exigem esses ZIPs e
fixam `carId: "270069"`) não rodam como estão. Usei os **fixtures commitados** em
`backend/fixtures/teste_1/` e mirei o **CAR-teste do env (271442, "Teste",
Querência)** — o único que o guard `assertTestCarId` permite mutar.

## 1. Planejador DeepSeek (autorreção) — LIVE, sem tocar a SEMA

`backend/simcar-oraculo/autofix/deepseek-live.test.ts` (`DEEPSEEK_LIVE=1`):

- Entrada: erro real da SEMA "AREA_UMIDA — geometria contém pontos repetidos ×11".
- Saída do `deepseek-v4-pro`: `fonte="deepseek"`, ação **exatamente**
  `remove_duplicate_vertices` em `AREA_UMIDA`, **sem** inventar ação nem camada
  fora do inventário permitido.
- **1 passed** (~9,6 s). Conectividade DeepSeek confirmada à parte (HTTP 200,
  `model=deepseek-v4-pro`, `reasoning_content` presente).

## 2. Pipeline completo + autofix contra a SEMA real — LIVE E2E

Harness ad-hoc (temporário, removido após a bateria) rodando
`startOraculoPipeline` com:

- **Input:** `backend/fixtures/teste_1/Recorte_13.07.26_CORRIGIDO_SIMCAR.zip`
  (`sha256 8f0f3af7…`) — o ZIP que a SEMA **reprova de verdade** (usado no teste
  offline de paridade como caso de reprovação).
- **CAR:** 271442 (`SIMCAR_TEST_CAR_ID`); `autoProcess=false`, `autofix=true`,
  `maxRounds=3`; `LOCAL_DATA_ROOT` apontado para scratch (não poluiu dados de
  produção).

### Timeline real observada

| Rodada | Passo | Resultado |
|--------|-------|-----------|
| 1 | município/abrangência | Já Querência; abrangência já cobre o shape (sem mutação de município) |
| 1 | login → upload → importar → poll | `[AGUARDANDO]` → `[EXECUTANDO]` → `[CONCLUIDO] [COM_PENDENCIA]` |
| 1 | **import_fail** | **Reprovado pela SEMA** — 4 grupos de erro (abaixo) |
| 1 | autofix_plan | `deepseek-v4-pro` montou o plano |
| 1 | autofix_apply | **3 ações mecânicas** aplicadas → `corrigido_r2.zip` |
| 2 | login → upload → importar → poll | `corrigido_r2.zip` → `[CONCLUIDO] [FINALIZADO]` |
| 2 | **import_ok** | **Aprovado pela SEMA — zero erros** |

Resultado final: `status=completed`, `ok=true`, `importOk=true`, `round=2`,
`autofixStopReason=null` (parou por sucesso). 6 artefatos por rodada gerados
(`enviado-zip`, `import-pdf`, `fixplan`, `corrigido-zip`).

### Erros reais da rodada 1 (SEMA)

| Camada | Erro | Qtd |
|--------|------|-----|
| ARL | Borda do polígono se cruza | 4 |
| ARL | A geometria contém pontos repetidos | 2 |
| AVN | Borda do polígono se cruza | 4 |
| AVN | A geometria contém pontos repetidos | 2 |

### Plano do DeepSeek e diff aplicado (rodada 1 → 2)

`fonte=deepseek`, `modelo=deepseek-v4-pro`, `naoCorrigivel=[]`. 3 ações em ARL+AVN:

| Ação | Efeito real (diffResumo) |
|------|--------------------------|
| `remove_duplicate_vertices` | ARL e AVN: −2 vértices (feições 66, 187) — resolve "pontos repetidos" |
| `unkink_self_intersection` | `alterou=false` (não havia auto-interseção real — nada tocado, correto) |
| `clean_degenerate_rings` | ARL e AVN: −4 anéis degenerados (feições 111,115,232,236); 242→238 registros — era a real causa do "borda se cruza" (anéis colapsados) |

Ou seja, o DeepSeek diagnosticou "borda se cruza" como **anéis degenerados**
(não auto-interseção) e escolheu as ações certas; o `unkink` entrou como rede de
segurança e corretamente não alterou nada. A rodada 2 passou limpa na SEMA.

## 3. Restauração do CAR-teste

Após a bateria, importei o **ZIP FINAL aprovado**
(`Recorte_SANTA_CLARA_FINAL_16-07-26.zip`, `sha256 195b5e27…`) no 271442 →
`[CONCLUIDO] [FINALIZADO]`, `importOk=true`. O CAR-teste ficou no estado
canônico conhecido (Santa clara / Querência), pronto para a próxima bateria.

## Conclusão

- **Autorreção via DeepSeek: comprovada ponta a ponta.** Um shapefile que a SEMA
  reprova (borda se cruza + pontos repetidos em ARL e AVN) foi **automaticamente
  corrigido e aprovado na 2ª rodada** pela SEMA real, com o plano vindo do
  `deepseek-v4-pro` e ações mecânicas determinísticas.
- **Oráculo (upload → município/abrangência → import → download de artefatos):**
  funcional contra a SEMA real, tanto no caminho de reprovação quanto no de
  aprovação.
- **Fallback sem IA** continua coberto pelos 188 testes offline (mapeamento fixo
  erro→ação); a IA propõe, o código dispõe (ações fora do inventário são
  descartadas).

### Como reproduzir

```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
set -a; source ~/.config/geoforest/backend.env; set +a
# (1) planejador DeepSeek isolado:
DEEPSEEK_LIVE=1 npx vitest run --root . backend/simcar-oraculo/autofix/deepseek-live.test.ts
# (2) E2E completo: recriar um harness que chama startOraculoPipeline com o
#     fixture backend/fixtures/teste_1/Recorte_13.07.26_CORRIGIDO_SIMCAR.zip,
#     carId=$SIMCAR_TEST_CAR_ID, autofix=true, autoProcess=false, maxRounds=3,
#     LOCAL_DATA_ROOT em scratch. Restaurar depois com o ZIP FINAL.
```

> Observação: os testes live versionados ainda apontam para os fixtures de
> scratch (V22/V23/SEM_UMIDA) e para o CAR 270069. Melhoria futura (não-bug):
> reapontá-los para os fixtures commitados de `teste_1` e para
> `SIMCAR_TEST_CAR_ID`, para que a bateria live seja reproduzível sem harness
> ad-hoc.
