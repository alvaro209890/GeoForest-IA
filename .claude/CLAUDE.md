# GeoForest-IA - Project Context

## Architecture

- **Backend local**: Express.js (Node.js/TypeScript) rodando na porta 3001
- **Cloudflare Tunnel**: expoe backend local -> https://geoforest-api.cursar.space
- **Frontend**: React/Vite, deploy no Firebase Hosting -> https://ia-florestal.web.app
- **Auth**: Firebase Auth (web client SDK) - project ID: `ia-florestal`
- **Database**: JSON files locais (substituiu Firestore completamente)
- **Storage root**: `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest`

## Credentials (sensitive)

- API keys estão em `.env.production` (raiz do projeto) E em `~/.config/geoforest/backend.env` (systemd)
- Firebase service account: `backend/firebase-service-account.json` (gitignored)
- **NUNCA commitear `.env.production` ou service account JSON**

## Quick Start

### Build
```bash
set -a && source .env.production && set +a && pnpm run build
```

### Start backend (manual)
```bash
set -a && source .env.production && set +a && nohup node dist/index.js > /tmp/geoforest-backend.log 2>&1 &
```

### Start backend (systemd)
```bash
systemctl --user restart geoforest-backend.service
```

### Deploy frontend
```bash
npx firebase deploy --only hosting
```

## Key Files

| File | Purpose |
|------|---------|
| `backend/index.ts` | Express server (~2567 lines), CORS, all API routes |
| `backend/firebase-admin.ts` | Firebase Admin SDK init (token verification) |
| `backend/local-storage.ts` | Local JSON database (replaces Firestore) |
| `backend/billing.ts` | Billing disabled (all costs return 0 BRL) |
| `backend/auth.ts` | requireAuth middleware (Firebase token verification) |
| `backend/simcar-clip.ts` | SIMCAR Clip module (shapefile, WFS, Gemini analysis) |
| `backend/auas-analysis.ts` | AUAS land use classification |
| `backend/auas-sccon.ts` | AUAS × SCCON: data ABERTURA via alertas de desmate + pontos sem alerta (ver `docs/AUAS_SCCON.md`) |
| `backend/processing-jobs.ts` | In-memory job tracking with persistence |
| `client/src/lib/localFirestore.ts` | Client-side Firestore replacement |

## Environment Variables

Critical:
- `GROQ_API_KEY` - LLM inference (chat endpoints)
- `GEMINI_API_KEY` - image analysis, report synthesis
- `FIREBASE_SERVICE_ACCOUNT_PATH` - path to service account JSON

WMS/WFS (already configured):
- `SEMA_WMS_BASE_URL`, `SEMA_WMS_AUTHKEY` - SEMA-MT Geoserver
- `PRODES_WFS_URL` - Terrabrasilis/INPE deforestation data
- `SFB_WFS_URL`, `SFB_WFS_AUTHKEY` - river hydrography

## Important Notes

- CORS permite PUT, PATCH, GET, POST, DELETE, OPTIONS para `ia-florestal.web.app`
- Billing está completamente desabilitado (local mode)
- Storage é por arquivos JSON com writes atômicos (temp file + rename)
- Knowledge base: 39 docs carregados de `config/knowledge-base/`
- Backend usa `process.env` direto, sem dotenv package
- Port: dev=3001, production=3000
- `pnpm` é o package manager (instalar com `npm i -g pnpm` se necessário)
- Firebase project: `ia-florestal`, client apiKey: `AIzaSyCMYw7MFB__E5FrSGi91fgimCyN-gZhlGU`
