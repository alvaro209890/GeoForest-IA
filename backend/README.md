# Backend (Render/Deploy)

## Variaveis de ambiente obrigatorias (Render)
GROQ_API_KEY=SEU_TOKEN_GROQ
CLOUDINARY_API_KEY=SEU_API_KEY
CLOUDINARY_API_SECRET=SEU_API_SECRET

## Variaveis opcionais (Render)
CLOUDINARY_FOLDER=geoforest
KEEP_ALIVE_URL=https://SEU_SERVICO.onrender.com/api/health
KEEP_ALIVE_INTERVAL_MS=300000
SEMA_WMS_BASE_URL=https://geo.sema.mt.gov.br/geoserver/ows
SEMA_WMS_AUTHKEY=SEU_AUTHKEY_SEMA
GEMINI_API_KEY=SEU_TOKEN_GEMINI
SIMCAR_REQUIRE_GEMINI=true
GEMINI_API_BASE=https://generativelanguage.googleapis.com/v1beta
GEMINI_VISION_MODELS=gemini-2.5-flash,gemini-3-flash,gemini-3-pro
GEMINI_TEXT_SYNTHESIS_MODELS=gemini-3-pro,gemini-3-flash,gemini-2.5-pro
GEMINI_IMAGE_SHARE=0.75

## Endpoints
- POST /api/chat
  - body: { messages: [{ role: "system|user|assistant", content: "..." }], model?: "..." }
- GET /api/models
  - resposta: { models: [...], defaultModel: "..." }
- GET /api/map/capabilities
  - resposta: { serviceTitle, layers: [{ name, title, crs, inferredYear, group }], defaultLayer }
- POST /api/map/snapshot
  - body: { layerName, bbox:[minX,minY,maxX,maxY], crs, width, height, format }
  - resposta: { dataUrl, mimeType, sourceUrl, mapContext }
- POST /api/geometry/bbox
  - body: { dataUrl, filename }
  - aceita: `.kml` e `.zip` (shapefile com `.shp`)
  - resposta: { bbox:[minX,minY,maxX,maxY], crs, source }
- POST /api/upload-image
  - body: { dataUrl: "data:image/png;base64,...", filename?: "arquivo.png" }
- GET /api/health
- GET /api/runtime/version
- GET /api/simcar/gemini/config
  - opcional: `?probe=1` para testar cada modelo Gemini configurado

## O que cada variavel faz
- GROQ_API_KEY: chave da Groq para chamar o modelo. Obrigatoria.
- CLOUDINARY_API_KEY: api key do Cloudinary. Obrigatoria.
- CLOUDINARY_API_SECRET: api secret do Cloudinary. Obrigatoria.
- CLOUDINARY_FOLDER: pasta de destino no Cloudinary. Opcional.
- KEEP_ALIVE_URL: URL que o backend pinga periodicamente para nao dormir (use /api/health). Opcional.
- KEEP_ALIVE_INTERVAL_MS: intervalo do keep-alive em ms (ex: 300000 = 5 min). Opcional.
- GEMINI_API_KEY: chave da API Gemini usada na analise de recorte. Obrigatoria quando `SIMCAR_REQUIRE_GEMINI=true`.
- SIMCAR_REQUIRE_GEMINI: se `true`, a analise de recorte falha quando Gemini falhar ou estiver sem chave.
- GEMINI_API_BASE: endpoint base da API Gemini.
- GEMINI_VISION_MODELS: lista de modelos Gemini de visao (aceita separador por virgula, `;` ou quebra de linha).
- GEMINI_TEXT_SYNTHESIS_MODELS: lista de modelos Gemini para sintese textual no recorte.
- GEMINI_IMAGE_SHARE: proporcao das imagens enviadas ao Gemini na analise combinada (0.55 a 0.95).

## Observacoes
- Nao coloque chaves no codigo.
- Ative keep-alive no Render apontando para /api/health.
- Confirme os IDs dos modelos no painel da Groq.
