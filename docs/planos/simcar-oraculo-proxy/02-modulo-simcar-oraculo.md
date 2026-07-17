# 02 — Módulo `backend/simcar-oraculo` (estado real + P1.5 + extensões)

## O que JÁ existe e funciona (rodada Hermes 16/07, live login/Buscar OK)

| Arquivo | Conteúdo | Notas |
|---------|----------|-------|
| `config.ts` | env SIMCAR_* (cpf/senha/testCarId/root/polls/timeouts) | `PROCESSAR_MODE` será REMOVIDO (D2) |
| `scramble.ts` + `scramble-impl.js` | scramble verbatim do bundle | ok |
| `client.ts` | login (token cache 25min), get/post/download/uploadZip, Buscar, BuscarStatusProcessamento | headers browser-like ok |
| `queue.ts` | fila serial global + length | ok |
| `import-shape.ts` | upload → ImportarArquivoShape {RequerimentoId, Arquivo} → poll → PDF | ok (guard assertTestCarId) |
| `process-geo.ts` | ProcessarGeo/{id} → poll → PDF + erros-zip | ok |
| `shape-context.ts` | bbox/centroid/camadas do ZIP (local) | municipioHint nunca preenchido (P2) |
| `routes.ts` | 8 rotas `/api/simcar-oraculo/*` | ⚠️ bugs P1.5 abaixo |
| `simcar-oraculo.test.ts` | 8 testes | ampliar |

## P1.5 — BUGS a corrigir ANTES de tudo (achados na revisão de 16/07)

**Status 2026-07-16:** T1–T3 concluídas e cobertas por testes. B1–B8 foram corrigidos;
B9 é a remoção arquitetural de `PROCESSAR_MODE` programada para T18.

| # | Bug | Onde | Correção |
|---|-----|------|----------|
| B1 | **Coleção `simcar_oraculo_jobs` fora da whitelist** → `writeDocBySegments` lança INVALID_DOC_PATH e `readDocBySegments` devolve null: **as rotas do oráculo não persistem job nenhum em runtime** (foram validadas por script, não pela rota) | `local-storage.ts:204` e `:212` | adicionar `simcar_oraculo_jobs` às duas whitelists + teste de round-trip |
| B2 | Status final do import é SEMPRE `completed` mesmo com `outcome.ok=false` (`outcome.ok ? "completed" : "completed"`) | `routes.ts:161` | `ok ? 'completed' : 'completed'`→ manter `completed` com `importOk:false` é DESEJADO para import reprovado (não é falha de infra), mas o ternário morto confunde — trocar por constante + comentário; falha de INFRA (exception) continua `failed` |
| B3 | `timelinePush` persistido como campo literal — merge shallow não faz append; timeline não acumula até o final sobrescrever | `routes.ts:144` | ler doc atual, `timeline: [...(doc.timeline||[]), evento]` (ou acumular em memória e gravar sempre o array inteiro) |
| B4 | `/jobs/:id/pdf-import` e `/pdf-process` leem o MESMO campo `pdfRelativePath` | `routes.ts:321-322` | campos separados `importPdfRelativePath` / `processPdfRelativePath` (pipeline único vai ter os dois no mesmo job) |
| B5 | `simcarGet` aceita `timeoutMs` e não repassa ao req | `client.ts:97-110` | repassar |
| B6 | 401/sessão derrubada no meio de import/process não renova token (só `test-project` faz `clearSimcarTokenCache`) | `client.ts` + fluxos | wrapper `withSimcarAuthRetry(fn)`: em 401, clear cache + relogin + 1 retry |
| B7 | `markPersistedRunningJobsInterrupted` não cobre `processar_projeto_jobs` nem `simcar_oraculo_jobs` → job fica `running` para sempre após restart | `backend/index.ts` (boot) | incluir as coleções novas |
| B8 | `saveUserBuffer` não tipa as áreas `simcar-oraculo/*` | `local-storage.ts:272-291` | adicionar áreas tipadas + `ensureUserScaffold` |
| B9 | Comentário do config promete default ORACULO mas código default LOCAL | `config.ts:29-31` | some junto com PROCESSAR_MODE (D2): `simcarConfigured` passa a ser o único gate |

## Extensões novas do módulo

```
backend/simcar-oraculo/
  prepare-project.ts      # P2 — município + abrangência (ver 04)
  municipio-mt.ts         # P2 — malha IBGE MT local + point-in-polygon + nome→{ibge, chaveSimcar}
  pipeline.ts             # P3.5 — orquestra prepare→import→process→artefatos→rounds
  sema-report-parse.ts    # P3.5 — PDF SEMA → errosResumo[] {camada, erro, qtd, feicoes?}
  autofix/                # P5/P6 — ver 06
    plan.ts  apply.ts  deepseek.ts  actions/*.ts
```

### `pipeline.ts` (assinatura)

```ts
export async function runOraculoPipeline(args: {
  uid: string;
  jobId: string;
  zip: Buffer;                 // rodada 1 = ZIP do usuário
  fileName: string;
  autoProcess: boolean;        // default true (decisão do fluxo)
  autofix: boolean;            // default true (D4)
  maxRounds: number;           // default 3 (AUTOFIX_MAX_ROUNDS)
  onEvent: (ev: OraculoEvent) => void;   // persiste timeline + SSE
}): Promise<OraculoJobResult>;
```

Regras:
- TUDO que toca SEMA dentro de `enqueueSimcar` (rodada inteira; rodadas seguintes re-enfileiram).
- `assertTestCarId` antes de QUALQUER mutação (prepare/import/process) — permanece lei.
- Cancelamento: checar `cancelRequested` entre cada poll; SEMA não cancela mid-flight de forma
  confiável (existem `CancelarImportacaoShape`/`CancelarProcessamentoGeo` — tentar best-effort e
  registrar na timeline; nunca confiar).
- Timeout por etapa: import 15 min, process 30 min, BaseRef 20 min (`SIMCAR_BASEREF_TIMEOUT_MS`).
- Falha de INFRA (timeout, 5xx persistente, login) → job `failed`. Reprovação da SEMA
  (COM_PENDENCIA) → job `completed` com `importOk/processOk=false` — é resultado, não erro.

### `sema-report-parse.ts`

- Implementado em T7: extrai texto do PDF de importação/processamento da SEMA com `pdf-parse`.
- Saída: `{ tipo, situacao, resumo: [{camada, erro, qtd}], porFeicao, raw, warnings }`.
- Reconstrói mensagens quebradas em várias linhas, tolera coluna da camada colada ao erro e
  agrega linhas iguais. Uma camada citada dentro da mensagem (por exemplo `AVN, AUAS`) não é
  confundida com o início de outro registro.
- Mensagens-alvo conhecidas (calibradas 16/07): "A geometria contém pontos repetidos",
  "Borda do polígono se cruza", "Duas ou mais bordas ou buracos… se sobrepõem",
  "Polígono complexo…", "Geometria deve ser completamente contida por AVN, AUAS ou AREA_CONSOLIDADA…".
- Se o parse falhar: PDF continua disponível; `errosResumo=[]` + warning na timeline
  (autofix então usa DeepSeek como fallback de leitura — ver 06).

Oráculos reais versionados em `backend/fixtures/teste_1/`:

| Fixture | SHA-256 | Resultado estruturado |
|---------|---------|------------------------|
| `relatorio_importacao_v21_sema.pdf` | `85591101e58745c21b461fbb10857e07d3300976a9dda82d21bbf88048399dae` | `AREA_UMIDA`, bordas/buracos sobrepostos ×1 |
| `relatorio_importacao_v22_sema.pdf` | `cc4d34c3f0847d856a6999b527a870d192712489779054a47e292511c0a557b1` | aprovado, nenhum erro inventado |
| `relatorio_importacao_v23_sema.pdf` | `3b262f96acf700338a1024f063b6ed2915ab7ba4e808ac89862f2ed715077b89` | `AREA_UMIDA`, pontos repetidos ×11 |
| `relatorio_processamento_v22_sema.pdf` | `d44d9e6ce86e0a2a3612eed762b1482713619c62dfa9d1940381dd7dc7adb90f` | `AREA_UMIDA`, fora da cobertura ×41 |

## Testes do módulo (ampliar)

| Teste | O quê |
|-------|-------|
| `local-storage` round-trip `simcar_oraculo_jobs` | B1 |
| timeline append (3 eventos → array com 3) | B3 |
| poll machine import/process com sequência fake AGUARDANDO→EXECUTANDO→CONCLUIDO | cobre timeouts e [ERRO] |
| `withSimcarAuthRetry` renova em 401 e não loopa | B6 |
| `prepare-project` com mock (município igual → skip; diferente → salvar+re-Buscar) | P2 |
| `municipio-mt` centroid Querência → 5107065 | P2 |
| `sema-report-parse` com quatro PDFs reais v21/v22/v23 versionados | P3.5 — 7 testes verdes |
| pipeline: import reprova → não processa → autofix roda → 2ª rodada | P5 (mock SEMA) |

Live (manual, PC): `SIMCAR_LIVE=1` + scripts `scripts/smoke-*.ts` (nunca em CI).
