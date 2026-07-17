# 02 — Módulo `backend/simcar-oraculo`

## Objetivo

Portar o cliente de laboratório para TypeScript **dentro do backend**, com tipos, testes e zero dependência de `.oraculo-scratch` em runtime.

## Arquivos a criar

### `backend/simcar-oraculo/config.ts`

```ts
export type ProcessarMode = "LOCAL" | "ORACULO" | "HYBRID";

export function getSimcarOraculoConfig() {
  const mode = (process.env.PROCESSAR_MODE || "ORACULO").toUpperCase() as ProcessarMode;
  return {
    mode: (["LOCAL", "ORACULO", "HYBRID"].includes(mode) ? mode : "ORACULO") as ProcessarMode,
    cpf: String(process.env.SIMCAR_CPF || "").replace(/\D/g, ""),
    senha: String(process.env.SIMCAR_SENHA || ""),
    testCarId: String(process.env.SIMCAR_TEST_CAR_ID || "270069"),
    root:
      process.env.SIMCAR_ROOT ||
      "https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api",
    pollMs: Number(process.env.SIMCAR_POLL_MS || 5000),
    importTimeoutMs: Number(process.env.SIMCAR_IMPORT_TIMEOUT_MS || 15 * 60 * 1000),
    processTimeoutMs: Number(process.env.SIMCAR_PROCESS_TIMEOUT_MS || 30 * 60 * 1000),
  };
}

export function assertSimcarCredentials() {
  const c = getSimcarOraculoConfig();
  if (!c.cpf || !c.senha) {
    throw new Error("SIMCAR_CPF/SIMCAR_SENHA não configurados no backend do PC servidor.");
  }
  return c;
}
```

### `backend/simcar-oraculo/scramble.ts`

- Copiar lógica de `acompanhamento-de-processos/backend-email-render/simcar-scramble.js` **para dentro do repo** (ou dependency local file) para não depender de path absoluto fora do projeto.
- **Não** commitar senhas.

### `backend/simcar-oraculo/client.ts`

Funções mínimas (baseadas em `simcar-client.mjs`):

```ts
export async function simcarLogin(cpf: string, senha: string): Promise<string>;
export async function simcarGet(token: string, path: string): Promise<unknown>;
export async function simcarPost(token: string, path: string, body?: unknown): Promise<unknown>;
export async function simcarDownload(
  token: string,
  path: string,
): Promise<{ buffer: Buffer; contentType: string | null }>;
export async function simcarUploadShape(
  token: string,
  carId: string,
  zipBuffer: Buffer,
  fileName: string,
): Promise<unknown>;
export async function simcarBuscar(token: string, carId: string): Promise<SimcarRequerimento>;
```

Headers browser-like obrigatórios (oráculo):

```ts
const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 ... Chrome/126 Safari/537.36",
  Origin: "https://monitoramento.sema.mt.gov.br",
  Referer: "https://monitoramento.sema.mt.gov.br/simcar/tecnico.app/",
};
```

### `backend/simcar-oraculo/queue.ts`

Fila serial global (ver 01).

### `backend/simcar-oraculo/import-shape.ts`

```ts
export type ImportResult = {
  ok: boolean;
  status: string;           // [FINALIZADO] | [COM_PENDENCIA] | ...
  detalhes: string;
  pdfBuffer?: Buffer;
  rawStatus: unknown;
};

export async function importZipOnTestProject(args: {
  carId: string;
  zip: Buffer;
  fileName: string;
  onProgress?: (ev: { step: string; message: string; percent?: number }) => void;
}): Promise<ImportResult>;
```

Passos internos:
1. login (cache token ~25 min se possível)
2. upload multipart (mesmo contrato do app técnico)
3. `ImportarArquivoShape/{carId}` (ou path real do bundle)
4. poll `Buscar` até import `CONCLUIDO` ou timeout
5. download PDF import

### `backend/simcar-oraculo/process-geo.ts`

Análogo com `ProcessarGeo/{carId}` + poll `ProcessamentoStatus` + downloads.

### `backend/simcar-oraculo/prepare-project.ts`

Ver arquivo `04-municipio-e-abrangencia.md`.

### Token cache

```ts
// tokenCache: { token, expiresAtMs }
// Renovar se 401 ou se faltam < 60s
```

## Integração em `processar-projeto.ts`

Onde hoje `importar` chama `runImportPhase(zip)`:

```ts
const mode = getSimcarOraculoConfig().mode;
if (mode === "ORACULO" || mode === "HYBRID") {
  await enqueueSimcar(async () => {
    // prepare + import
  });
}
if (mode === "LOCAL" || mode === "HYBRID") {
  const local = runImportPhase(zip, fileName);
  // anexar no resultado
}
```

Em `ORACULO` puro, **não** bloquear o usuário com falhas só do detector local se o SIMCAR aprovou (mas em HYBRID mostrar os dois).

## Testes

| Arquivo | O quê |
|---------|--------|
| `backend/simcar-oraculo/config.test.ts` | mode default, assert creds |
| `backend/simcar-oraculo/queue.test.ts` | serialização de 2 jobs |
| `backend/simcar-oraculo/client.test.ts` | mock fetch (login body scramble shape) |
| `backend/simcar-oraculo/import-shape.test.ts` | poll machine com status fake |

**Live (opcional, flag):** `SIMCAR_LIVE=1` + credenciais — só no PC, não em CI.

```bash
# unitários
npx vitest run --root . backend/simcar-oraculo

# live (manual)
SIMCAR_LIVE=1 SIMCAR_CPF=... SIMCAR_SENHA=... npx tsx backend/simcar-oraculo/scripts/smoke-buscar.ts
```
