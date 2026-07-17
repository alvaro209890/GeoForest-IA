# 03 — API, contratos e eventos SSE

## Rotas existentes (manter paths para o front)

Já usadas por `ProcessarProjetoAnalysis.tsx`:

| Método | Path | Uso atual |
|--------|------|-----------|
| POST | `/api/processar-projeto/upload` | sobe ZIP, retorna session |
| POST | `/api/processar-projeto/importar` | job import |
| POST | `/api/processar-projeto/processar` | job process |
| GET | `/api/processar-projeto/jobs/:id/events` | SSE |
| GET | `/api/processar-projeto/jobs/:id/status` | poll fallback |
| GET | `/api/processar-projeto/download/:token` | artefato |
| GET | `/api/processar-projeto/import/:id/pdf` | PDF import local |
| DELETE | `/api/processar-projeto/jobs/:id` | cancel |

## Estender sem quebrar o front

### Upload response (adicionar campos)

```json
{
  "sessionId": "...",
  "fileName": "recorte.zip",
  "mode": "ORACULO",
  "testCarId": "270069",
  "shapePreview": {
    "municipioHint": "NOVA MUTUM",
    "bbox": [-56.1, -14.2, -55.9, -14.0],
    "layers": ["ATP", "AIR", "AREA_UMIDA", "..."]
  }
}
```

`shapePreview` calculado **localmente** (só leitura do ZIP) — não chama SEMA.

### Eventos SSE (timeline)

Cada evento:

```ts
type OraculoEvent = {
  type: "progress" | "step" | "result" | "error" | "artifact";
  step:
    | "queued"
    | "login"
    | "buscar_projeto"
    | "ajustar_municipio"
    | "ajustar_abrangencia"
    | "upload_zip"
    | "importar"
    | "import_poll"
    | "import_done"
    | "processar"
    | "process_poll"
    | "process_done"
    | "download_artifacts"
    | "done";
  message: string;
  percent?: number; // 0-100
  data?: Record<string, unknown>;
};
```

Exemplos de `message` (UX amigável):

- “Na fila do SIMCAR (1 job à frente)…”
- “Ajustando município do projeto-teste para Nova Mutum…”
- “Atualizando área de abrangência na caracterização…”
- “Enviando shapefile ao SIMCAR…”
- “Importação em execução no SEMA (pode levar alguns minutos)…”
- “Importação FINALIZADA — baixando PDF…”
- “Reprovado na importação: 11 pontos repetidos em AREA_UMIDA”

### Status job (GET)

```json
{
  "jobId": "...",
  "status": "running|completed|failed|cancelled",
  "mode": "ORACULO",
  "import": {
    "resultado": "[FINALIZADO]|[COM_PENDENCIA]|null",
    "detalhes": "16/07/2026 21:17",
    "pdfUrl": "/api/processar-projeto/download/...",
    "errosResumo": [{ "camada": "AREA_UMIDA", "erro": "A geometria contém pontos repetidos", "qtd": 11 }]
  },
  "process": {
    "resultado": "[COM_PENDENCIA]|[FINALIZADO]|null",
    "pdfUrl": "...",
    "errosZipUrl": "...",
    "errosResumo": [{ "camada": "AREA_UMIDA", "erro": "Geometria deve ser completamente contida...", "qtd": 41 }]
  },
  "timeline": [ /* últimos eventos */ ],
  "prepare": {
    "municipioAntes": "...",
    "municipioDepois": "...",
    "abrangenciaAtualizada": true
  }
}
```

### Parse do PDF SEMA (resumo)

Reusar lógica já existente de parse de PDF de import (`import-report-pdf.ts` se cobrir) ou `pdftotext` no worker se disponível no PC.

Se parse falhar: ainda entregar PDF binário; `errosResumo` vazio com warning.

## Novas rotas (opcionais)

```
GET  /api/simcar-oraculo/health
     → { ok, mode, testCarId, simcarConfigured: boolean, queueLength }

GET  /api/simcar-oraculo/test-project
     → { id, nome, municipio, situacao }  // Buscar sem mutar
```

Auth: mesmo Firebase do resto do backend (usuário logado). Health pode ser admin-only.

## Cancelamento

Se user cancela job:
- set `cancelRequested` no `processing-jobs`
- entre polls SIMCAR, checar e abortar (não dá para cancelar o SEMA mid-flight de forma confiável — apenas para de pollear e marca `cancelled` local; documentar)

## Contratos de erro

| Situação | HTTP / job | Mensagem |
|----------|------------|----------|
| Sem credenciais | job failed | “Oráculo SIMCAR não configurado no servidor.” |
| Login SEMA falhou | failed | “Falha de autenticação SIMCAR.” |
| Import COM_PENDENCIA | completed (ok=false import) | PDF + resumo |
| Timeout poll | failed | “Timeout aguardando SIMCAR (Xs).” |
| Fila longa | progress | “Posição N na fila…” |
