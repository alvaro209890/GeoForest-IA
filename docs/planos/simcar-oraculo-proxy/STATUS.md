# STATUS do plano — Oráculo SIMCAR (v2)

**Atualizado:** 2026-07-17 (manhã) — consolidação pós-P5 e WIP T17 (Codex + Hermes).
Plano v2 e descoberta de endpoints SEMA (16/07) permanecem válidos.

## Decisões (ver 00-README)

D1 CAR-teste 270069 · D2 **remover validação local de vez** · D3 DeepSeek V4 Pro só
planeja/explica · D4 loop automático ≤3 rodadas · D5 `PropriedadeNome` intocável ·
D6 repo PÚBLICO → segredos só em env.

**D7 (2026-07-17, Álvaro):** se o erro de process de **AREA_UMIDA contida** não fechar após
**3 tentativas live** de correção mecânica no CAR-teste, **pode remover completamente a
camada AREA_UMIDA** do ZIP de teste, processar sem ela e seguir a bateria sem essa camada
(só no CAR-teste 270069 — não é regra de produto para imóvel real do usuário).

## Progresso

| Fase | Nome | Status |
|------|------|--------|
| P0 | Cliente + health + Buscar | ✅ (Hermes 16/07; live login/Buscar revalidado à noite) |
| P1 | Import API no CAR-teste | ✅ rotas prontas |
| **P1.5** | **Bugs bloqueantes (B1–B9)** | ✅ T1–T3 concluídas; B9 (modo local) sai em T18 |
| P2 | Município + abrangência | ✅ T4–T6; prepare live em skip e mutações T5 comprovadas |
| P3 | ProcessarGeo API | ✅ rotas prontas |
| P3.5 | Pipeline único + SSE + parse PDF | ✅ T7–T9 concluídas |
| P4 | Front ORACULO-only | ✅ T10–T12 concluídas |
| P5 | Autofix import + DeepSeek + loop | ✅ T13–T16; V23 aprovado live na rodada 2 |
| **P6** | **Autofix process** | 🔶 **T17 em progresso** (código + live parcial; gate V22×41 ainda aberto) |
| P7 | Limpeza + deploy + E2E | ⏳ T18–T19 |

## Descobertas de 2026-07-16 (noite) — ver `11-endpoints-sema-descobertos.md`

- Endpoints de ESCRITA achados no bundle: `SalvarGrupoPropriedade`, `SalvarGrupoCaracterizacao`,
  `SalvarAreaAbrangencia {Id + 4 coords Gdec}`, `LimparAreaAbrangencia` (**destrutivo**),
  `ReprocessarBaseRef`.
- Live (read-only, conta técnica): `Buscar/270069` completo (abrangência mora nele;
  `Municipio {Id:751, Codigo IBGE 5107065}`), `BuscarStatusProcessamento` (BaseRef/Croqui),
  `ListarMatoGrosso` (142 `{Chave,Texto}`), `BuscarMunicipioGeo/{IBGE}` → polígono oficial.
- `ListarRasc` exige filtro específico (400 genérico) — desnecessário p/ nós.
- Estado atual do 270069 após T16: Situacao `[EM_CADASTRAMENTO]`, import `[FINALIZADO]`
  (ZIP V23 corrigido pelo produto), process `[EM_ABERTO]`, município Querência.

## Bugs achados na revisão do código (P1.5 — detalhe em `02`)

B1 whitelist `simcar_oraculo_jobs` AUSENTE (rotas não persistem!) · B2 completed fixo ·
B3 timeline não acumula · B4 pdf-import/process mesmo campo · B5 GET sem timeout ·
B6 sem relogin 401 · B7 interrupted não cobre coleções novas · B8 áreas de storage sem tipo ·
B9 comentário × código do default de modo.

### Evidência de implementação desta retomada

- **T1 concluída (2026-07-16):** `simcar_oraculo_jobs` liberada para leitura, escrita e
  listagem no storage local; áreas de artefato `simcar-oraculo/*` tipadas e criadas no
  scaffold. `backend/simcar-oraculo/local-storage.test.ts`: **7/7 testes verdes** em storage
  temporário isolado.
- **T2 concluída (2026-07-16):** timeline agora faz read+append+write do array real durante o
  job; reprovação da regra SEMA é `completed` com `importOk=false`; import e process usam
  `importPdf*`/`processPdf*` independentes. `job-store.test.ts`: **3/3 testes verdes**.
- **T3 concluída (2026-07-16):** GET respeita timeout; `withSimcarAuthRetry` reloga uma vez
  em 401 e é usado em Buscar/import/process/download; boot marca jobs ativos do oráculo e do
  legado como `interrupted`. Declaração de `scramble-impl.js` adicionada e `tsc --noEmit`
  ficou limpo. Gate: **64/64** testes do oráculo+geometria e **11/11** de processar-projeto.
- **T4 concluída (2026-07-16):** malha oficial IBGE 2024 simplificada e reproduzível
  (`config/municipios-mt.geojson`, 142 feições); detecção local no `shape-context` com
  reprojeção UTM→4326; fallback live `Geoportal:LIM_MUNICIPIOS_MT`; endpoint de dropdown
  casa a lista SIMCAR (142 itens) com IBGE. Querência = `5107065`/Chave `751` confirmada live.
- **T5 concluída (2026-07-16):** probe guardado por `SIMCAR_LIVE=1` validou no 270069:
  Querência→Canarana→Querência com `PropriedadeNome="Santa clara"` intacto; sobrescrita direta
  da abrangência confirmou em 4,883 s, **sem Limpar**, e restauração em 1,817 s. BaseRef ficou
  `null` após alterar/restaurar (3 polls, ~11 s), comportamento aceito pelo contrato. Estado
  final confirmado: Querência/5107065 e bbox original.
- **T6 concluída (2026-07-16):** `prepare-project.ts` implementa confirmação oficial do
  município, payload integral com guard de `PropriedadeNome`, cobertura com margem, overwrite
  direto + `Limpar` somente no fallback e máquina BaseRef (`null`/CONCLUIDO/ERRO/timeout).
  **11/11 testes**; smoke live com o ZIP FINAL confirmou skip seguro em Querência, abrangência
  já suficiente e zero mutações.
- **T7 concluída (2026-07-16):** `sema-report-parse.ts` extrai situação e agrega erros mesmo
  quando as colunas vêm coladas ou a mensagem quebra linha. **7/7 testes** cobrem PDF inválido
  e os quatro relatórios reais: V21 sobreposição ×1; V22 import aprovado; V23 pontos repetidos
  ×11; V22 processamento/área úmida não contida ×41. Os PDFs-oráculo estão versionados como
  fixtures e o parse degradável preserva o PDF com `warnings` em vez de derrubar o job. Gate
  acumulado: **88/88 testes** do oráculo+geometria, `tsc --noEmit` e build de produção verdes.
- **T8 concluída (2026-07-16):** job único `queued→prepare→import→process` dentro de uma única
  aquisição da fila; `rounds[]`, timeline com `ts/round`, artefatos privados por job/rodada e
  `job.json`; SSE com snapshot/heartbeat/fechamento terminal; poll fallback, cancelamento entre
  polls com `Cancelar*` best-effort e retry 5xx 3 tentativas. Import reprovado termina
  `completed/importOk=false` sem disparar ProcessarGeo. Rotas pipeline/snapshot/SSE/artifact/
  cancel estão autenticadas; jobs são server-owned e a árvore não é servida pelo static;
  `/autofix` responde reserva explícita até P5. Gate acumulado:
  **97/97 testes** do oráculo+geometria, `tsc --noEmit` e build de produção verdes.
- **T9 concluída (2026-07-16):** cada rodada tenta os artefatos oficiais no momento correto:
  enviado após import; processado, conferência e pendências após ProcessarGeo; PDF import/
  process e ZIP de erros já permanecem no mesmo snapshot. 400/404 é ausência opcional e vira
  `artifactWarnings`, sem falhar o job. Probe live read-only no 270069 confirmou PDFs, ZIP
  enviado (641.273 bytes) e conferência (811.556 bytes); erros/processado/pendências estavam
  ausentes com HTTP 400 no estado atual. Nenhuma mutação foi feita. Gate da fase P3.5:
  **97/97** oráculo+geometria, **11/11** regressão processar-projeto, `tsc` e build verdes.
- **T10 concluída (2026-07-16):** `ProcessarProjetoAnalysis.tsx` foi reescrito sem botões,
  gates, tabelas ou relatórios do validador local. O fluxo agora é dropzone → preview do
  município (IBGE/WFS ou dropdown SIMCAR) → um único `POST /pipeline`; timeline por SSE com
  três reconexões e polling de contingência; cancelamento; restauração sem SSE para terminal;
  cards e downloads autenticados para todos os artefatos de cada rodada. O callback do
  histórico recebe só resumo/referências, não `timeline`/linhas extensas. `tsc --noEmit` e
  bundle Vite de produção verdes.
- **T11 concluída (2026-07-16):** o Dashboard lê `simcar_oraculo_jobs` e
  `processar_projeto_jobs` em paralelo, deduplica pelo ID com preferência pelo registro novo e
  mantém o legado somente leitura. Os quatro pontos de status/restauração/render foram
  atualizados para `running`, fila, cancelamento, interrupção e resultados funcionais
  import/process; cards exibem data, rodadas e badge final. O callback não grava cópia do job
  server-owned. Checklist React, `tsc` e bundle Vite verdes.
- **T12 concluída (2026-07-16):** os POSTs locais `/importar` e `/processar` agora devolvem
  410 `LOCAL_PROCESSING_REMOVED` com o caminho do pipeline real; `runProcessJob`, o gate
  `assertImportAllowsProcess` e o auto-import fallback foram removidos. O PDF GeoForest não
  participa mais da aba (só compatibilidade/teste legado), enquanto as fases puras seguem
  isoladas como biblioteca. Provas: **4/4** contratos de rota com upload/preview de Querência,
  **42/42** Erros de Geometria, **12/12** regressões locais/PDF e `tsc` verdes. P4 encerrada.
- **T13 concluída (2026-07-16):** `autofix/zip-rewrite.ts` regrava somente SHP/SHX/DBF da
  camada tocada, preserva payloads de todas as demais entradas e mantém PRJ/CPG byte a byte;
  recusa CRS métrico inseguro, desalinhamento SHP/SHX/DBF e geometria de saída inválida. As
  cinco ações mecânicas de import foram promovidas (`remove_duplicate_vertices`,
  `clean_degenerate_rings`, `unkink_self_intersection`, `remove_glued_holes` e
  `split_complex_polygon`), sem `buffer`, com novos IDs nas divisões e encadeamento sobre o
  ZIP anterior. Gate: **9/9 testes novos**, **42/42** geometria, **2/2** writer e `tsc` verdes.
  Prova offline no V23 real: 11 feições/73 vértices tratados, 2 registros colapsados removidos,
  zero ponto repetido restante e mesmas 38 feições/48 anéis/3.187 pontos/IDs/coordenadas do
  V24 aceito; o reenvio ao SIMCAR foi comprovado na T16.
- **T14 concluída (2026-07-16):** `autofix/deepseek.ts` chama `deepseek-v4-pro` por fetch
  nativo com JSON mode, raciocínio medium, timeout e uma repetição com `max_tokens` maior;
  Zod valida o contrato e conteúdo vazio/JSON inválido/API ausente degradam para o planner
  determinístico. `plan.ts` mapeia os erros às cinco ações de import (e ao clip P6), mantém
  casos de decisão em `naoCorrigivel` e só aceita pares ação×camada cujas precondições o código
  confirmou; ação/camada inventada é descartada. **9/9 testes** cobrem IA válida/inválida,
  retry, timeout, filtro e ausência de chave; gate acumulado **115/115**. Teste live explícito
  com a chave carregada apenas de `~/.hermes/.env` passou em **8,6 s**, planejando somente
  `remove_duplicate_vertices` para `AREA_UMIDA`; a chave não foi copiada nem persistida.
- **T15 concluída (2026-07-16):** o pipeline mantém uma única aquisição da fila e um único
  `prepare`, mas agora reimporta o ZIP corrigido por até três rodadas. Cada tentativa persiste
  `corrigido_rN.zip`, `fixplan.json`, plano inline, diff e resultado da rodada seguinte. As
  paradas `max_rounds`, `no_mechanical_action`, `no_improvement`, `no_changes` e
  `apply_failed` ficam explícitas no snapshot/timeline e nunca repetem uma ação insegura. O
  front ganhou modal acessível “O que a IA entendeu”, fonte/confiança/ações/contagens e botão
  pós-parada bloqueado com motivo quando não há ação nova. Testes mockados provam aprovação
  na rodada 2, “sem melhora”, teto 3/3 e plano sem ação; **78/78 testes do módulo** e `tsc`
  verdes. A rota manual saiu do placeholder e devolve guardas específicas.
- **T16 concluída (2026-07-17):** teste live guardado por `SIMCAR_LIVE=1` executou o V23 de
  SHA-256 `22d79a…f21f5a` no CAR 270069. Prepare confirmou Querência/abrangência sem mutação;
  rodada 1 voltou `[COM_PENDENCIA]` com 11 pontos repetidos. O `deepseek-v4-pro` planejou
  somente `remove_duplicate_vertices→AREA_UMIDA`; o executor tratou as 11 feições, removeu
  73 vértices e 2 anéis/registros colapsados. O ZIP corrigido e o `enviado.zip` oficial têm o
  mesmo SHA-256 `5ba311…042e8d`; rodada 2 voltou `[FINALIZADO]` e zero erro em **138,5 s**.
  Pós-condição read-only: nome “Santa clara” e Querência/5107065 intactos, import concluído;
  processamento ficou `[EM_ABERTO]` porque a prova isolou P5 com `autoProcess:false`.

### T17 (P6) — em progresso (Codex 17/07 manhã + consolidação Hermes)

**Objetivo do gate:** V22 no CAR 270069 → ProcessarGeo sem os **41** erros
`AREA_UMIDA deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA`.

#### Retomada 2026-07-17 (tarde) — decisão: fechar T17 por **D7** (Álvaro)

Como as tentativas de clip não zeraram os 41 no ProcessarGeo real (ver abaixo), o Álvaro
optou por acionar o **D7 direto**: fechar o gate de validação processando o ZIP da Santa
Clara **sem a camada AREA_UMIDA** (só no CAR-teste 270069; **não** é regra de produto — para
o usuário final, contenção de úmida que o clip não fecha vira `naoCorrigivel` com orientação GIS).

Feito nesta retomada (tudo fora do repo público — segredos/shapes gitignored):

- **Credenciais LIVE** em `.oraculo-scratch/simcar-oraculo.env` (CPF/senha SIMCAR + `DEEPSEEK_API_KEY`,
  `PROCESSAR_MODE=ORACULO`, `SIMCAR_TEST_CAR_ID=270069`). `.oraculo-scratch/` está no `.gitignore`.
- **Smoke read-only validado:** login TÉCNICO ok; `Buscar/270069` = "Santa clara", município
  **Querência/5107065**, `Situacao [EM_CADASTRAMENTO]`; status atual import `[FINALIZADO]`,
  process `[COM_PENDENCIA]` (resíduo da bateria V22).
- **Fixture D7 preparada e pinada:** o arquivo entregue continha as camadas dentro de uma
  pasta-wrapper + um zip aninhado; ambos os pacotes internos são byte-a-byte iguais e **nenhum**
  tem `AREA_UMIDA`. Reempacotado limpo (shapefiles na raiz, 27 camadas, todos componentes):
  `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_SEM_UMIDA.zip`
  SHA-256 `98a9f5f21a1088d1d3868acca2ee644071cf37236800a613f0152493934d98ec`.
- **Harness live D7:** `backend/simcar-oraculo/pipeline-process-d7-live.test.ts` (opt-in
  `SIMCAR_LIVE=1`, pinado no SHA acima). Assert: process sem contenção de úmida, sem camada
  `AREA_UMIDA` em erro algum, e o loop **não** aplica `clip_layer_to_cover` (nada mecânico a fazer).

Próximo passo: rodar o live D7 (muta o CAR-teste), registrar resultado e fechar o gate P6.

#### O que o Codex já entregou no código (WIP → commitado nesta rodada)

| Peça | Estado |
|------|--------|
| `autofix/actions/clip-layer-to-cover.ts` | implementado (~600+ LOC): clip AREA_UMIDA × AVN/AUAS/CONS, fragmentos &lt;100 m², IDs novos, sem `turf.buffer` |
| `apply.ts` / `types.ts` | `clip_layer_to_cover` no inventário process; `relatedLayers` no rewrite |
| `zip-rewrite.ts` | carrega camadas de apoio (AVN/AUAS/CONS) para a ação |
| `plan.ts` | erro de contenção → `clip_layer_to_cover` (fase process via `allowedActions`) |
| `pipeline.ts` | fase `process` no autofix + `PROCESS_AUTOFIX_ACTION_TYPES` |
| Testes offline | `actions.test.ts` (clip sintético + guard import-only) + `pipeline.test.ts` (fase process) **verdes** |
| Live harness | `pipeline-process-live.test.ts` (`SIMCAR_LIVE=1`, V22 SHA `58d44f…13f49fed`, expect r1×41 → clip → r2 contenção 0) |
| Scripts de diagnóstico | só em `.oraculo-scratch/*t17*` (gitignored): bisect, candidate ZIPs, equal-host, inside-probe, conference compare |

#### Live já rodado (evidência em `.oraculo-scratch/live-t17-data/`)

Job `live-t17-v22-3d3f62d5-…` (2026-07-17 ~02:30–05:40 local):

1. **R1 import** `[FINALIZADO]`
2. **R1 process** `[COM_PENDENCIA]` — `AREA_UMIDA` contida **×41** (oráculo esperado)
3. **Plano DeepSeek:** `clip_layer_to_cover → AREA_UMIDA` (fonte `deepseek-v4-pro`)
4. **Diff local:** alterou=true; 29 feições; 379 vértices removidos; 3 registros removidos; 1 criado;
   3 fragmentos &lt;100 m² descartados
5. **R2 import** `[FINALIZADO]` de novo
6. **R2 process** ainda **×41** contenção — **sem melhora**
7. Stop: `no_improvement` (mesma assinatura de ação + mesma qtd de erros)

Conclusão da prova: o **pipeline/process-autofix encadeia de verdade** no SIMCAR real, mas o
**clip atual não fecha o veredito SEMA** nos 41 (local “parece” recortar; SEMA mantém a contagem).

#### Experimentos Codex (não productizados) — o que ensinaram

| Experimento (scratch) | Resultado SEMA process (ordem de grandeza) | Lição |
|------------------------|--------------------------------------------|--------|
| Clip produto (V22) | 41 → 41 | Clip união + limpeza **não basta** sozinho no ProcessarGeo real |
| Candidates “agressivos” / limpezas | 54–55, 45, **1**, **3** | Dá para **baixar** contagem em variantes manuais; **1 e 3** quase fecham — residual cartográfico fino |
| Bisect import de variantes | vários `[COM_PENDENCIA]` import | Algumas geometrias de sonda **quebram import** (não só process) |
| Equal-host / inside squares | sondas | Testar se SEMA aceita polígono “claramente dentro” de um host; ainda restam falhas residuais |
| Conferência SEMA vs ZIP enviado | scripts `compare-t17-conference` | ProcessarGeo pode avaliar em topologia/BaseRef **diferente** do que o shapefile local assume |

#### Descobertas / hipóteses técnicas (Hermes 17/07)

1. **Clip por união AVN∪AUAS∪CONS** (residual da união ≈ 0) **não implica** aprovação SEMA.
   Mensagem SEMA usa “contida por AVN, AUAS **ou** AREA_CONSOLIDADA” — leitura forte: cada
   feição deve caber em **um host individual**, não só na união. Código WIP passou a **não
   re-unir pedaços de hosts diferentes** e a checar contenção por host (com tolerância).
2. **~41 úmidas** no Santa Clara batem com a calibração antiga: úmida sobre **hidro / buraco
   de composição da AIR** (AVN com furo de rio/lagoa). Recortar só a úmida **não recria** o
   host; partes sobre água somem no clip e o que sobra ainda pode falhar borda/precision SEMA.
3. **Não clipar AVN por hidrografia** continua regra dura (abriu os 41 no histórico v8→v9).
4. **Prova local ≠ prova SEMA:** detector GeoForest / residual turf pode dar “ok” e o PDF
   SEMA manter ×41. Gate T17 **só** com ProcessarGeo real.
5. **D7 (fallback autorizado):** após 3 tentativas live de fix mecânico de contenção, **remover
   AREA_UMIDA do ZIP de teste** e seguir process sem a camada no CAR 270069.

#### O que ainda falta (P6 + P7)

| # | Item | Notas |
|---|------|--------|
| T17a | Fechar clip (ou estratégia) que **zere** contenção no V22 live **ou** acionar D7 | Preferir clip/host-split; se 3 lives falharem → drop camada no teste |
| T17b | `naoCorrigivel` explícito p/ residual cartográfico (reservatório/ARL/hidro) | Orientação GIS no front |
| T17c | Commit message de fechamento + STATUS ☑ quando gate V22 (ou D7 documentado) passar | |
| T18 | Remover `PROCESSAR_MODE`/código local morto + docs `SIMCAR_ORACULO.md` / README | |
| T19 | Env PC servidor, deploy, health `simcarConfigured && deepseekConfigured`, E2E `09`, restaurar FINAL no 270069 | |
| Ops | Nunca commitar `.oraculo-scratch/simcar-oraculo.env` (CPF/senha/DeepSeek) | repo público |

**Estimativa residual do plano:** ~15–20% (T17 difícil + T18/T19 ops). Arquitetura P0–P5 está
fechada e no `main`.

## Credenciais

- Conta técnica: valores em `.oraculo-scratch/simcar-oraculo.env` (gitignored, este PC) e no
  env do PC servidor. **Nunca** commitadas (repo público).
- DeepSeek: `DEEPSEEK_API_KEY` de `~/.hermes/.env` → env do backend.

## Como retomar

1. Ler **esta seção T17** + `06-autofix-roadmap.md` (regras de engenharia) + `09` (oráculos)
2. `07-tarefas-implementacao.md` → T17 (detalhe) → T18 → T19
3. Antes de codar SEMA: `11-endpoints-sema-descobertos.md`
4. Live: `set -a && source .oraculo-scratch/simcar-oraculo.env && set +a` e
   `SIMCAR_LIVE=1 npx vitest run --root . backend/simcar-oraculo/pipeline-process-live.test.ts`
5. Se 3 lives de contenção falharem → aplicar **D7** (ZIP sem AREA_UMIDA no CAR-teste) e
   documentar resultado em `09` + checklist `12`
