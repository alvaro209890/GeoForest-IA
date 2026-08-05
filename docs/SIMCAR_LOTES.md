# Lotes SIMCAR — download automático dos documentos do CAR

Aba do GeoForest que automatiza o que a IMAP fazia à mão: entrar no SIMCAR técnico,
abrir cada CAR e baixar os arquivos da seção "Documentos" para a pasta do lote.

> Plano completo: [`docs/planos/simcar-lotes/`](planos/simcar-lotes/INDEX.md).
> Changelog: [`CHANGELOG_2026-08-05_SIMCAR_LOTES.md`](CHANGELOG_2026-08-05_SIMCAR_LOTES.md).

## Fluxo do usuário

```
1. Aba "Lotes" (/dashboard/lotes)
2. CPF + senha do SIMCAR (conta técnica) → salvos no navegador
3. Arrasta os recibos: 1+ PDFs ou um ZIP
4. "Analisar recibos" → tabela dos lotes detectados (CAR editável)
5. "Baixar documentos do lote" → progresso por lote/arquivo
6. ZIP único, uma pasta por lote:
   MT10005-2019 - LOTE_RURAL_81/
     ├── Arquivo Enviado.zip
     ├── Arquivo Processado.zip
     └── Recibo de Inscricao.pdf
   RELATORIO.txt
```

## Arquitetura

O trabalho pesado roda no **backend do PC servidor** (a SEMA só responde a IP
brasileiro). As credenciais viajam por requisição (HTTPS/Cloudflare Tunnel), vivem
apenas na memória do job e **nunca** são gravadas no servidor nem logadas.

| Arquivo | Papel |
|---|---|
| `backend/simcar-lotes/routes.ts` | Rotas Express + job em background |
| `backend/simcar-lotes/job.ts` | Orquestra login → resolver → baixar → zipar |
| `backend/simcar-lotes/recibo-parse.ts` | `pdf-parse` → nº CAR / propriedade / município |
| `backend/simcar-lotes/resolver.ts` | nº CAR → `RequerimentoId` (ListarRasc + API pública) |
| `backend/simcar-lotes/downloader.ts` | Baixa os 3 artefatos; 400 = ausente → faltante |
| `backend/simcar-lotes/zip-builder.ts` | Pasta por lote + `RELATORIO.txt` |
| `backend/simcar-lotes/session-queue.ts` | Fila serial por conta (sessão única da SEMA) |
| `client/src/components/SimcarLotesPanel.tsx` | Painel (credenciais, dropzone, progresso) |

## Rotas

| Rota | Método | Corpo / retorno |
|---|---|---|
| `/api/simcar-lotes/parse-recibos` | POST | `{zipBase64, filename}` → `{lotes: ReciboParseado[]}` — **não toca na SEMA** |
| `/api/simcar-lotes/process` | POST | `{zipBase64, filename, cpf, senha, carsManuais?}` → `202 {jobId}` |
| `/api/simcar-lotes/jobs/:jobId/status` | GET | `{ok, job}` |
| `/api/simcar-lotes/jobs/:jobId/events` | GET | SSE: `snapshot`, `progress`, `heartbeat` (15 s) |
| `/api/simcar-lotes/download/:jobId` | GET | ZIP (`Content-Disposition: attachment`) |
| `/api/simcar-lotes/jobs/:jobId` | DELETE | cancela (job em andamento) ou apaga o ZIP (job concluído) |

Todas exigem token Firebase (`AUTH_REQUIRED_PATHS` em `backend/app.ts`).

## Endpoints da SEMA usados

| Artefato | Endpoint | Autenticação |
|---|---|---|
| `Arquivo Enviado.zip` | `Requerimento/DownloadArquivoEnviado/{id}` | sessão técnica do usuário |
| `Arquivo Processado.zip` | `Requerimento/DownloadArquivoProcessado/{id}` | sessão técnica do usuário |
| `Recibo de Inscricao.pdf` | `Publico/DownloadReciboCar/{id}` | **pública, sem login** |
| resolver nº CAR → Id | `Requerimento/ListarRasc` | sessão técnica |
| recibo federal → nº CAR | `Publico/ListarRequerimento` (`NUMERO_CAR_FERERAL`) | pública |

> ⚠️ **Há DOIS espaços de Id** (confirmado ao vivo em 2026-08-05 com `MT10005/2019`):
>
> | API | Id | Onde usar |
> |---|---|---|
> | técnica (`Requerimento/ListarRasc`) | **10005** | `DownloadArquivoEnviado` / `DownloadArquivoProcessado` |
> | pública (`Publico/ListarRequerimento`) | **470498** (com `RId: 10005`) | `Publico/DownloadReciboCar` |
>
> Trocar um pelo outro faz o download falhar. Por isso `resolver.ts` faz **duas
> consultas separadas**: `resolverCar()` para o Id técnico e `requerimentoIdPublico()`
> para o do recibo. O Id técnico coincide com o `RId` do público, mas não com o `Id`.

Contrato completo em
[`docs/planos/simcar-oraculo-proxy/11-endpoints-sema-descobertos.md`](planos/simcar-oraculo-proxy/11-endpoints-sema-descobertos.md).

### Detalhes descobertos ao vivo (2026-08-05)

- `Publico/DownloadReciboCar` responde **HTTP 411 (Length Required)** sem corpo — é
  preciso mandar `{}` com `Content-Type: application/json`. O downloader já faz isso.
- O texto do recibo extraído por `pdf-parse` traz **rótulo e valor em linhas
  separadas** e as colunas **coladas sem separador**:

  ```
  Nº CAR EstadualSituação EstadualTipo
  MT10005/2019AtivoDeclarado
  PropriedadeUFMunicípio
  LOTE RURAL 81MTQuerência
  ```

  Por isso o parser lê a linha SEGUINTE ao rótulo, e o regex do CAR **não** pode ter
  `\b` no fim (entre `2019` e `Ativo` não existe fronteira de palavra).

## Regras de negócio

| Situação | Comportamento |
|---|---|
| CAR sem "Arquivo Processado" (HTTP 400) | Entra em `faltantes`, o lote conclui normalmente (⚠ na UI) |
| Recibo público indisponível | Usa o PDF que o usuário enviou como `Recibo de Inscricao.pdf` |
| Um lote falha (CAR fora da conta, rede) | Vira linha de erro no relatório; os outros lotes seguem |
| Cancelamento | Entrega ZIP **parcial** com os lotes já concluídos (decisão A2) |
| Conta SIMCAR em uso pelo oráculo | Espera na fila até 120 s; depois erro "conta em uso" |
| CAR não identificado no PDF | Campo editável na tabela antes de baixar (decisão A3) |

## Sessão única da SEMA

A SEMA permite **uma sessão por conta**. `backend/simcar-oraculo/client.ts` mantém
um `Map` de sessões **por credencial** (`getSimcarTokenFor`, `withSimcarAuthRetryFor`),
com single-flight por chave, e `session-queue.ts` serializa as chamadas da mesma
conta dentro do processo. Contas diferentes (oráculo × usuário) não se bloqueiam.

## Limites conhecidos

- O envio vai em base64 no corpo JSON; `express.json` está em **25 MB** — na prática
  ~18 MB de PDFs (≈ 25 recibos). Acima disso o backend responde 413.
- Só 3 artefatos por lote (decisão A1). Relatórios de importação/processamento,
  conferência, pendências e croquis ficam para uma fase 2 — os endpoints já estão
  catalogados no doc 11 do plano do oráculo.
- O download depende de credenciais **válidas** do SIMCAR. A conta tem bloqueio após
  3 tentativas de login inválidas — nunca "testar mais uma vez" sem certeza da senha.

## Validação ao vivo (2026-08-05)

Fluxo completo com a conta técnica contra a SEMA real, CAR `MT10005/2019`:

| Etapa | Resultado |
|---|---|
| Login (`Autenticacao/Autenticar`) | OK |
| `resolverCar` (ListarRasc) | `requerimentoId: 10005`, `[EM_ANALISE]`, LOTE RURAL 81, Querência |
| `Arquivo Enviado.zip` | **32.803 bytes** — 156 arquivos (AIR, APP, APPD… shapefiles) |
| `Arquivo Processado.zip` | **36.954 bytes** — 148 arquivos (AREA_ABRANGENCIA, ATP…) |
| `Recibo de Inscricao.pdf` | **665.078 bytes**, `%PDF-` (API pública, Id 470498) |
| ZIP final | **654.219 bytes** — `MT10005-2019 - LOTE_RURAL_81/` com os 3 + `RELATORIO.txt` |

O parser também foi validado contra o PDF real do recibo: extraiu `MT10005/2019`,
o recibo federal, `LOTE RURAL 81` e `Querência`.

## Testes

```bash
pnpm run check
pnpm run test          # 56 testes só de backend/simcar-lotes/
pnpm run build
```

Cobertura: parser (layout real), resolver (mock de fetch, filtro exato, fallback
federal), downloader (400/401/magic bytes/fallback do recibo), zip-builder
(estrutura, sanitização, desambiguação), fila por conta e um end-to-end de rota com
SEMA falsa (recibo → ZIP com as 3 pastas + `RELATORIO.txt`).
