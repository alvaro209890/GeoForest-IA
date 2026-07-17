# 03 — API, contratos e eventos (v2: pipeline único)

## Visão

O front passa a usar **um** job de pipeline em vez de importar/processar separados.
Rotas locais antigas de importar/processar do processar-projeto **morrem** (D2).

## Rotas

| Método | Path | Uso |
|--------|------|-----|
| POST | `/api/processar-projeto/upload` | **mantém** — sobe ZIP (base64), devolve `uploadId` + `shapePreview` + `simcarConfigured` + `testCar {id, nome, municipio}` |
| POST | `/api/simcar-oraculo/pipeline` | **novo** — `{uploadId, autoProcess?: true, autofix?: true}` → `202 {jobId, queuePosition}` |
| GET | `/api/simcar-oraculo/jobs/:jobId` | snapshot do job (poll fallback) |
| GET | `/api/simcar-oraculo/jobs/:jobId/events` | **novo** — SSE da timeline (mesmo padrão do processing-jobs atual) |
| POST | `/api/simcar-oraculo/jobs/:jobId/autofix` | guarda manual T15: só pode avançar com ação nova; job ativo/aprovado/sem ação retorna 409 específico e nunca repete plano após parada segura |
| DELETE | `/api/simcar-oraculo/jobs/:jobId` | cancelar (para de pollear; best-effort Cancelar* na SEMA) |
| GET | `/api/simcar-oraculo/jobs/:jobId/artifact/:key` | download autenticado: PDFs, `erros/enviado/processado/conferencia/pendencias-*-r{N}`, corrigido e fixplan |
| GET | `/api/simcar-oraculo/health` | mode-less: `{ok, simcarConfigured, testCarId, queueLength, deepseekConfigured}` |
| GET | `/api/simcar-oraculo/test-project` | Buscar do CAR-teste (leitura) |
| GET | `/api/simcar-oraculo/municipios` | 142 opções `{chave,nome,ibge}` para fallback manual; cache 24h |

Decisão T8: rotas atuais `/importar` e `/processar` do oráculo ficam por 1 release como atalhos
legados; o front novo usa somente `/pipeline`.

Auth: Firebase `requireAuth` em tudo (como hoje). Rate limit: fila serial global já limita;
opcional `SIMCAR_MAX_JOBS_POR_UID_DIA`.

## Upload response (novo shape)

```json
{
  "uploadId": "…",
  "fileName": "recorte.zip",
  "simcarConfigured": true,
  "testCar": { "id": "270069", "nome": "Santa clara", "municipio": "Querência" },
  "shapePreview": {
    "layers": ["ATP","AIR","AREA_UMIDA","…"],
    "bbox": [-52.9,-12.6,-52.7,-12.4],
    "centroid": [-52.8,-12.5],
    "municipioDetectado": { "nome": "QUERÊNCIA", "ibge": "5107065", "fonte": "malha-ibge" },
    "warnings": []
  }
}
```

`municipioDetectado.fonte`: `"malha-ibge" | "wfs-sema" | "manual" | "nao-detectado"`. Se
`nao-detectado`, o front oferece dropdown (dados de `Municipio/ListarMatoGrosso` via backend).

## Evento SSE / item de timeline

```ts
type OraculoEvent = {
  ts: string;                       // ISO
  round: number;                    // 1..maxRounds
  step:
    | "queued" | "login"
    | "buscar_projeto"
    | "municipio_check" | "municipio_saving" | "municipio_ok"
    | "abrangencia_check" | "abrangencia_saving" | "baseref_wait" | "abrangencia_ok"
    | "upload_zip" | "importar" | "import_poll" | "import_ok" | "import_fail"
    | "processar" | "process_poll" | "process_ok" | "process_fail"
    | "download_artifacts"
    | "autofix_plan" | "autofix_apply" | "autofix_skip"
    | "cancel_requested" | "done" | "failed" | "cancelled";
  message: string;                  // humano, pt-BR
  percent?: number;                 // 0-100 da rodada
  data?: Record<string, unknown>;   // ex.: {municipioAntes, municipioDepois}
};
```

Mensagens de exemplo (copy do front em 05):
- "Na fila do SIMCAR (1 job à frente)…"
- "Município do shape: Nova Mutum — projeto-teste está em Querência; ajustando…"
- "Área de abrangência atualizada; aguardando base de referência da SEMA (pode levar minutos)…"
- "Importação reprovada: pontos repetidos em AREA_UMIDA (11). Preparando correção automática (rodada 2/3)…"

## Snapshot do job (GET /jobs/:id)

```json
{
  "jobId": "…", "status": "queued|running|cancel_requested|completed|failed|cancelled",
  "round": 2, "maxRounds": 3,
  "prepare": {
    "municipioAntes": "Querência", "municipioDepois": "Nova Mutum",
    "municipioChanged": true, "abrangenciaChanged": true, "baserefMs": 480000
  },
  "rounds": [
    {
      "n": 1, "zipArtifact": "enviado-zip-r1",
      "import": { "resultado": "[COM_PENDENCIA]", "detalhes": "17/07/2026 10:12",
                  "pdf": "import-pdf-r1",
                  "errosResumo": [{ "camada": "AREA_UMIDA", "erro": "A geometria contém pontos repetidos", "qtd": 11 }] },
      "process": null,
      "fixplan": "fixplan-r1",
      "fixPlan": { "acoes": [{ "type": "remove_duplicate_vertices", "layers": ["AREA_UMIDA"] }],
                   "fonte": "deepseek", "confianca": "alta" },
      "diffResumo": [{ "camada": "AREA_UMIDA", "acao": "remove_duplicate_vertices",
                        "alterou": true, "verticesRemovidos": 11 }]
    },
    { "n": 2, "zipArtifact": "corrigido-zip-r2", "import": { "resultado": "[FINALIZADO]", "pdf": "import-pdf-r2" },
      "process": { "resultado": "[COM_PENDENCIA]", "pdf": "process-pdf-r2", "errosZip": "erros-zip-r2",
                   "errosResumo": [{ "camada": "AREA_UMIDA", "erro": "Geometria deve ser completamente contida…", "qtd": 41 }] } }
  ],
  "timeline": [ /* OraculoEvent[] acumulada (B3 corrigido) */ ],
  "artifacts": {
    "import-pdf-r1": {
      "key": "import-pdf-r1", "round": 1,
      "relativePath": "users/UID/simcar-oraculo/JOB/r1/relatorio_importacao_sema.pdf",
      "url": "/api/simcar-oraculo/jobs/JOB/artifact/import-pdf-r1",
      "contentType": "application/pdf", "bytes": 347217, "source": "sema"
    }
  }
}
```

SSE envia primeiro `{type:"snapshot", jobId, job}`, depois `{type:"event", ...}`; heartbeat a
cada 15 s. Jobs terminais devolvem apenas o snapshot e fecham a conexão. A rota faz lookup do
job dentro do UID autenticado — outro usuário recebe 404. O cliente não pode sobrescrever nem
apagar `simcar_oraculo_jobs` via store genérico, e a árvore de artefatos é excluída do static.

Downloads opcionais inexistentes (HTTP 400/404) não derrubam a rodada: ficam em
`round.artifactWarnings[]`. `enviado-zip-rN` começa como cópia do upload (`source:"upload"`) e
é sobrescrito pela cópia oficial (`source:"sema"`) se `DownloadArquivoEnviado` responder.

## Contratos de erro

| Situação | HTTP / job | Mensagem |
|----------|------------|----------|
| Sem credencial no servidor | 503 na rota / — | "Oráculo SIMCAR não configurado no servidor." |
| Upload não encontrado/expirado | 404 | "Envie o ZIP novamente." |
| Login SEMA falhou (após retry B6) | job `failed` | "Falha de autenticação no SIMCAR." |
| Import COM_PENDENCIA | job `completed`, `importOk:false` | resumo + PDF + botão corrigir |
| Process COM_PENDENCIA | job `completed`, `processOk:false` | idem |
| Timeout de poll (import/process/BaseRef) | job `failed` | "Timeout aguardando SIMCAR (etapa X, Ys)." |
| SEMA 5xx no poll | retry 3× backoff antes de falhar | — |
| Município não detectado e não informado | job `failed` cedo (antes de tocar SEMA) | "Não detectei o município do shape — selecione manualmente." |

## Compat / migração

- `processar_projeto_jobs` (histórico local antigo) continua legível para o histórico do
  Dashboard; jobs novos vão para `simcar_oraculo_jobs`. `mapProcessarDocToHistoryItem` aprende
  os dois formatos (ver 05).
- Rotas locais mortas devolvem 410 com `{error, hint: "use /api/simcar-oraculo/pipeline"}` por
  um release, depois somem.
