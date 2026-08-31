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
| `backend/index.ts` | **Só o boot** (142 linhas): logger, `createApp()`, knowledge base, registro das rotas, static, `listen`, keep-alive |
| `backend/app.ts` + `backend/routes/_registry.ts` | Factory do Express (CORS, auth, static) e registro das rotas de módulo |
| `backend/routes/chat.ts` | `/api/chat` e `/api/chat-stream` (auto-seleção de modelo, guardrails, continuação de stream). Registrado em `startServer()`, **não** no `_registry` — depende da knowledge base |
| `backend/routes/uploads.ts` | `/api/upload-image`, `/api/upload-file`, `/api/file-proxy` |
| `backend/routes/health.ts` | `/api/health`, `/api/knowledge/health`, `/api/runtime/version` |
| `backend/lib/sse.ts` | `createSseHub({ collection })` — **encanamento SSE único** de todos os jobs (`writeSse`/`emitJobEvent`/`closeSubscribers`/`persistJob`/`progress`). Não reimplementar dentro de módulo |
| `backend/lib/job-utils.ts` | `sleep`, `safeSegment`, `parseBase64Zip`, `csvEscape` — únicos |
| `backend/lib/fs-json.ts` | `ensureDir`, `writeJsonAtomic`, `readJsonSafe` — únicos |
| `backend/lib/http.ts` | `fetchJsonWithTimeout`, `xmlEscape`, `asArray` |
| `backend/firebase-admin.ts` | Firebase Admin SDK init (token verification) |
| `backend/local-storage.ts` | Local JSON database (replaces Firestore) |
| `backend/billing.ts` | Billing disabled (all costs return 0 BRL) |
| `backend/auth.ts` | requireAuth middleware (Firebase token verification) |
| `backend/simcar-clip.ts` | SIMCAR Clip module (shapefile, WFS, análise de imagens via Groq Vision) |
| `backend/simcar/report-theme.ts` | **Conteúdo e cor do laudo** — fonte única dos dois formatos; é aqui que se mexe no texto |
| `backend/simcar/acervo-local.ts` | Landsat/SPOT do GeoServer da casa no laudo; catálogo `config/acervo-landsat.json` (cenas deslocadas vão `descartado`) |
| `backend/simcar/report.ts` / `report-docx.ts` | Renderizadores do laudo (PDF e Word). Só desenham |
| `backend/simcar/constants.ts` | `TEMPLATE_LAYERS` (28) e `EXPORT_EXCLUDED_LAYERS` (fora de tudo que é entregue) |
| `backend/simcar-lotes/` | Aba "Lotes SIMCAR": recibo do CAR → ZIP com pasta por lote (ver `docs/SIMCAR_LOTES.md`) |
| `backend/simcar-lotes/monitor.ts` | Monitor SIMCAR (RTDB do monitor-car) — **só leitura**; job espera o SIMCAR livre e retoma lote interrompido |
| `backend/simcar-oraculo/client.ts` | Cliente SEMA; sessão **por credencial** (`getSimcarTokenFor`) — oráculo e Lotes não se derrubam |
| `backend/auas-analysis.ts` | AUAS land use classification |
| `backend/auas-sccon.ts` | AUAS × SCCON: data ABERTURA via alertas de desmate + pontos sem alerta (ver `docs/AUAS_SCCON.md`) |
| `backend/analise-pos-recorte/` | **3 fases pós-recorte** (F1 pré-2008, `pos2008/` datação 2009–2019, `ac-vegetacao/` vegetação na AC). Gate em `backend/simcar/phases.ts`. **F2 não exige F1.** F3 continua encadeada. |
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
| `client/src/dashboard/lib/values.ts` | `isPlainObject` e `toIsoDateFromUnknown` — únicos; todo `mapDoc.ts`/hook importa daqui |

## Banco local: whitelist de coleções

`backend/local-storage.ts` → **`ALLOWED_COLLECTIONS`** (constante única).

🔴 Coleção ausente da lista faz `writeDocBySegments` lançar `INVALID_DOC_PATH`. Como os
jobs envolvem a escrita em `try/catch`, o sintoma é **histórico vazio para sempre**, não
erro visível. Foi o caso de `solicitacao_prioridade_jobs` (corrigido 2026-08-30).

## Environment Variables

Critical:
- `GROQ_API_KEY` - visão (análise de imagens) e chat. Texto/laudo usa DeepSeek — ver seção de IA abaixo
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

## Análise pós-recorte SIMCAR: 3 fases atrás de flag

Depois do recorte, três botões encadeados (o gate é do **backend**, não da UI):
Fase 1 AUAS 2003–2008 → Fase 2 datação 2009–2019 → Fase 3 vegetação na `AREA_CONSOLIDADA`.

| Flag | Fase | Default |
|---|---|---|
| `SIMCAR_AUAS_V2_ENABLED` | 1 | `false` |
| `SIMCAR_AUAS_POS2008_ENABLED` | 2 | `false` |
| `SIMCAR_AC_VEG_ENABLED` | 3 | `false` |

As três são **independentes** e nenhuma existe no `backend.env` do server — em produção o
botão de AUAS ainda roda o **V1** (`processAuasAnalysis`, janela 2008–2025). Ligar cada
uma é decisão consciente do Álvaro (pré-requisitos no plano). Enquanto desligadas, as
rotas respondem `409 PHASE_NOT_READY`.

Plano: `docs/planos/analise-pos-recorte/` (STATUS.md primeiro).
Changelogs: `CHANGELOG_2026-08-07_ANALISE_POS_RECORTE_F2_F3.md`, `..._BUGS.md` (segurança),
`CHANGELOG_2026-08-07_AUDITORIA_BUGS_FASES.md` (bugs de código) e
`CHANGELOG_2026-08-08_CAR_APROVADO_6816.md` (bugs achados com um CAR aprovado real).

**Dois gotchas que custaram caro (2026-08-07):**

1. **`TIPOLOGIA_VEGETAL` não é declaração de vegetação nativa.** Ela é o mapa de tipologia
   do imóvel inteiro e cobre ~100% de **toda** AC; somá-la à "área declarada" fazia 100%
   dos polígonos saírem com alerta ALTO. O default agora é só `AVN`
   (`SIMCAR_AC_VEG_DECLARED_SOURCES` reverte). Antes de tratar qualquer camada do CAR como
   declaração, conferir o que ela significa.
2. **Teste sintético não valida código geométrico.** Os bugs acima passaram por toda a
   suíte e só caíram com shapefile real. Há dado real versionado:
   `.oraculo-scratch/santa_clara/v24/*.shp` (28 camadas do CAR 270069) e
   `backend/fixtures/teste_1/*.zip`. Ler com `readFullShapefile`/`parseUserShapefile` de
   `backend/simcar/shapefile-io.ts`, rodar com `npx tsx`.

3. **Um CAR aprovado é o melhor detector de falso positivo.** Rodar o projeto do imóvel
   6816 (`docs/CHANGELOG_2026-08-08_CAR_APROVADO_6816.md`) achou 9 erros de geometria
   falsos — dois "impeditivos" — e mostrou que 19 de 46 janelas de visão eram descartadas
   por texto ("padrão regular" e "Área de Reserva **Legal**" batiam na lista de termos
   jurídicos por substring). O `.dbf` da AUAS traz `ABERTURA` por polígono: é gabarito
   pronto para medir a Fase 2 contra a verdade declarada.
4. **Os mosaicos da SEMA são falsa-cor.** Não existe estilo em cor natural publicado para
   Landsat/ResourceSat/Sentinel-2 — só o SPOT 2008 é cor natural. Vegetação sai verde-neon,
   solo exposto sai magenta. O prompt de visão precisa dizer isso, senão o modelo trata a
   cena como corrompida.

Terceiro, sobre a suíte: um teste que falha em `pnpm test` mas passa isolado é quase sempre
**timeout sob carga** (o default do vitest é 5 s e `processar-projeto.test.ts` leva ~108 s),
não bug de lógica.

## Aba "Análise de vetorização" (modo `vectorized-analysis`)

Recebe o ZIP do modelo SIMCAR **já vetorizado** e roda a mesma análise de IA do
pós-recorte, **sem consulta WFS** — o imóvel é reconstruído do ATP/AIR do próprio
ZIP (`parseCachedContextFromOutputZip`). O cliente encadeia AC/AVN → AUAS sozinho
e consolida um laudo único.

- **Persiste no mesmo documento do recorte** (`users/<uid>/simcar_clips/<jobId>`),
  por merge incremental. Testes em `vectorized-persistence.test.ts`.
- **O laudo é gerado DUAS vezes por rodada** (fim do AC/AVN e fim do AUAS). É de
  propósito: se o AUAS falhar, o laudo parcial é o que sobra. O órfão que isso
  gerava no storage foi resolvido por `discardSupersededReportFiles`.
- ⚠️ **`status: "completed"` é gravado já no import**, antes de a análise rodar.
  O cliente compensa com `!hasVectorizedFinalReport`. Não confie nesse status
  sozinho para saber se a análise terminou.
- Validação completa e hipóteses já descartadas (AVN/ARL idênticas, área maior
  que o imóvel): `docs/VALIDACAO_2026-08-21_ABA_VETORIZADA.md`. **Leia antes de
  "consertar" área de camada** — o comportamento é o mesmo do modo recorte.

## Laudo (PDF + DOCX) e janela temporal

O laudo sai em **dois formatos do mesmo conteúdo**: `simcar-report-v3` em PDF
(`backend/simcar/report.ts`) e `simcar-report-docx-v1` em Word
(`backend/simcar/report-docx.ts`, para o RT editar antes de assinar). Os dois
consomem `backend/simcar/report-theme.ts`, que decide conteúdo e cor e é onde
ficam os testes — **mexa no tema, não nos renderizadores**, senão os formatos
divergem. O DOCX não traz anexo fotográfico nem o gráfico de barras (motivos no
cabeçalho do módulo). Falha no DOCX não retém a entrega: o PDF vai assim mesmo.

⚠️ **Heurística de legenda não discrimina mais nada.** Desde `0e429b3b` toda
imagem de análise tem a MESMA legenda (`"<sensor> — Visão Geral (AC + AVN +
AUAS)"`). Duas funções pontuavam por palavra na legenda e viraram no-op em
silêncio: `reduceImageSet` (retry de payload) e `selectPrincipalReportImages`
(anexo do laudo) — esta última **descartava o SPOT 2008**, a cena de maior peso
probatório. Ambas agora ordenam por **peso probatório** (SPOT → marco 2008 →
2003 → ano decrescente). Se aparecer outra seleção baseada em texto de legenda,
suspeite. Detalhe: `docs/CHANGELOG_2026-08-21_ANEXO_SPOT_SUMIA.md`.

O laudo declara a **origem dos vetores** (`vectorSourceNote`): base da SEMA no
modo recorte, ZIP do RT no modo vetorizado. Isso muda o que "divergência"
significa e não pode sumir da peça.

Amostra local sem rede, os dois formatos de uma vez:
`npx tsx scripts/preview-laudo-pdf.ts /tmp/laudo.pdf --fase=acavn --docx`
(some `--vetorizado` para simular a aba de vetorização).

**O laudo sai no papel timbrado oficial da IMAP** — o MESMO PNG e as MESMAS
margens/cabeçalho/rodapé que o sistema de acompanhamento de processos usa nos
.docx de parecer (`frontend/utils/timbradoImap.ts` + `utils/parecer/oficioHeaderFooter.ts`).
Geometria e desenho ficam em `backend/simcar/report-imap.ts`; o PNG em
`backend/simcar/assets/timbrado_imap.png`. A área útil é a do Ofício (453 pt, não
511 pt) — **qualquer coluna nova de tabela tem que caber nela**. Se o timbrado for
atualizado no acompanhamento, copiar o PNG de novo para cá: os dois sistemas devem
sair no mesmo papel.

A janela de imagens nasce de dois marcos legais: **22/07/2008** (Lei 12.651/2012,
art. 3º, IV) e **22/07/2003** (pousio — art. 3º, XXIV c/c IN SEMA-MT 04/2023,
art. 42 §6º). A série é **contígua ano a ano** de 2003 a 2008 e precisa continuar
sendo: quem classifica AC × AVN é o **ano da última atividade visível**, e um ano
faltando move a contagem de um lado ao outro do limite de 5 anos do pousio.

⚠️ **A lista do frontend é quem manda na janela, não o backend.** O backend só
usa `getFixedAcAvnSatelliteKeys()` quando `selectedLayers` chega vazio — e o
Dashboard sempre manda `SIMCAR_FIXED_AC_AVN_SATELLITES`. Expandir a janela só no
backend não tem efeito nenhum (foi o que aconteceu entre 20 e 21/08/2026).

⚠️ **Pousio tem dois lados.** Interrupção de até 5 anos mantém a AC; acima disso
descaracteriza e a vegetação regenerada volta a ser AVN — inclusive quando ainda
se vê traço antigo de talhão. A regra única é `POUSIO_PROMPT_RULE`
(`backend/analise-pos-recorte/groq-vision-core.ts`).

⚠️ **AC não é "área antropizada".** AC e AUAS são o mesmo estado do terreno
separados pelo marco: AC → escreva "uso consolidado"; AUAS → "supressão
pós-2008". No SIMCAR "antropizado" puxa para AUAS e o laudo passa a ler como
acusação. Fonte única nos prompts: `AC_AUAS_PROMPT_GLOSSARY`; no laudo:
`AC_VS_AUAS_GLOSSARY` (`report-theme.ts`).

⚠️ **`TIPOLOGIA_VEGETAL` não sai em nada que é entregue** — ZIP, XLSX, PDF e
DOCX. Fonte única: `EXPORT_EXCLUDED_LAYERS` (`backend/simcar/constants.ts`). É
filtro de **saída**: a camada continua em `TEMPLATE_LAYERS` e continua sendo
recortada para as fases que a consultam. O ZIP repassa todo o `Modelo.zip`, então
sem `isExcludedExportEntry` os arquivos VAZIOS da camada entrariam pelo
passthrough. Inventário do acervo da SEMA,
camadas vetoriais úteis ainda não integradas e o que fazer com MapBiomas/PRODES/
DETER: `docs/IMAGENS_E_CAMADAS_LAUDO.md`.

| Env | Efeito | Default |
|---|---|---|
| `SIMCAR_ACAVN_SATELLITE_KEYS` | Cenas da análise AC/AVN (1 imagem de visão cada — mexe no custo) | 2003, 2004, 2005, 2006, 2007, SPOT 2008, 2008 |
| `SIMCAR_AUAS_POS2008_SERIES_START` / `_END` | Série visual da Fase 2; as janelas são geradas a partir dela | 2009 / 2019 |

⚠️ **Buracos reais do acervo da SEMA:** 2001 não existe, 2002 só tem Landsat 7 e
2012 só tem ResourceSat. Não presuma `LANDSAT_5_<ano>` para todo ano.

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
