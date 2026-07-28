# Sobreposições SIGEF × CAR

Gera planilhas Excel de análise de sobreposição a partir de polígonos SIGEF (ZIP ou códigos `parcela_codigo`).

## Planilhas

| Arquivo | Conteúdo |
|---------|----------|
| `SIGEF_sobreposicao_CAR_ESTADUAL.xlsx` | Resumo + detalhe SIGEF × CAR estadual (SEMA ATP + Requerido) |
| `SIGEF_sobreposicao_CAR_Federal.xlsx` | Resumo + detalhe SIGEF × CAR federal (SICAR) |
| `CAR_Estadual_sobreposicao_CAR_Estadual.xlsx` | Formato didático (Leia primeiro / Resultado / Detalhe) |

Cores no detalhe: **azul** = CAR do imóvel; **amarelo** = cancelado; **verde** = sobreposição &lt; 1% (fresta de divisa).

## Fontes de dados

| Fonte | Endpoint / camada | Observação |
|-------|-------------------|------------|
| SIGEF | WFS INCRA Acervo Fundiário (`certificada_sigef_particular_mt`) | Cliente unificado em `backend/sigef-client.ts`. API SERPRO/Conecta preparada via env, sem credenciais ainda. |
| CAR estadual | `Geoportal:CAR_ATP` + `Geoportal:MVW_REQUERIMENTO_ATP` | SEMA-MT (`geo.sema.mt.gov.br`) |
| CAR federal | `sicar:sicar_imoveis_mt` | `geoserver.car.gov.br/geoserver/sicar/ows` |

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/overlap/sources/health` | Checa SICAR federal |
| POST | `/api/overlap/upload` | ZIP base64 **ou** `parcelCodes[]` |
| POST | `/api/overlap/process` | `{ uploadId, modes[], bufferMeters? }` → `202 { jobId }` |
| GET | `/api/overlap/jobs/:id/status` | Snapshot |
| GET | `/api/overlap/jobs/:id/events` | SSE (`snapshot` / `progress` / `heartbeat`) |
| GET | `/api/overlap/download/:id` | ZIP com as planilhas |
| DELETE | `/api/overlap/jobs/:id` | Cancela / remove |

Modos: `sigef-car-estadual` | `sigef-car-federal` | `car-estadual-car-estadual`.

## UI

Aba **Sobreposições** (`/dashboard/sobreposicoes`):

- `client/src/dashboard/panels/SobreposicoesPanel.tsx`
- Hook `useOverlapJobs`
- Histórico em `users/{uid}/overlap_jobs`

## Env

Ver `config/geoforest-backend.env.example`:

- `SIGEF_WFS_*`, `SIGEF_SERPRO_*` (stubs)
- `SICAR_WFS_BASE_URL`, `SICAR_WFS_LAYER`
- `SEMA_CAR_ATP_WFS_LAYER`, `SEMA_CAR_REQUIRED_WFS_LAYER`

## Regras de negócio

1. Mesmo `NUMEROESTADUAL` = mesmo CAR (mesclar).
2. Comparação inclui vizinhos (BBOX + buffer em metros, default 50).
3. Área de interseção em UTM planar densificado (alinhado à lógica SEMA de lascas).
4. CAR “próprio” do SIGEF = maior sobreposição ≥ 50% da área do imóvel.
