# Croqui de acesso (ATP → PDF + Word + KML)

Gera croqui de acesso no padrão dos modelos aprovados (pasta `Croquis/`) a partir do shapefile ATP.

## Entrada

- ZIP com shapefile ATP (`.shp`, `.shx`, `.dbf`, `.prj`)
- **Título do croqui** (ex.: `LOTE 04 – P.A PINGOS D'ÁGUA`)
- **Nome da propriedade** (usado no KML e no texto do roteiro)

## Saída (ZIP)

Os três arquivos saem com o nome do título (ex.: `LOTE 04.pdf`).

| Arquivo | Conteúdo |
|---------|----------|
| `.pdf` | A4 paisagem: mapa de satélite, caixa do roteiro, legenda, seta N e barra de escala |
| `.docx` | Roteiro em parágrafo único, Calibri 11 |
| `.kml` | Polígono ATP (vermelho) + trechos do caminho (laranja) + pontos DMS |

## Fluxo automático

1. Parse do ATP (reprojeta SIRGAS 2000 / SAD69 / Córrego Alegre)
2. Detecção do município (malha IBGE MT + fallback WFS SEMA)
3. Ponto inicial: landmark curado → **sede do município** (`config/sedes-mt.json`) → centroide da malha
4. Roteamento viário OSRM até o centroide, cortado onde a rota cruza a divisa (o acesso real)
5. Geração dos 3 artefatos

## Padrão do roteiro

Parágrafo corrido, com a distância de cada trecho seguida do DMS do **ponto de chegada**:

```
Inicia-se o croqui na MT-243, no ponto (12°35'56.51"S, 52°13'10.50"O).
Siga em frente por 1,1 km até o ponto (12°36'31.72"S, 52°13'10.41"O).
Vire à direita e siga por 5,1 km até o ponto (12°37'43.69"S, 52°15'18.81"O).
O destino estará à esquerda.
```

Quando o OSRM não informa o lado da chegada, o fecho vira `..., onde se encontra a propriedade.`
O nome da via sai de `name` e, quando ele vem vazio (comum no rural de MT), da sigla em `ref`.

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
GOOGLE_STATIC_MAPS_KEY=          # Maps Static API — base com rótulos, igual aos modelos
CROQUI_OSRM_BASE_URL=https://router.project-osrm.org
CROQUI_OSRM_RETRIES=3
CROQUI_MIN_STEP_M=300            # trechos menores viram parte do anterior
SEDES_MT_JSON=                   # opcional, sobrescreve config/sedes-mt.json
```

Sem `GOOGLE_STATIC_MAPS_KEY` o mapa cai para o **Esri World Imagery**: a imagem sai parecida,
mas sem os rótulos de cidade e os escudos de rodovia, e a atribuição impressa muda para
"Esri, Maxar, Earthstar Geographics".

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `backend/croqui/basemap.ts` | Web Mercator, escolha de zoom, imagem de fundo, barra de escala |
| `backend/croqui/routing.ts` | OSRM, nomes de via, simplificação de trechos, corte na divisa |
| `backend/croqui/landmarks.ts` | Ponto de partida (curado → sede → centroide) |
| `backend/croqui/narrative.ts` | Texto do roteiro |
| `backend/croqui/render-pdf.ts` | Layout do PDF |
| `backend/croqui/render-kml.ts` | KML no formato do Google Earth Pro |
| `config/sedes-mt.json` | Sedes dos 142 municípios (gerado por `tools/gerar-sedes-mt.mjs`) |

## Conferir contra os modelos

```bash
npx tsx tools/croqui-preview.ts             # usa Croquis/ATP → $TMPDIR/croqui-preview
npx tsx tools/croqui-preview.ts pasta saida
```

Compare o PDF com `Croquis/Fazenda Irmaos Sebald-lote 121B.pdf` e
`Croquis/Croqui_Chacara_Lotes_41 e 42..docx.pdf`. A prova de que o enquadramento está certo é a
rota cair **em cima das estradas** da imagem de satélite.

## Regenerar as sedes

```bash
node tools/gerar-sedes-mt.mjs
```

Consulta o Nominatim (1 req/s), só aceita o ponto que cai dentro do polígono do município e
encaixa na via mais próxima pelo OSRM. Municípios reprovados saem listados no final.

## Observações

- O roteiro é **estimado por roteamento viário** (OSRM), não cópia manual de GPS.
- `router.project-osrm.org` é servidor de demonstração: tem limite de uso e não tem SLA.
- Landmarks curados (`backend/croqui/landmarks.ts`) têm prioridade sobre a sede — use quando a
  sede não for o ponto de partida certo para aquele município.
