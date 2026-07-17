# Backend — GeoForest IA

## Infraestrutura

O backend roda em servidor local e é exposto via Cloudflare Tunnel:

```
https://geoforest-api.cursar.space → Cloudflare Tunnel → localhost:3001
```

## Variáveis de Ambiente

### Obrigatórias
- `GROQ_API_KEY` — Chave API Groq para chamar o LLM
- `CLOUDINARY_API_KEY` — API Key do Cloudinary
- `CLOUDINARY_API_SECRET` — API Secret do Cloudinary

### Opcionais
- `CLOUDINARY_FOLDER` — Pasta de destino no Cloudinary (default: geoforest)
- `SEMA_WMS_BASE_URL` — URL base do WMS SEMA-MT
- `SEMA_WMS_AUTHKEY` — Auth key do WMS SEMA
- `GEMINI_API_KEY` — Chave Gemini (obrigatória se `SIMCAR_REQUIRE_GEMINI=true`)
- `SIMCAR_REQUIRE_GEMINI` — Se `true`, análise de recorte falha sem Gemini
- `SIMCAR_LOCAL_SHAPES_ROOT` — Pasta com shapes locais SIMCAR
- `GEMINI_API_BASE` — Endpoint base Gemini API
- `GEMINI_VISION_MODELS` — Modelos de visão (separados por `,`, `;` ou quebra de linha)
- `GEMINI_TEXT_SYNTHESIS_MODELS` — Modelos para síntese textual
- `GEMINI_IMAGE_SHARE` — Proporção de imagens no prompt combinado (0.55–0.95)

## Endpoints

### Chat
- `POST /api/chat` — Chat streaming
  - body: `{ messages: [{ role: "system|user|assistant", content: "..." }], model?: "..." }`
- `GET /api/models` — Lista modelos disponíveis

### Mapa
- `GET /api/map/capabilities` — Capabilities do WMS SEMA-MT (cache)
  - resposta: `{ serviceTitle, layers: [...], defaultLayer }`
- `POST /api/map/snapshot` — Snapshot de mapa
  - body: `{ layerName, bbox, crs, width, height, format }`

### Geometria
- `POST /api/geometry/bbox` — Extrai bbox de arquivo
  - Aceita: `.kml` e `.zip` (shapefile .shp)
  - resposta: `{ bbox, crs, source }`

### SIMCAR Clip
- `POST /api/simcar/clip` — Recorte SIMCAR (SSE)
- `GET /api/simcar/clip/download/:jobId` — Download ZIP
- `POST /api/simcar/clip/analyze` — Análise IA do recorte (SSE)
- `POST /api/simcar/clip/analyze-auas` — Análise AUAS (SSE)
- `POST /api/simcar/clip/import-vectorized` — Importa ZIP pré-vetorizado
- `GET /api/simcar/gemini/config` — Config Gemini (+ `?probe=1`)

### SIMCAR Recibos
- `POST /api/simcar/receipts/search` - Busca requerimentos por CPF, numero estadual do CAR ou recibo federal
  - body: `{ cpf?: string, carNumber?: string }`
  - resposta: `{ total, items: [{ id, rid, numeroCompleto, numeroReciboFederal, propriedadeNome, municipioTexto, situacaoCompleta, dataUltimoEnvio }] }`
- `GET /api/simcar/receipts/download/:id` - Baixa o PDF oficial do recibo pelo Id do requerimento
  - query opcional: `filename`

Detalhes tecnicos: [`../docs/CHANGELOG_2026-07-09_SIMCAR_RECIBOS_FIREBASE.md`](../docs/CHANGELOG_2026-07-09_SIMCAR_RECIBOS_FIREBASE.md).

### Vértices Próximas
- `POST /api/vertices/upload` — Upload ZIP e listagem de camadas poligonais
- `POST /api/vertices/process` — Processamento assíncrono de vértices próximas
- `GET /api/vertices/jobs/:jobId/events` — Progresso via SSE
- `GET /api/vertices/jobs/:jobId/status` — Status do job
- `GET /api/vertices/download/:jobId` — Download ZIP final
- `DELETE /api/vertices/jobs/:jobId` — Cancela/remove job

Detalhes técnicos: [`../docs/VERTICES_PROXIMAS.md`](../docs/VERTICES_PROXIMAS.md).

### Processar projeto (Oráculo SIMCAR real)
O veredito da aba vem exclusivamente da SEMA: prepara o CAR de teste, importa, executa
ProcessarGeo e guarda os artefatos oficiais por rodada.

- `POST /api/processar-projeto/upload` — Upload + preview consumido pelo Oráculo
- `POST /api/simcar-oraculo/pipeline` — Pipeline único prepare → import → process
- `GET /api/simcar-oraculo/jobs/:jobId/events` — Timeline SSE
- `GET /api/simcar-oraculo/jobs/:jobId` — Snapshot persistido
- `GET /api/simcar-oraculo/jobs/:jobId/artifact/:key` — Download privado
- `DELETE /api/simcar-oraculo/jobs/:jobId` — Solicita cancelamento
- `POST /api/processar-projeto/importar|processar` — **410 Gone** por uma versão; aponta para
  o pipeline. As fases locais permanecem somente como biblioteca/regressão, nunca como
  resultado da aba.

Detalhes: [`../docs/PROCESSAR_PROJETO_SIMCAR.md`](../docs/PROCESSAR_PROJETO_SIMCAR.md) ·  
Changelog: [`../docs/CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md`](../docs/CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md).

### Erros de Geometria (checks avulsos)
- `POST /api/geometry-errors/upload`
- `POST /api/geometry-errors/process`
- `GET /api/geometry-errors/jobs/:jobId/events|status`
- `GET /api/geometry-errors/download/:jobId`

Detalhes: [`../docs/ERROS_GEOMETRIA_SIMCAR.md`](../docs/ERROS_GEOMETRIA_SIMCAR.md).

### CBERS
- `POST /api/cbers/search` — Busca cenas no STAC INPE
- `POST /api/cbers/download` — Download + processamento
- `GET /api/cbers/images` — Imagens da conta
- `DELETE /api/cbers/images/:id` — Remove da conta

### CBERS Archive
- `GET /api/admin/cbers-storage/summary` — Resumo do acervo
- `GET /api/admin/cbers-storage/users/:uid/images` — Imagens por user
- `DELETE /api/admin/cbers-storage/images/:imageId` — Exclusão definitiva

### Upload
- `POST /api/upload-image` — Upload imagem (Cloudinary)
  - body: `{ dataUrl: "data:image/png;base64,...", filename?: "arquivo.png" }`
- `POST /api/upload-file` — Upload PDF
- `GET /api/file-proxy` — Proxy de arquivos
- `GET /api/storage/*` — Leitura de documentos

### Sistema
- `GET /api/health` — Health check
- `GET /api/runtime/version` — Versão
- `GET /api/server/metrics` — Métricas da máquina

## Serviços

```bash
# Reiniciar
systemctl --user restart geoforest-backend.service

# Logs
journalctl --user -u geoforest-backend.service -n 50 -f

# Verificar health
curl -sS https://geoforest-api.cursar.space/api/health
```

## Observações

- Não colocar chaves no código.
- Use `tsx` para desenvolvimento: `npm run dev:server`
- O backend detecta ambiente via `NODE_ENV`
