# SIMCAR — MultiPolygon em AIR/ATP e shapefile sem corrupção

Data: 2026-05-15

> **Atualização 2026-06-15:** o fluxo de `AIR`/`ATP` deixou de usar a geometria
> **unida** (`userGeometry`) e passou a iterar os lotes individuais
> (`userPolygons`), gerando um registro por lote. Isso era necessário porque a
> união de lotes contíguos podia colapsar em um único polígono, anulando o efeito
> descrito abaixo. Detalhes em `docs/SIMCAR_RECORTE_POR_POLIGONO.md`.

Este documento registra a correção aplicada no pipeline de recorte SIMCAR para imóveis enviados como **um único shapefile contendo múltiplos polígonos de propriedade**.

## Contexto

No recorte automático do SIMCAR, as camadas `AIR` e `ATP` são camadas de cópia direta do limite do imóvel:

- `AIR`: área do imóvel rural, com preenchimento do campo `IDENTIFIC` quando o usuário informa o número/identificação da AIR.
- `ATP`: área total da propriedade.

Quando o shapefile de entrada tinha apenas um polígono, o fluxo antigo funcionava corretamente. O problema aparecia quando o arquivo `.shp` continha mais de um polígono dentro do mesmo arquivo, ou seja, quando a geometria do imóvel era interpretada como `MultiPolygon`.

## Problema corrigido

Antes, o fluxo de `AIR`/`ATP` usava `geojsonToShpRings(userGeometry)`. Essa função mantém compatibilidade com código antigo, mas retorna apenas um conjunto de rings e não representa corretamente todos os polígonos independentes de um `MultiPolygon`.

Na prática, isso podia causar dois problemas:

1. **Perda de polígonos**: apenas o primeiro polígono era escrito no shapefile final.
2. **Polígono corrompido em GIS**: em caminhos antigos de conversão, múltiplos polígonos podiam ser achatados como partes/rings de um único registro, fazendo o segundo polígono ser tratado como buraco ou parte inválida.

Esse comportamento era especialmente visível no `ATP`, quando um único SHP de propriedade tinha mais de um polígono.

## Correção implementada

Foi adicionada a função:

```ts
geojsonToShpRecords(geometry, attributes)
```

Local:

```text
backend/shapefile-writer.ts
```

Ela converte `Polygon` ou `MultiPolygon` em uma lista de `ShpRecord`:

- `Polygon` → 1 registro shapefile.
- `MultiPolygon` → 1 registro shapefile por polígono independente.
- Os atributos são copiados para cada registro.

Isso garante que as geometrias sejam gravadas como registros separados e válidos no shapefile, sem transformar polígonos independentes em buracos/partes inválidas.

## Comportamento atual

No arquivo:

```text
backend/simcar-clip.ts
```

O bloco de cópia direta das camadas `AIR` e `ATP` agora usa:

```ts
const records = geojsonToShpRecords(userGeometry, attributes);
```

Depois grava:

```ts
clippedLayers.set(layerName, {
  records,
  fieldDefs,
});
```

Com isso:

- Se o imóvel importado tem 1 polígono, sai 1 registro em `AIR` e 1 em `ATP`.
- Se o imóvel importado tem 2 polígonos, saem 2 registros em `AIR` e 2 em `ATP`.
- Se o imóvel importado tem N polígonos, saem N registros em `AIR` e N em `ATP`.

## Preenchimento do número/identificação AIR

Para `AIR`, quando o usuário informa a identificação, o campo `IDENTIFIC` é preenchido antes da conversão para registros.

Como `geojsonToShpRecords()` copia os mesmos atributos para todos os registros, todos os polígonos de AIR recebem o mesmo valor:

```text
AIR polígono 1 -> IDENTIFIC = valor informado
AIR polígono 2 -> IDENTIFIC = valor informado
AIR polígono N -> IDENTIFIC = valor informado
```

Isso é intencional: se o usuário importou múltiplos polígonos que pertencem à mesma propriedade/AIR, todos devem manter a mesma identificação operacional no produto final.

## Proteção contra corrupção em ATP

O `ATP` usa o mesmo caminho corrigido.

O caso que causava corrupção anteriormente era:

```text
1 arquivo .shp de ATP/propriedade
└── MultiPolygon com vários polígonos independentes
```

Agora o writer gera:

```text
Registro shapefile 1 -> polígono 1
Registro shapefile 2 -> polígono 2
Registro shapefile N -> polígono N
```

Cada registro é `ShapeType 5` (`Polygon`) e mantém suas partes internas apenas para rings reais, como buracos. Polígonos independentes não são mais misturados em um único registro.

## Testes de regressão

Foi criado o arquivo:

```text
backend/shapefile-writer.test.ts
```

Casos cobertos:

1. `MultiPolygon` de AIR com dois polígonos:
   - gera dois registros;
   - repete `IDENTIFIC` nos dois registros;
   - mantém cada registro como `polygon`.

2. `MultiPolygon` de ATP com dois polígonos:
   - gera dois registros;
   - o `.shx` aponta para dois registros;
   - cada registro `.shp` é `ShapeType 5`;
   - cada polígono independente fica em um registro próprio, evitando o bug de multipart/ring corrompido.

Comando de teste:

```bash
./node_modules/.bin/vitest run --root . backend/shapefile-writer.test.ts
```

Validação TypeScript:

```bash
./node_modules/.bin/tsc --noEmit
```

## Arquivos envolvidos

- `backend/simcar-clip.ts`
  - troca `geojsonToShpRings(userGeometry)` por `geojsonToShpRecords(userGeometry, attributes)` no fluxo de `AIR`/`ATP`.
  - atualiza `features` e `totalFeaturesClipped` com `records.length`.

- `backend/shapefile-writer.ts`
  - adiciona `geojsonToShpRecords()`.
  - reaproveita `geojsonToPolyRecords()`, que já trata `MultiPolygon` como múltiplos polígonos independentes.

- `backend/shapefile-writer.test.ts`
  - adiciona testes de regressão para AIR e ATP com `MultiPolygon`.

## Limitação conhecida

A correção evita corrupção causada pela conversão/escrita do sistema quando há múltiplos polígonos no SHP.

Ela não corrige automaticamente um shapefile de entrada que já esteja topologicamente inválido antes do upload, por exemplo:

- autointerseção severa;
- ring aberto no arquivo original;
- coordenadas inválidas;
- buracos mal orientados no arquivo de origem.

Mesmo nesses casos, o pipeline ainda tenta normalizar fechamento/orientação de rings, mas problemas geométricos graves na entrada podem exigir correção manual no QGIS/ArcGIS antes do upload.
