# SIMCAR — Fix: recortes deslocados no ArcMap (datum do shapefile UTM ignorado)

Data: 2026-07-10

## Sintoma

Recortes do SIMCAR Digital abertos no ArcMap 10.8 apareciam, **às vezes**,
deslocados em bloco (~65 m ou mais) em relação ao limite real do imóvel e às
imagens de fundo. O problema só ocorria em recortes feitos a partir de **ZIP
enviado pelo usuário** — recortes por número de CAR ou SIGEF (limite buscado
direto do WFS da SEMA) nunca deslocavam.

## Causa raiz

`detectUtmProj` (`backend/geo-utils.ts`) montava a definição proj4 de
**qualquer** `.prj` UTM com `+datum=WGS84` fixo, ignorando o datum real do
arquivo. E em `parseUserShapefile` (`backend/simcar-clip.ts`) a validação
"rejeita se não for SIRGAS 2000/WGS84" só rodava para CRS **geográficos** —
o caminho UTM pulava a checagem por completo.

Consequência: shapefiles em **SAD69 UTM** ou **Córrego Alegre UTM** (comuns em
bases antigas de MT) eram aceitos em silêncio e desprojetados como se fossem
WGS84. O limite do imóvel usado no recorte ficava deslocado:

| Datum de entrada    | Deslocamento horizontal em MT (lon −56°, lat −12°) |
|---------------------|-----------------------------------------------------|
| SAD69               | ~65 m                                               |
| Córrego Alegre      | ~80 m (chega a ~200 m no Sudeste)                   |

Todas as camadas recortadas saíam "escorregadas" juntas — exatamente o sintoma
visto no ArcMap.

Caso extremo relacionado: um `.prj` **projetado não-UTM** cujo nome contivesse
"SIRGAS" (ex.: Brazil Polyconic) caía no ramo "já é SIRGAS, não reprojetar" e
coordenadas em **metros** eram lidas como **graus**.

## Correção (`backend/geo-utils.ts` + `backend/simcar-clip.ts`)

1. **`detectPrjDatum` (nova)** — identifica o datum no texto do `.prj`:
   SIRGAS 2000, WGS 84, SAD69 (`SAD_1969`/`South_American`) e Córrego Alegre,
   com os parâmetros oficiais IBGE de transformação para SIRGAS 2000:
   - SAD69: `+ellps=aust_SA +towgs84=-67.35,3.88,-38.22` (EPSG:15485)
   - Córrego Alegre: `+ellps=intl +towgs84=-206.05,168.28,-3.82` (EPSG:15486)

2. **`detectUtmProj`** — passa a embutir o datum detectado na definição proj4
   (antes: sempre `+datum=WGS84`). Fallback WGS84 permanece **apenas** para
   datum desconhecido, pois a função também atende usos aproximados
   (bbox de recibos, pré-visualizações em `index.ts` e `vertices-proximas.ts`).

3. **`resolveShapefileCrs` (nova)** — usada pelo recorte (`parseUserShapefile`),
   onde precisão é obrigatória:
   - UTM + datum conhecido → reprojeta com a transformação correta;
   - UTM + datum **desconhecido** → **erro claro** (antes: assumia WGS84 em silêncio);
   - projeção **não-UTM** (`PROJCS` sem zona) → **erro claro** (antes: metros viravam graus se o nome tivesse "SIRGAS");
   - geográfico SAD69/Córrego Alegre → agora **transformado** (antes: erro);
   - geográfico SIRGAS 2000/WGS84 → aceito sem reprojeção (inalterado).

## O que NÃO mudou

- Recortes por número de CAR/SIGEF (não passam por `.prj` de usuário).
- Saída: shapefiles continuam em `GCS_SIRGAS_2000` geográfico (templates do
  `Arquivo Modelo.zip`).
- Shapefile sem `.prj` com coordenadas em graus: aceito como SIRGAS (inalterado).

## Casos que continuam deslocando (não são bug do GeoForest)

1. **ArcMap sem transformação geográfica definida** no data frame quando o MXD
   tem camadas SAD69 → ~65 m aparentes. Configurar em *Data Frame Properties →
   Coordinate Systems → Transformations*.
2. **O próprio CAR na SEMA** vetorizado sobre base mal georreferenciada — o
   recorte reproduz fielmente o dado fonte (deslocamento irregular, varia por
   imóvel).

## Testes

`backend/geo-utils.test.ts` (10 testes, vitest):

- Detecção de datum nos 4 casos + desconhecido.
- Round-trip exato SIRGAS UTM.
- Prova do bug: coordenadas SAD69 UTM desprojetadas com o def antigo
  (`+datum=WGS84`) erram 40–100 m; com o novo def, < 1 cm. Idem Córrego Alegre.
- `resolveShapefileCrs`: rejeições (datum desconhecido, Polyconic) e
  transformação de SAD69 geográfico.

```bash
npx vitest run --root . backend/geo-utils.test.ts   # 10 passed
npm run check                                        # tsc limpo
```

## Deploy

```bash
git pull
set -a && source .env.production && set +a && pnpm run build
systemctl --user restart geoforest-backend.service
```
