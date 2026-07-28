# Croqui de acesso (ATP → PDF + Word + KML)

Gera croqui de acesso no padrão SEMA a partir do shapefile ATP.

## Entrada

- ZIP com shapefile ATP (`.shp`, `.shx`, `.dbf`, `.prj`)
- **Título do croqui** (ex.: `LOTE 04 – P.A PINGOS D'ÁGUA`)
- **Nome da propriedade** (usado no texto final do roteiro)

## Saída (ZIP)

| Arquivo | Conteúdo |
|---------|----------|
| `croqui.pdf` | Mapa A4 paisagem + roteiro + coordenadas + escala |
| `croqui.docx` | Texto narrativo do roteiro |
| `croqui.kml` | Polígono ATP + rota + pontos DMS |

## Fluxo automático

1. Parse do ATP (SIRGAS 2000)
2. Detecção do município (malha IBGE MT + fallback WFS SEMA)
3. Ponto inicial: landmark municipal (Querência calibrado) ou centroide IBGE
4. Roteamento viário OSRM até a borda da ATP
5. Geração dos 3 artefatos

## API

| Método | Rota |
|--------|------|
| POST | `/api/croqui/upload` |
| POST | `/api/croqui/process` — `{ uploadId, title, propertyName }` |
| GET | `/api/croqui/jobs/:id/status` |
| GET | `/api/croqui/jobs/:id/events` (SSE) |
| GET | `/api/croqui/download/:id` |
| DELETE | `/api/croqui/jobs/:id` |

Histórico: `users/{uid}/croqui_jobs`

## UI

Aba **Croqui** (`/dashboard/croqui`):

- `client/src/dashboard/panels/CroquiPanel.tsx`
- Hook `useCroquiJobs`
- Cards de histórico no sidebar (mesmo padrão SIMCAR / Sobreposições)

## Env

```env
CROQUI_OSRM_BASE_URL=https://router.project-osrm.org
```

Landmarks municipais: `backend/croqui/landmarks.ts` (Querência com rotatória MT-109 / Av. Norte).

## Observações

- O roteiro é **estimado por roteamento viário** (OSRM), não cópia manual de GPS.
- Qualidade depende do OSRM e dos landmarks; expandir `LANDMARKS_BY_IBGE` para novos municípios.
