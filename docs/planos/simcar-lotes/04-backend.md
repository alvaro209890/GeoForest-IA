# 04 — Backend (`backend/simcar-lotes/`)

## Estrutura de arquivos

```
backend/simcar-lotes/
├── index.ts          # rotas Express + job SSE (padrão croqui.ts)
├── recibo-parse.ts   # pdf-parse → { carEstadual, reciboFederal, propriedade, municipio }
├── resolver.ts       # nº CAR → { requerimentoId, numeroCompleto, situacao, propriedade }
├── downloader.ts     # tabela de artefatos + baixa cada um (client.ts)
├── zip-builder.ts    # archiver: pasta por lote → ZIP único
└── types.ts          # tipos compartilhados (ReciboParseado, ArtefatoLote, RelatorioLote, …)
```

## Rotas

| Rota | Método | Auth | Body | Retorno |
|---|---|---|---|---|
| `/api/simcar-lotes/parse-recibos` | POST | `requireAuth` | `{zipBase64}` | `{lotes: ReciboParseado[]}` (sem tocar a SEMA) |
| `/api/simcar-lotes/process` | POST | `requireAuth` | `{zipBase64, cpf, senha}` | `202 {jobId}` (job SSE em background) |
| `/api/simcar-lotes/jobs/:jobId/status` | GET | `requireAuth` | – | `{ok, job}` (leitura Firestore/local) |
| `/api/simcar-lotes/jobs/:jobId/events` | GET | `requireAuth` | – | SSE: `snapshot`, `progress`, `heartbeat` |
| `/api/simcar-lotes/download/:jobId` | GET | `requireAuth` | – | ZIP final (`Content-Disposition: attachment`) |

Registro: `backend/routes/_registry.ts` (`registerSimcarLotesRoutes`) + `backend/app.ts` → `AUTH_REQUIRED_PATHS`:
```ts
"/api/simcar-lotes/parse-recibos",
"/api/simcar-lotes/process",
/^\/api\/simcar-lotes\/jobs\/[^/]+\/(status|events)$/,
/^\/api\/simcar-lotes\/download\/[^/]+$/,
```

## `recibo-parse.ts`

```ts
import { parsePdfText } from "../simcar-oraculo/sema-report-parse"; // ou import dinâmico de pdf-parse
// Fallback: import("pdf-parse") direto (mesmo padrão do sema-report-parse.ts:47)

export interface ReciboParseado {
  filename: string;
  carEstadual: string | null;     // "MT10005/2019"
  reciboFederal: string | null;   // "MT-5107065-AEC311BDEA79437099F3D97F9D599345"
  propriedade: string | null;
  municipio: string | null;
}

const RX_CAR_ESTADUAL = /N[º°]\s*CAR\s+ESTADUAL\s*:?\s*(MT[- ]?\d+\s*\/\s*\d{4})/i;
const RX_RECIBO_FEDERAL = /\b(MT-\d{7}-[A-F0-9]{20,})\b/i;
const RX_PROPRIEDADE = /PROPRIEDADE\s*:?\s*(.+)/i;
const RX_MUNICIPIO = /MUNIC[ÍI]PIO\s*:?\s*([A-ZÀ-Ú ]+)/i;

export function parseReciboText(text: string, filename: string): ReciboParseado { … }
export async function parseReciboPdf(buffer: Buffer, filename: string): Promise<ReciboParseado> { … }
```

- Recibo estadual (layout do vídeo): "Nº CAR Estadual", "Nº Recibo Federal", "Propriedade", "Município".
- Recibo federal (SICAR, layout diferente): fallback genérico `\bMT\d{5,9}/\d{4}\b`; se nada for encontrado → `carEstadual: null` → o resolver tenta pelo `reciboFederal`.
- **Normalização:** remover hífens/espaços → `MT10005/2019` (mesmo `normalizeCarInput` de `simcar-receipts.ts`).

## `resolver.ts`

```ts
// Entrada: nº CAR estadual OU recibo federal. Saída: Id do requerimento no SIMCAR técnico.
export async function resolverCar(
  carEstadual: string | null,
  reciboFederal: string | null,
  token: string, // sessão do usuário (job)
): Promise<ResolucaoCar> // { requerimentoId, numeroCompleto, situacao, propriedade, municipio }
```

1. Se só `reciboFederal`: `POST /Publico/ListarRequerimento` `{Filtros:{NUMERO_CAR_FERERAL: reciboFederal}, ItensPorPagina:50, …}` (público, sem token) → `NumeroCompleto` estadual.
2. `POST /Requerimento/ListarRasc` com o **body completo** do acompanhamento:
   ```json
   { "Filtros": { "NUMERO": "MT10005/2019" }, "ItensPorPagina": 10, "Pagina": 1,
     "IsOrdenarCrescente": false, "ColunaOrdenar": "NumeroCompleto", "Colunas": [] }
   ```
   → re-filtra `Itens` por `NumeroCompleto` **exato** (a SEMA às vezes ignora o filtro e devolve a conta inteira).
3. Erros: CAR não encontrado → lote marcado `erro: "CAR não localizado na conta"` (não falha o job).

## `downloader.ts` — artefatos por lote (decisão A1: só 3)

| Artefato (nome na pasta) | Endpoint (`{id}` = requerimentoId) | Autenticação |
|---|---|---|
| `Arquivo Enviado.zip` | `Requerimento/DownloadArquivoEnviado/{id}` | técnica (`authorization`) |
| `Arquivo Processado.zip` | `Requerimento/DownloadArquivoProcessado/{id}` | técnica |
| `Recibo de Inscricao.pdf` | `Publico/DownloadReciboCar/{id}` (API pública) | **sem login** |

- `Arquivo Enviado`/`Arquivo Processado` via `simcarDownload(token, path)` do `client.ts` (já cobre fallback form-urlencoded e timeout 300s).
- **Recibo:** baixar via API **pública** (não consome sessão da conta técnica); se falhar (404/400/rede), **fallback = cópia local do PDF de entrada** (`reciboEnviado`), garantindo que a pasta do lote sempre tenha o recibo.
- **400** → `null` (skip) + `faltantes[]`. **401/403** → sessão derrubada → `withSimcarAuthRetryFor` (re-loga 1×).
- Validação de conteúdo: `%PDF` / `PK\x03\x04`.

## Refactor de `backend/simcar-oraculo/client.ts` (sessão por credencial)

Hoje:
```ts
let tokenCache: TokenCache | null = null;              // global (conta do env)
export async function getSimcarToken(): Promise<string> // usa SIMCAR_CPF/SIMCAR_SENHA
```

Vira:
```ts
const chaveCredencial = (cpf: string, senha: string) => `${cpf.replace(/\D/g, "")}:${senha}`;
const sessoes = new Map<string, TokenCache>();          // por chave de credencial
const loginsEmVoo = new Map<string, Promise<string>>(); // single-flight por chave

export async function getSimcarToken(): Promise<string> {
  // oráculo: usa env (comportamento atual intacto) → delega a getSimcarTokenFor(env.cpf, env.senha)
}
export async function getSimcarTokenFor(cpf: string, senha: string): Promise<string> { … }
export function clearSimcarTokenCache(chave?: string): void { … }
export async function withSimcarAuthRetryFor<T>(cpf, senha, op): Promise<T> { … } // wrapper que usa a sessão por chave
```

**Mutex por chave** (sessão única da SEMA): fila de promessas serializando chamadas da mesma conta dentro do processo:
```ts
// backend/simcar-lotes/session-queue.ts (ou dentro do client.ts)
export async function comSessaoExclusiva<T>(cpf: string, senha: string, fn: () => Promise<T>, timeoutMs = 120_000): Promise<T>
```
- Se o oráculo estiver rodando com a **mesma conta** do usuário, o job de lotes espera até `timeoutMs` e então falha com: `"A conta SIMCAR está em uso por outro processo (oráculo). Tente novamente em alguns minutos."`
- Contas diferentes não se bloqueiam.

## `zip-builder.ts`

```ts
export function montarZipLotes(
  lotes: { nomePasta: string; arquivos: { nome: string; buffer: Buffer }[] }[],
): Promise<Buffer> // archiver("zip", { zlib: { level: 9 } })
```
- Nome da pasta: `${carSemBarra} - ${propriedade}` → sanitizado (`safeFilename` de `simcar-receipts.ts:70`): `MT10005-2019 - LOTE_RURAL_81`.
- Nome do ZIP: `lotes_simcar_<YYYYMMDD-HHMMSS>.zip`.
- Persistência: `saveUserBuffer(uid, ["simcar_lotes", jobId, "lotes.zip"], buffer)` (helper de `backend/local-storage.ts`, já usado em `simcar/routes.ts`).

## Job SSE (`index.ts`) — padrão `croqui.ts`

1. `startJob({uid, endpoint: "/api/simcar-lotes/process", metadata:{totalLotes}})` + `persistJob` (status `queued` → `processing`).
2. Execução em `void runLotesJob({uid, jobId, zipBase64, cpf, senha})`:
   - progresso: `{type:"progress", fase:"login"|"resolvendo"|"baixando"|"zipando", loteAtual, totalLotes, loteNome, artefatoAtual, totalArtefatos, baixados, faltantes, relatorio}`
   - heartbeat 15s; `isCancelRequested(jobId)` → aborta preservando o que já baixou (cancelamento = ZIP parcial? **decisão:** sim, entrega o ZIP com os lotes concluídos + marca `cancelado: true`).
3. `finishJob({jobId, status:"completed"|"failed"|"cancelled", error?})`.
4. `download/:jobId` lê `saveUserBuffer`→ `readUserBuffer` e envia com `Content-Disposition: attachment; filename="lotes_simcar_….zip"`.

## Erros mapeados (mensagens ao usuário)

| Condição | Mensagem |
|---|---|
| CPF/senha vazios | "Configure o CPF e a senha do SIMCAR antes de buscar." |
| Login recusado | "Login do SIMCAR recusado — confira o CPF e a senha." |
| SEMA inacessível (rede) | "Sem conexão com o SIMCAR. A SEMA só aceita acesso do Brasil." |
| Conta em uso (oráculo) | "A conta SIMCAR está em uso por outro processo. Tente novamente em alguns minutos." |
| ZIP sem PDFs | "Nenhum recibo PDF encontrado no arquivo enviado." |
| Recibo sem nº de CAR/federal | "Não foi possível identificar o CAR no arquivo <nome>." |
