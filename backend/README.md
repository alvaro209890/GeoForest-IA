# Backend (Render/Deploy)

## Variaveis de ambiente obrigatorias (Render)
GROQ_API_KEY=SEU_TOKEN_GROQ
CLOUDINARY_API_KEY=SEU_API_KEY
CLOUDINARY_API_SECRET=SEU_API_SECRET

## Variaveis opcionais (Render)
CLOUDINARY_FOLDER=geoforest
KEEP_ALIVE_URL=https://SEU_SERVICO.onrender.com/api/health
KEEP_ALIVE_INTERVAL_MS=840000

## Endpoints
- POST /api/chat
  - body: { messages: [{ role: "system|user|assistant", content: "..." }], model?: "..." }
- GET /api/models
  - resposta: { models: [...], defaultModel: "..." }
- POST /api/upload-image
  - body: { dataUrl: "data:image/png;base64,...", filename?: "arquivo.png" }
- GET /api/health

## O que cada variavel faz
- GROQ_API_KEY: chave da Groq para chamar o modelo. Obrigatoria.
- CLOUDINARY_API_KEY: api key do Cloudinary. Obrigatoria.
- CLOUDINARY_API_SECRET: api secret do Cloudinary. Obrigatoria.
- CLOUDINARY_FOLDER: pasta de destino no Cloudinary. Opcional.
- KEEP_ALIVE_URL: URL que o backend pinga periodicamente para nao dormir (use /api/health). Opcional.
- KEEP_ALIVE_INTERVAL_MS: intervalo do keep-alive em ms (ex: 840000 = 14 min). Opcional.

## Observacoes
- Nao coloque chaves no codigo.
- Ative keep-alive no Render apontando para /api/health.
- Confirme os IDs dos modelos no painel da Groq.
