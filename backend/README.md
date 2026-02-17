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

## O que cada variavel faz
- GROQ_API_KEY: chave da Groq para chamar o modelo. Obrigatoria.
- CLOUDINARY_API_KEY: api key do Cloudinary. Obrigatoria.
- CLOUDINARY_API_SECRET: api secret do Cloudinary. Obrigatoria.
- CLOUDINARY_FOLDER: pasta de destino no Cloudinary. Opcional.
- KEEP_ALIVE_URL: URL que o backend pinga periodicamente para nao dormir (use /api/health). Opcional.
- KEEP_ALIVE_INTERVAL_MS: intervalo do keep-alive em ms (ex: 300000 = 5 min). Opcional.

## Observacoes
- Nao coloque chaves no codigo.
- Ative keep-alive no Render apontando para /api/health.
- Confirme os IDs dos modelos no painel da Groq.
