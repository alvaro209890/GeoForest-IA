# 05 — Acervo no HD e publicação na biblioteca `NDVI` do WMS

> **Decisão D3 (confirmada):** publicar **Float32 + estilo SLD** (o dado, consultável por
> `GetFeatureInfo`) **e** um **RGB color-relief** em paralelo (a figura do laudo).

---

## 5.1 Onde o NDVI entra na árvore

O GeoServer da casa tem **um workspace só, `cbers`**, usado também pelo Landsat. O que
separa as bibliotecas é o **grupo**, não o workspace. Hoje:

```
RASTER
├── CBERS-4A-Apos_2019          ← backend/cbers/archive.ts  (ROOT_CBRS_GROUP)
│   └── orbit_<orbita>_<ponto>
│       └── orbit_<orbita>_<ponto>_y<ano>
│           └── cbers:<layer>
└── LANDSAT                     ← backend/landsat/geoserver.ts (ROOT_LANDSAT_GROUP)
    └── landsat_orbit_<orbita>
        └── landsat_orbit_<orbita>_y<ano>
            └── cbers:<layer>
```

Medido no servidor em 25/08/2026, `RASTER` já tem **três** filhos:
`CBERS-4A-Apos_2019`, `LANDSAT` e `SPOT`. O NDVI entra como **quarto irmão, no
mesmo nível**:

```
RASTER
├── CBERS-4A-Apos_2019
├── LANDSAT
├── SPOT
└── NDVI                        ← ROOT_NDVI_GROUP = "NDVI"
    └── ndvi_orbit_<path>_<row>
        └── ndvi_orbit_<path>_<row>_y<ano>
            ├── cbers:ndvi_..._ndvi_...      (Float32, estilo ndvi_ramp)
            └── cbers:ndvi_..._rgb_...       (RGB, estilo raster)
```

**Molde a copiar: `backend/landsat/geoserver.ts`, não `backend/cbers/archive.ts`.**
O do Landsat já tem a hierarquia parametrizada e tudo exportado
(`landsatLayerGroupNames`, `buildLandsatLayerGroupHierarchy`, `upsertLayerGroup`,
`publishLandsatGeoTiff`, `verifyLandsatWmsPublication`). O do CBERS tem essas funções
**privadas** e com `ROOT_CBRS_GROUP` e `orbit_*` embutidos — copiar de lá obrigaria a
refatorar código em produção sem necessidade.

```ts
// backend/ndvi/constants.ts
export const ROOT_RASTER_GROUP = "RASTER";
export const ROOT_NDVI_GROUP   = "NDVI";
export const GEOSERVER_NDVI_STYLE = process.env.GEOSERVER_NDVI_STYLE || "ndvi_ramp";
export const GEOSERVER_RASTER_STYLE = process.env.GEOSERVER_RASTER_STYLE || "raster";

// backend/ndvi/geoserver.ts
export function ndviLayerGroupNames(path: string, row: string, year: string) {
  const orbit = `${safeName(path, "000")}_${safeName(row, "000")}`;
  return {
    rasterGroup: ROOT_RASTER_GROUP,
    rootGroup:   ROOT_NDVI_GROUP,
    orbitGroup:  `ndvi_orbit_${orbit}`,
    yearGroup:   `ndvi_orbit_${orbit}_y${safeName(year, "0000")}`,
  };
}
```

---

## 5.2 Acervo no HD Backup

Mesmo padrão dos outros dois pipelines:

```
/media/server/HD Backup/RASTER/NDVI/<path>_<row>/<ano>/
```

Exemplo:

```
/media/server/HD Backup/RASTER/NDVI/224_069/2008/NDVI_224_069_20080720_L5_NDVI_J47FA5471.TIF
/media/server/HD Backup/RASTER/NDVI/224_069/2008/NDVI_224_069_20080720_L5_RGB_J47FA5471.TIF
```

Referências: `CBERS_ARCHIVE_ROOT=/media/server/HD Backup/RASTER/CBERS_4A`,
`LANDSAT_ARCHIVE_ROOT=/media/server/HD Backup/RASTER/LANDSAT`. Novo:
`NDVI_ARCHIVE_ROOT=/media/server/HD Backup/RASTER/NDVI`.

**Cópia atômica obrigatória** — copiar para `.<basename>.<uuid>.tmp`, conferir tamanho,
`rename`. `saveCbersArchiveAsset` (`backend/cbers/archive.ts:145`) é o molde; limpar
`.tmp` órfão com mais de 1 h.

### Índice do acervo

Um JSON por raster, no molde de `CbersArchiveRecord`:

```
<STORAGE_ROOT>/ndvi_archive/images/<ndviId>.json
```

```ts
export type NdviArchiveRecord = {
  ndviId: string; uid: string; jobId: string; clipJobId: string;
  itemId: string; platform: string; path: string; row: string; year: string;
  acquiredAt: string; cloudCoverPct: number | null;
  ndviFilename: string; ndviHdPath: string; ndviLayerName: string;
  rgbFilename: string;  rgbHdPath: string;  rgbLayerName: string;
  bytes: number; storeNameNdvi: string; storeNameRgb: string;
  wmsPublicUrl: string; createdAt: string; updatedAt: string;
  userDeletedAt?: string;
};
```

Escrita atômica. ⚠️ `writeJsonAtomic` **não é exportada** — existe duas vezes como
função privada (`backend/cbers/archive.ts:217` e `backend/local-storage.ts:132`).
Copiar a implementação para `backend/ndvi/archive.ts` ou exportar uma das duas; não
tentar importar. Serve para **reuso**: antes de gerar, consultar o
índice — se o mesmo `itemId` já tem NDVI publicado, criar job concluído apontando para a
camada existente, exatamente como a "regra de reuso" do CBERS
(`docs/WMS_CBERS.md:133`). Recalcular NDVI de uma cena já processada é desperdício puro.

### Servir os arquivos por HTTP

`backend/app.ts:36` monta `app.use("/api/raster", express.static(CBERS_ARCHIVE_ROOT))` —
só a raiz do CBERS. O NDVI precisa do seu:

```ts
app.use("/api/raster-ndvi", express.static(NDVI_ARCHIVE_ROOT));
```

---

## 5.3 O estilo SLD — a única peça realmente nova

**Não existe nenhum SLD versionado no repositório hoje.** Os pipelines só *referenciam*
estilo por nome (`GEOSERVER_RASTER_STYLE=raster`, `GEOSERVER_LANDSAT_STYLE=landsat_rgb`),
presumindo que já existe no GeoServer. `POST /rest/styles` nunca foi usado aqui.

### Arquivo versionado

`config/geoserver-styles/ndvi_ramp.sld` — **as cores têm que bater exatamente** com
`ndvi_ramp.clr` de [03 §3.7](03-pipeline-ndvi.md#37-paleta-de-cor-verde--amarelo--marrom),
senão a figura do laudo e a camada do WMS mostram cores diferentes para o mesmo valor.
Um teste unitário deve comparar os dois arquivos (ver doc 08).

```xml
<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld
        http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>ndvi_ramp</Name>
    <UserStyle>
      <Name>ndvi_ramp</Name>
      <Title>NDVI (-1 a 1)</Title>
      <Abstract>Rampa NDVI: marrom (solo exposto) - amarelo - verde (vegetacao densa)</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>1.0</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#000000" quantity="-9999" opacity="0.0"/>
              <ColorMapEntry color="#8C510A" quantity="-1.0"  opacity="1.0" label="-1,0 solo/agua"/>
              <ColorMapEntry color="#BF812D" quantity="-0.2"  opacity="1.0"/>
              <ColorMapEntry color="#DFC27D" quantity="0.0"   opacity="1.0" label="0,0"/>
              <ColorMapEntry color="#F6E8C3" quantity="0.1"   opacity="1.0"/>
              <ColorMapEntry color="#FFFFBF" quantity="0.2"   opacity="1.0" label="0,2 solo exposto"/>
              <ColorMapEntry color="#D9F0A3" quantity="0.3"   opacity="1.0"/>
              <ColorMapEntry color="#ADDD8E" quantity="0.4"   opacity="1.0" label="0,4 vegetacao rala"/>
              <ColorMapEntry color="#78C671" quantity="0.5"   opacity="1.0"/>
              <ColorMapEntry color="#41AB5D" quantity="0.6"   opacity="1.0" label="0,6 vegetacao"/>
              <ColorMapEntry color="#238443" quantity="0.7"   opacity="1.0"/>
              <ColorMapEntry color="#006837" quantity="0.8"   opacity="1.0" label="0,8 arborea densa"/>
              <ColorMapEntry color="#004529" quantity="1.0"   opacity="1.0" label="1,0"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
```

### Publicação idempotente do estilo

```ts
export async function ensureNdviStyle(): Promise<void> {
  const sld = fs.readFileSync(NDVI_SLD_PATH, "utf8");
  const existing = await geoserverJson(`/rest/styles/${GEOSERVER_NDVI_STYLE}.json`);

  if (!existing) {
    // 1. cria o registro do estilo
    await geoserverWrite(
      `/rest/styles?name=${encodeURIComponent(GEOSERVER_NDVI_STYLE)}`,
      "POST", sld, "application/vnd.ogc.sld+xml",
    );
    return;
  }
  // 2. atualiza o corpo do estilo existente
  await geoserverWrite(
    `/rest/styles/${GEOSERVER_NDVI_STYLE}`,
    "PUT", sld, "application/vnd.ogc.sld+xml",
  );
}
```

Chamar **uma vez por job, antes de publicar a camada**. É barato e garante que um
GeoServer recém-instalado ou restaurado de backup não fique sem o estilo.

`geoserverWrite` do CBERS aceita `[200,201,202,204,409,404]` como sucesso; o do Landsat
**não aceita 404**. Para estilo, `404` num `PUT` é erro real — usar a variante estrita.

---

## 5.4 Publicação das camadas

Duas camadas por cena. Sequência para cada uma, no molde de
`publishLandsatGeoTiff` (`backend/landsat/geoserver.ts:258`):

| Passo | Chamada REST |
|---|---|
| 1. Esperar o GeoServer | `GET /rest/about/version.json` até responder (`GEOSERVER_READY_TIMEOUT_MS`) |
| 2. Criar o store | `POST /rest/workspaces/cbers/coveragestores` — `<coverageStore><name>…</name><type>GeoTIFF</type><enabled>true</enabled><workspace><name>cbers</name></workspace></coverageStore>`, `application/xml` |
| 3. Anexar o GeoTIFF | `PUT /rest/workspaces/cbers/coveragestores/<store>/external.geotiff?configure=first&coverageName=<store>&recalculate=nativebbox,latlonbbox` — corpo = caminho absoluto, `text/plain` |
| 4. Definir o estilo | `PUT /rest/layers/cbers:<store>.json` — `{"layer":{"enabled":true,"advertised":true,"defaultStyle":{"name":"<estilo>","href":"<BASE>/rest/styles/<estilo>.json"}}}` |
| 5. Título da coverage | `PUT /rest/workspaces/cbers/coveragestores/<store>/coverages/<store>.json` |
| 6. Grupos (baixo → cima) | 4 × `upsertLayerGroup` |
| 7. Verificar | `GET /rest/layers/…` + `GET /rest/…/coverages/…` + **GetMap PNG** |

Estilo por camada:

| Camada | `defaultStyle` |
|---|---|
| `..._ndvi_...` (Float32) | `ndvi_ramp` |
| `..._rgb_...` (color-relief) | `raster` (já existe) |

**Ordem dos grupos, de baixo para cima** (cada um publica o de baixo):

```
1. ndvi_orbit_<path>_<row>_y<ano>   ← {"@type":"layer",      name:"cbers:<store>"}
2. ndvi_orbit_<path>_<row>          ← {"@type":"layerGroup", name:"cbers:<yearGroup>"}
3. NDVI                             ← {"@type":"layerGroup", name:"cbers:<orbitGroup>"}
4. RASTER                           ← {"@type":"layerGroup", name:"cbers:NDVI"}
```

`upsertLayerGroup` lê o grupo existente, só acrescenta se o nome ainda não estiver
publicado, e mantém `styles.style` com o **mesmo número de itens** de
`publishables.published` — descuidar disso corrompe o grupo em silêncio.

⚠️ O grupo `RASTER` já existe e contém `CBERS-4A-Apos_2019`, `LANDSAT` e `SPOT`. O upsert tem que
**acrescentar** `NDVI`, nunca substituir a lista. E a remoção de grupo vazio precisa
proteger `RASTER` e `NDVI` da mesma forma que o CBERS protege `RASTER` e
`CBERS-4A-Apos_2019` (`backend/cbers/archive.ts:454-492`).

### Symlink: seguir o Landsat, não o CBERS

O CBERS espelha o TIFF em `GEOSERVER_EXTERNAL_CBRS_ROOT` e publica o symlink. O Landsat
publica o **caminho do HD direto** — mais simples, uma peça a menos. Fazer como o Landsat.

---

## 5.5 Validação `GetMap` PNG

Igual às duas existentes (`backend/cbers/archive.ts:553`,
`backend/landsat/geoserver.ts:306`), e **igualmente bloqueante**: se o GetMap não devolver
PNG válido, **o job falha** em vez de registrar imagem publicada sem WMS funcional.

```ts
const params = new URLSearchParams({
  service: "WMS", version: "1.1.1", request: "GetMap",
  layers: `cbers:${storeName}`,
  styles: "",                          // vazio = usa o defaultStyle definido no passo 4
  srs: "EPSG:4326",
  bbox: `${minx},${miny},${maxx},${maxy}`,   // do latLonBoundingBox da coverage
  width: "64", height: "64",
  format: "image/png", transparent: "true",
});
const res = await fetch(`${GEOSERVER_BASE_URL}/cbers/wms?${params}`, {
  headers: { Authorization: authHeader() },
});
// exige: res.ok && contentType.startsWith("image/") && bytes >= 100
```

### Duas checagens a mais, específicas do NDVI

1. **PNG não uniforme.** Um Float32 publicado com estilo errado renderiza cinza chapado e
   passa no teste de "é PNG". Reusar a ideia de `isMostlyEmptyRender`
   (`backend/simcar/analysis.ts`), que já existe para reprovar cena vazia do acervo:
   se > 90% dos pixels forem idênticos, reprovar.
2. **Estilo aplicado.** Fazer um segundo GetMap com `styles=ndvi_ramp` explícito e
   comparar com o primeiro. Diferentes ⇒ o `defaultStyle` não pegou.

---

## 5.6 Exclusão

Mesma regra dos outros pipelines: exclusão pelo usuário remove o histórico da conta,
marca `userDeletedAt` no índice, e **mantém** o arquivo no HD e a layer no WMS.

Exclusão definitiva é **manual no PC do WMS** — o painel admin foi removido em
03/08/2026 e não deve ser recriado (`docs/CHANGELOG_2026-08-03_REMOCAO_PAINEL_ADMIN.md`).
Documentar o procedimento manual no doc final, no mesmo formato de `docs/WMS_CBERS.md:239-243`.

---

## 5.7 Checklist de publicação

- [ ] `ensureNdviStyle()` roda antes da primeira publicação
- [ ] Float32 publica com `ndvi_ramp`; RGB publica com `raster`
- [ ] `RASTER` ganha `NDVI` sem perder `CBERS-4A-Apos_2019` nem `LANDSAT`
- [ ] `publishables.published` e `styles.style` com o mesmo comprimento
- [ ] GetMap PNG válido, não uniforme, e com o estilo certo
- [ ] Arquivo no HD por cópia atômica, com `.ovr` ao lado
- [ ] JSON do índice gravado com escrita atômica (temp + rename)
- [ ] Reuso consultado **antes** de recalcular
- [ ] `app.use("/api/raster-ndvi", …)` registrado em `backend/app.ts`
