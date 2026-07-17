# 01 — Arquitetura

## Contexto atual (repo GeoForest-IA)

| Peça | Caminho / fato |
|------|----------------|
| Backend Express | `backend/index.ts` |
| Import/process local (oráculo geométrico) | `backend/processar-projeto.ts` (`runImportPhase`, `runProcessPhase`) |
| Erros de geometria (import) | `backend/geometry-errors.ts` |
| Jobs + SSE | `backend/processing-jobs.ts` |
| Front aba | `client/src/components/ProcessarProjetoAnalysis.tsx` |
| Rotas públicas já listadas | `backend/index.ts` ~529–542 (`/api/processar-projeto/*`) |
| Cliente SIMCAR de laboratório | `.oraculo-scratch/simcar-client.mjs` |
| Scramble senha SEMA | `/home/acer/Documentos/acompanhamento-de-processos/backend-email-render/simcar-scramble.js` |
| Changelog oráculo 16/07 | `docs/CHANGELOG_2026-07-16_ORACULO_SEMA_SANTA_CLARA.md` |
| Projeto-teste atual | CAR **270069** Santa Clara (substituível por env) |

## Diagrama (modo ORACULO)

```
[Browser]  --Firebase Auth-->  [Backend PC servidor + CF Tunnel]
                                    |
                                    | SIMCAR_CPF / SIMCAR_SENHA (env)
                                    v
                              [simcar-oraculo]
                                    |
                    +---------------+----------------+
                    |                                |
              [1] preparar projeto-teste      [2] importar ZIP
                  municipio + abrangencia         poll Importacao*
                    |                                |
                    +---------------+----------------+
                                    |
                              [3] ProcessarGeo (opcional / botão)
                                    |
                              [4] download PDFs/ZIPs
                                    |
                              [5] eventos SSE + storage job
                                    v
                              [Browser timeline + downloads]
```

## Dois modos (config)

```ts
// backend/simcar-oraculo/config.ts
export type ProcessarMode = "LOCAL" | "ORACULO" | "HYBRID";

// env:
// PROCESSAR_MODE=ORACULO          // padrão desejado em produção no PC
// SIMCAR_TEST_CAR_ID=270069
// SIMCAR_CPF=...
// SIMCAR_SENHA=...
// SIMCAR_ROOT=https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api
```

| Mode | Comportamento |
|------|----------------|
| `LOCAL` | Hoje: só `runImportPhase` / `runProcessPhase` |
| `ORACULO` | Só SIMCAR real no projeto-teste; local opcionalmente desligado |
| `HYBRID` | Roda local **e** SIMCAR; mostra os dois (debug/calibração) |

**Decisão de produto (Álvaro):** em uso normal, `ORACULO` — “ao colocar um zip, importa no projeto teste”; validação local GeoForest pode ser desativada.

## Componentes novos no backend existente

```
backend/simcar-oraculo/
  config.ts
  scramble.ts              # reexport / copy mínima do scramble
  client.ts                # login, get, post, download, upload shape
  prepare-project.ts       # município + abrangência
  import-shape.ts          # upload + ImportarArquivoShape + poll
  process-geo.ts           # ProcessarGeo + poll
  artifacts.ts             # baixar PDFs/ZIPs para storage do job
  queue.ts                 # fila serial (1 job SIMCAR por vez)
  types.ts
  index.ts                 # API pública do módulo
backend/simcar-oraculo/*.test.ts
```

Integração em:
- `backend/processar-projeto.ts` — branches por `PROCESSAR_MODE`
- `backend/index.ts` — se precisar de rotas extras de download de artefato SIMCAR

## Fluxo de um job (ORACULO)

1. User sobe ZIP → `POST /api/processar-projeto/upload` (igual hoje) → sessionId
2. User clica Importar → `POST /api/processar-projeto/importar` → cria job SSE
3. Worker do job (no mesmo processo, via fila):
   - extrai bbox/município do ATP/AIR do ZIP
   - `prepareProject(testCarId, { municipio, bbox })`
   - `importShape(testCarId, zipBuffer)`
   - poll até `ImportacaoShapeStatus === [CONCLUIDO]`
   - baixa PDF import (+ shape se útil)
   - emite eventos: `preparando`, `ajustando_municipio`, `ajustando_abrangencia`, `enviando_zip`, `importando`, `import_ok` | `import_fail`
4. User clica Processar (ou auto se flag) → mesmo job ou job filho:
   - `ProcessarGeo`
   - poll process
   - baixa PDF process + ZIP erros
5. Front renderiza resultado “como SEMA” + botões de download

## Fila serial

SIMCAR técnico: **uma sessão por conta**. Implementar `queue.ts`:

```ts
// Pseudocódigo
let chain: Promise<void> = Promise.resolve();
export function enqueueSimcar<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.then(() => undefined, () => undefined);
  return run;
}
```

Todos os jobs ORACULO passam por `enqueueSimcar`.

## Storage de artefatos

Reusar `local-storage` / pasta de jobs existente:

```
STORAGE_ROOT/users/{uid}/simcar_oraculo/{jobId}/
  enviado.zip
  relatorio_importacao.pdf
  relatorio_processamento.pdf
  erros_processamento.zip   # se existir
  status.json
  timeline.json
```

## O que reutilizar do laboratório (não reescrever do zero)

- `.oraculo-scratch/simcar-client.mjs` → portar para TS em `client.ts`
- Endpoints já usados com sucesso no oráculo:
  - `Autenticacao/Autenticar`
  - `Requerimento/Buscar/{id}`
  - upload arquivo + `ImportarArquivoShape`
  - `Requerimento/ProcessarGeo/{id}`
  - `DownloadPdfImportacaoShapefile/{id}`
  - `DownloadPdfRelatorioProcessamento/{id}`
  - `DownloadArquivoErrosProcessamento/{id}`
- Endpoints a **descobrir/validar** na fase P2 (ver `04-municipio-e-abrangencia.md`):
  - alterar município na aba Propriedade
  - alterar área de abrangência na Caracterização
