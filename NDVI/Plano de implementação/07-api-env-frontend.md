# 07 — Rotas, variáveis de ambiente e frontend

> **Decisão D2 (confirmada):** botão próprio, no padrão das fases pós-recorte.
> Flag de ambiente + gate `409 PHASE_NOT_READY`. Não roda automático em todo recorte.

---

## 1. Integração com as fases pós-recorte

Hoje existem três fases encadeadas em `backend/simcar/phases.ts`:

```ts
export type PhaseId = "PRE_2008" | "POS_2008" | "AC_VEG";
```

com `derivePhases`, `PhaseState` e `PhaseBlockedReason`. Cada uma atrás da sua flag
(`SIMCAR_AUAS_V2_ENABLED`, `SIMCAR_AUAS_POS2008_ENABLED`, `SIMCAR_AC_VEG_ENABLED`), todas
`false` por padrão, e o gate é do **backend**, não da UI.

O NDVI entra como quarta:

```ts
export type PhaseId = "PRE_2008" | "POS_2008" | "AC_VEG" | "NDVI";
```

⚠️ **`backend/simcar/phases.ts`, `phases.test.ts` e o `phase-state.ts` do frontend estavam
sendo editados por outro agente em 25/08/2026.** Conferir `git status` antes de tocar.
Deixar essa alteração — que é pequena — para **o fim da implementação**; todo o
`backend/ndvi/` pode ser construído e testado antes dela, com a rota respondendo
`409 PHASE_NOT_READY` fixo enquanto isso.

### O NDVI é independente das outras três

Não exige F1, nem F2, nem F3. O motivo é técnico, não de conveniência: as três fases
existentes são **análises de IA sobre imagem** e se encadeiam porque uma alimenta a
próxima. O NDVI é **medição determinística sobre raster** — não consome saída de IA
nenhuma. Só precisa de duas coisas:

1. um recorte concluído (para ter a geometria);
2. cena Landsat disponível para o ano pedido.

Isso segue o precedente já aberto no repositório: **"F2 não exige F1"**. O que o NDVI
faz é levar o mesmo raciocínio ao limite — nenhuma dependência de fase.

`derivePhases` deve reportar `NDVI` como bloqueada só por: flag desligada, recorte
inexistente, ou ausência de cena.

---

## 2. Rotas

Molde: `/api/simcar/clip/analyze-auas-pos2008` (`backend/simcar/routes.ts:1093`).

| Método | Caminho | Corpo / query | Resposta |
|---|---|---|---|
| `POST` | `/api/simcar/clip/analyze-ndvi` | `{ jobId, anos?: number[], force?: boolean }` | `202 { ok, jobId, ndviJobId }` · `409 PHASE_NOT_READY` · `404` |
| `GET` | `/api/simcar/clip/ndvi/:jobId` | — | `{ ok, ndvi: NdviResult \| null, status }` |
| `GET` | `/api/simcar/clip/ndvi/:jobId/events` | — | SSE de progresso |
| `POST` | `/api/simcar/clip/ndvi-report` | `{ jobId, force? }` | `{ ok, ndviReportUrl, ndviReportDownloadUrl, ndviReportFilename }` |
| `GET` | `/api/ndvi/archive` | `?path=&row=&year=` | Índice do acervo NDVI (reuso/depuração) |

Notas:

- `anos` vazio ⇒ ano da cena mais recente disponível. Lista ⇒ série temporal (R6).
- `force: true` ignora o reuso do acervo e recalcula.
- Os bytes do laudo saem pelo estático `GET /api/storage/*` (`backend/app.ts:35`), como
  já acontece com o laudo SIMCAR. A rota `/ndvi-report` devolve **URL**, não arquivo.

### Registro obrigatório em três lugares

Esquecer qualquer um deixa a rota aberta ou inexistente:

1. **`backend/routes/_registry.ts`** — `registerNdviRoutes(app)` dentro de
   `registerAllRoutes`, junto de `registerCbersWpmRoutes` / `registerLandsatRoutes`.
2. **`backend/auth-required-paths.ts`** — todos os caminhos novos:
   ```ts
   "/api/simcar/clip/analyze-ndvi",
   /^\/api\/simcar\/clip\/ndvi\/[^/]+$/,
   /^\/api\/simcar\/clip\/ndvi\/[^/]+\/events$/,
   "/api/simcar/clip/ndvi-report",
   "/api/ndvi/archive",
   ```
3. **`backend/app.ts`** — `app.use("/api/raster-ndvi", express.static(NDVI_ARCHIVE_ROOT))`.

O uid vem de `(req as any).authUid`. Conferir posse (`cached.uid === uid`) antes de
devolver qualquer coisa do job — como `routes.ts:729` faz no download do ZIP.

---

## 3. Variáveis de ambiente

Todas com default embutido; declarar só para sobrescrever. Documentar em
`config/geoforest-backend.env.example`, na seção nova `# --- NDVI ---`.

### Habilitação

| Env | Efeito | Default |
|---|---|---|
| `SIMCAR_NDVI_ENABLED` | Liga a fase NDVI. `false` ⇒ `409 PHASE_NOT_READY` | `false` |

> Como as outras três flags de fase, **não existe no `backend.env` do servidor**. Ligar é
> decisão consciente do Álvaro, depois dos critérios de aceitação do doc 08.

### Acervo e temporários

| Env | Efeito | Default |
|---|---|---|
| `NDVI_ARCHIVE_ROOT` | Acervo dos GeoTIFF NDVI | `/media/server/HD Backup/RASTER/NDVI` |
| `NDVI_TMP_ROOT` | Temporários do pipeline | `/tmp/geoforest-ndvi` |

### Escolha de cena

| Env | Efeito | Default |
|---|---|---|
| `NDVI_SEASON_START` | Início da janela sazonal (MM-DD) | `06-01` |
| `NDVI_SEASON_END` | Fim da janela sazonal (MM-DD) | `09-30` |
| `NDVI_MAX_CLOUD_PCT` | Nuvem máxima aceita na cena | `40` |
| `NDVI_STAC_COLLECTION` | Coleção STAC | herda `LANDSAT_STAC_COLLECTION` |

### Cálculo

| Env | Efeito | Default |
|---|---|---|
| `NDVI_QA_MASK_BITS` | Bits do `qa_pixel` que viram nodata | `27` (L4/5/7) · `31` com cirrus (L8/9) |
| `NDVI_SR_SCALE` | Fator de escala C2 L2 | `0.0000275` |
| `NDVI_SR_OFFSET` | Offset C2 L2 | `-0.2` |
| `NDVI_NODATA` | Valor de nodata na saída | `-9999` |

> `NDVI_SR_SCALE` e `NDVI_SR_OFFSET` existem para o dia em que a USGS publicar uma
> coleção nova com outros coeficientes — **não** para "ajustar" resultado.

### Estatística

| Env | Efeito | Default |
|---|---|---|
| `NDVI_ZONAL_MAX_FEATURES` | Teto de feições medidas por job | `50` |
| `NDVI_MIN_VALID_PCT` | Abaixo disso a feição não é classificada | `0.60` |
| `NDVI_MIN_PIXELS` | Mínimo de pixels para classificar | `10` |

### Publicação

| Env | Efeito | Default |
|---|---|---|
| `GEOSERVER_NDVI_STYLE` | Nome do estilo SLD | `ndvi_ramp` |
| `NDVI_SLD_PATH` | SLD versionado | `config/geoserver-styles/ndvi_ramp.sld` |
| `NDVI_COLOR_RAMP_PATH` | Rampa do `gdaldem` | `config/geoserver-styles/ndvi_ramp.clr` |
| `NDVI_OVERVIEW_RESAMPLING_DATA` | Overviews do Float32 | `nearest` |
| `NDVI_OVERVIEW_RESAMPLING_RGB` | Overviews do RGB | `average` |

Reusadas sem alteração: `GEOSERVER_BASE_URL`, `GEOSERVER_USER`, `GEOSERVER_PASSWORD`,
`GEOSERVER_WORKSPACE`, `GEOSERVER_PUBLIC_WMS_BASE`, `GEOSERVER_PUBLISH_RETRIES`,
`GEOSERVER_PUBLISH_RETRY_DELAY_MS`, `GEOSERVER_READY_TIMEOUT_MS`, `GEOSERVER_RASTER_STYLE`.

---

## 4. Frontend

### 4.1 Sem aba nova

O NDVI é uma **fase do recorte**, então o botão vai onde já estão os das três fases,
dentro do painel SIMCAR — não em `DashboardSidebarTabs.tsx`. As abas atuais
(`simcar-clip`, `simcar-receipts`, `simcar-lotes`, `cbers-wpm`, `landsat`,
`vertices-proximas`, `auas-sccon`, `sobreposicoes`, `croqui`,
`solicitacao-prioridade`) ficam como estão.

Localizar o componente que consome `derivePhases` / `GET /api/simcar/clip/phases/:jobId`
e acrescentar o quarto cartão.

### 4.2 O cartão NDVI

| Estado | O que mostra |
|---|---|
| Flag desligada | Cartão apagado, "Indisponível" |
| Pronto | Botão **"Calcular NDVI"** + seletor de ano(s) |
| Rodando | Barra com o `stage` do SSE (doc 03 §3.11) |
| Concluído | NDVI médio do imóvel + classe + link do laudo + link do WMS |
| Falhou | Mensagem do `NdviFailureCode`, em texto humano |

O tile **"NDVI Médio"** já está desenhado em `design/geoforest-ui.pen:2544` e `:9751` —
seguir aquele visual.

### 4.3 Prévia no mapa

O `CbersMapPreview` / `CbersPreviewMap` (`client/src/dashboard/`) já sabem consumir WMS do
workspace `cbers`. Como a camada NDVI é publicada lá, dá para acrescentar como camada
opcional com pouco esforço. **Opcional na F5**; não bloqueia a entrega.

### 4.4 Uma regra de ouro na UI

⚠️ Nunca exibir NDVI médio **sem** o percentual de pixels válidos ao lado. Um número de
NDVI sozinho, num cartão bonito, é lido como fato — e uma média com 30% de pixels válidos
não é fato. É a versão em UI da regra que já vale nos prompts:
*"NÃO fabrique valores de NDVI"* (`client/src/pages/Dashboard.tsx:3563`).

---

## 5. Deploy

Nada de especial além do fluxo padrão do servidor do WMS:

```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git pull --rebase --autostash origin main
scripts/cbers-doctor.sh          # agora também confere gdaldem e gdal_calc.py
npm run build
systemctl --user restart geoforest-backend.service
```

Push no `main` já dispara o auto-sync (build + restart + deploy em até 2 min) — ver
`docs/AUTO_SYNC.md`.

**Antes do primeiro job em produção**, conferir no servidor:

```bash
command -v gdal_calc.py gdaldem gdalwarp
mkdir -p "/media/server/HD Backup/RASTER/NDVI" && touch "/media/server/HD Backup/RASTER/NDVI/.w" && rm "/media/server/HD Backup/RASTER/NDVI/.w"
curl -s -u admin:geoserver "http://127.0.0.1:8081/geoserver/rest/styles/ndvi_ramp.json"
```
