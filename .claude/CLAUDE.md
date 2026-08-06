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
npx firebase deploy --only hosting   # site único: ia-florestal
```

> Push no `main` já dispara o auto-sync do servidor (build + restart + deploy em
> até 2 min). Ver `docs/AUTO_SYNC.md`.

## Key Files

| File | Purpose |
|------|---------|
| `backend/index.ts` | Express server (~2567 lines), CORS, all API routes |
| `backend/firebase-admin.ts` | Firebase Admin SDK init (token verification) |
| `backend/local-storage.ts` | Local JSON database (replaces Firestore) |
| `backend/billing.ts` | Billing disabled (all costs return 0 BRL) |
| `backend/auth.ts` | requireAuth middleware (Firebase token verification) |
| `backend/simcar-clip.ts` | SIMCAR Clip module (shapefile, WFS, análise de imagens via Groq Vision) |
| `backend/simcar-lotes/` | Aba "Lotes SIMCAR": recibo do CAR → ZIP com pasta por lote (ver `docs/SIMCAR_LOTES.md`) |
| `backend/simcar-lotes/monitor.ts` | Monitor SIMCAR (RTDB do monitor-car) — **só leitura**; job espera o SIMCAR livre e retoma lote interrompido |
| `backend/simcar-oraculo/client.ts` | Cliente SEMA; sessão **por credencial** (`getSimcarTokenFor`) — oráculo e Lotes não se derrubam |
| `backend/auas-analysis.ts` | AUAS land use classification |
| `backend/auas-sccon.ts` | AUAS × SCCON: data ABERTURA via alertas de desmate + pontos sem alerta (ver `docs/AUAS_SCCON.md`) |
| `backend/geometry/` | Erros de geometria SIMCAR — detectores em `detectors/` (plano 04); `geometry-errors.ts` é só o barrel |
| `backend/cbers/` | Pipeline CBERS-4A WPM + acervo (`archive.ts`) (planos 05/07); `cbers-wpm.ts` é só o barrel |
| `backend/landsat/` | Pipeline Landsat 8/9 (plano 06) — não existe mais `landsat.ts` |
| `backend/overlap/` | Análise de sobreposição SIGEF×CAR (plano 07) — não existe mais `overlap-analysis.ts` |
| `backend/processar-projeto/`, `backend/vertices-proximas/` | Desmembrados no plano 07 |
| `backend/proj-defs.ts` | Registro global `proj4.defs` (EPSG:4674/4326) — **importe em todo módulo que usa proj4** |
| `backend/processing-jobs.ts` | In-memory job tracking with persistence |
| `backend/croqui.ts` + `backend/croqui/*` | Croqui de acesso: ATP → PDF/DOCX/KML no padrão SEMA (ver `docs/CROQUI_ACESSO.md`) |
| `config/sedes-mt.json` | Sedes dos 142 municípios de MT (ponto de partida do croqui) |
| `client/src/lib/localFirestore.ts` | Client-side Firestore replacement |

## Environment Variables

Critical:
- `GROQ_API_KEY` - único provedor de IA: chat, visão (análise de imagens) e síntese de laudos
- `FIREBASE_SERVICE_ACCOUNT_PATH` - path to service account JSON


WMS/WFS (already configured):
- `SEMA_WMS_BASE_URL`, `SEMA_WMS_AUTHKEY` - SEMA-MT Geoserver
- `PRODES_WFS_URL` - Terrabrasilis/INPE deforestation data
- `SFB_WFS_URL`, `SFB_WFS_AUTHKEY` - river hydrography

Croqui de acesso:
- `GOOGLE_STATIC_MAPS_KEY` - Maps Static API. **Não configurada**: o croqui cai no Esri World
  Imagery, que não traz rótulo de cidade nem escudo de rodovia. Ver `docs/CROQUI_ACESSO.md`.
- `CROQUI_OSRM_BASE_URL`, `CROQUI_OSRM_RETRIES`, `CROQUI_MIN_STEP_M`

## Painel admin: REMOVIDO (03/08/2026)

Não existe mais painel administrativo — nem `client/src/admin/`, nem
`backend/admin-*.ts`, nem rotas `/api/admin/*`, nem o site
`geoforest-admin.web.app` (desativado). O sistema é de uso interno: só o app
principal (`ia-florestal.web.app`). **Não recriar.** Ver
`docs/CHANGELOG_2026-08-03_REMOCAO_PAINEL_ADMIN.md`.

`backend/firebase-admin.ts` / `adminAuth` / `adminDb` são o SDK Admin do Firebase
(verificação de token dos usuários) — nada a ver com o painel.

## Oráculo SIMCAR (ZIP → SIMCAR do Álvaro → GeoForest): DESATIVADO PARA SEMPRE (05/08/2026)

O fluxo em que o usuário subia um ZIP e o GeoForest **importava/processava no SIMCAR real
com a conta técnica do Álvaro**, devolvendo o veredito oficial, está **desligado e não
será reativado** (decisão do Álvaro). A aba "Análise de Erros → Processar projeto" foi
removida em 21/07/2026.

- **Não recriar** a aba nem importar `client/src/components/ProcessarProjetoAnalysis.tsx`.
- **Não usar** `/api/simcar-oraculo/pipeline|importar|processar` — as rotas ainda estão
  registradas, mas são inalcançáveis pelo app e não devem ser religadas.
- **Não apagar `backend/simcar-oraculo/client.ts`** — a aba **Lotes SIMCAR** depende dele
  (lá quem loga é o **usuário com a própria credencial**; isso não é o fluxo desativado).
- Docs do oráculo (`docs/SIMCAR_ORACULO.md`, `docs/PROCESSAR_PROJETO_SIMCAR.md`,
  `docs/planos/simcar-oraculo-proxy/`) são **histórico técnico**, não instrução.

Regras completas: `docs/FLUXO_ORACULO_SIMCAR_DESATIVADO.md`.

## IA: Groq para visão, DeepSeek para texto

Chaves, modelos disponíveis, limites medidos ao vivo e gotchas: `docs/IA_PROVEDORES.md`.
Resumo: `GROQ_API_KEY` do backend tem **250k TPM** (a de `~/.hermes/.env` é a gratuita, 8k);
`qwen/qwen3.6-27b` aceita **no máximo 3 imagens por chamada — limite do modelo, não do
plano**; a `DEEPSEEK_API_KEY` do `backend.env` do server está **inválida (401)**.

## Important Notes

- CORS permite PUT, PATCH, GET, POST, DELETE, OPTIONS para `ia-florestal.web.app`
- Billing está completamente desabilitado (local mode)
- Storage é por arquivos JSON com writes atômicos (temp file + rename)
- Knowledge base: 39 docs carregados de `config/knowledge-base/`
- Backend usa `process.env` direto, sem dotenv package
- Port: dev=3001, production=3000
- `pnpm` é o package manager (instalar com `npm i -g pnpm` se necessário)
- Firebase project: `ia-florestal`, client apiKey: `AIzaSyCMYw7MFB__E5FrSGi91fgimCyN-gZhlGU`
