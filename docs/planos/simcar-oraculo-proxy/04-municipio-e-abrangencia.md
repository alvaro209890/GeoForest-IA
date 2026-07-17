# 04 — Município (Propriedade) + Área de abrangência (Caracterização)

## Objetivo

Antes de importar o ZIP no projeto-teste, garantir:

1. **Aba Propriedade:** município do projeto-teste = município do shape (ou do imóvel do ZIP).
2. **Aba Caracterização:** área de abrangência **contempla** o bbox/polígono da propriedade (ATP ou união AIR).

Se não, **alterar o projeto-teste** (não o CAR do cliente).

## Fonte de verdade do shape

Do ZIP de entrada (local, sem SEMA):

| Dado | Como obter |
|------|------------|
| Geometria da propriedade | Camada `ATP` (preferida) ou união `AIR` |
| BBox | `turf.bbox` / `layerBbox` em `vertices-proximas.ts` |
| Município | (A) atributo DBF se existir; (B) reverse geocode / malha IBGE local; (C) tabela de municípios MT já usada no GeoForest se houver |

**Implementação recomendada (P2):**

```ts
// backend/simcar-oraculo/shape-context.ts
export type ShapeContext = {
  bbox: [number, number, number, number]; // minX,minY,maxX,maxY lon/lat
  centroid: [number, number];
  municipioNome?: string;
  municipioCodigoIbge?: string;
  areaHa?: number;
};

export function extractShapeContext(zip: Buffer): ShapeContext;
```

Passos:
1. `getZipLayerGroups` + `recognizeSimcarLayer`
2. Preferir ATP; senão AIR
3. `recordToGeoJSON` + união se multi
4. BBox + centroid
5. Município: lookup em base local (ver se `banco_de_dados` / WFS SEMA já tem malha)

Se não houver malha local no dia 1: aceitar `municipioNome` opcional no body do import **e** tentar listar municípios da API SIMCAR (combo do form técnico).

## Descoberta de endpoints SIMCAR (obrigatória antes de codar mutação)

O bundle `tecnico.app/js/bundle.js` tem os paths reais. Tarefa de descoberta:

```bash
# no PC, somente leitura
curl -s 'https://monitoramento.sema.mt.gov.br/simcar/tecnico.app/js/bundle.js' -o /tmp/simcar-bundle.js
rg -n "Municipio|Abrangencia|Caracteriz|Propriedade|Salvar|Atualizar" /tmp/simcar-bundle.js | head -80
```

Documentar em `backend/simcar-oraculo/docs/endpoints-descobertos.md` (ou neste plano atualizado) os paths reais:

- GET listagem municípios
- GET/POST propriedade do requerimento
- GET/POST caracterização / área de abrangência (polígono ou bbox?)

**Hipótese de trabalho** (validar):

```
GET  Requerimento/Buscar/{id}           # já funciona — ver campos Municipio*
POST Requerimento/SalvarPropriedade     # nome a confirmar
POST Requerimento/SalvarCaracterizacao  # nome a confirmar
POST Requerimento/AtualizarAbrangencia  # nome a confirmar
```

**Não inventar path em produção** sem teste no projeto 270069.

## Algoritmo `prepare-project.ts`

```ts
export async function prepareTestProject(args: {
  token: string;
  carId: string;
  shape: ShapeContext;
  onProgress?: ...
}): Promise<{
  municipioAntes: string | null;
  municipioDepois: string | null;
  municipioChanged: boolean;
  abrangenciaChanged: boolean;
  warnings: string[];
}> {
  const req = await simcarBuscar(token, carId);
  // 1) município
  const atual = pickMunicipio(req);
  const alvo = args.shape.municipioNome;
  let municipioChanged = false;
  if (alvo && normalize(atual) !== normalize(alvo)) {
    await setMunicipio(token, carId, alvo /*, codigo */);
    municipioChanged = true;
  }
  // 2) abrangência
  const abr = getAbrangenciaGeom(req); // ou endpoint dedicado
  const precisa =
    !abr ||
    !coversBbox(abr, args.shape.bbox, { marginM: 500 }); // margem segurança
  let abrangenciaChanged = false;
  if (precisa) {
    const nova = bboxToPolygon(expandBbox(args.shape.bbox, 2000)); // 2 km
    await setAbrangencia(token, carId, nova);
    abrangenciaChanged = true;
  }
  return { ... };
}
```

### Regra de cobertura

- Converter bbox shape + abrangência para métrico (UTM local)
- `covers` se abrangência contém bbox expandido por `SIMCAR_ABRANGENCIA_MARGIN_M` (default 500–2000 m)
- Se abrangência for só ponto/município sem polígono: sempre atualizar com bbox expandido

### Segurança do projeto-teste

- **Nunca** chamar prepare em CAR que não seja `SIMCAR_TEST_CAR_ID`
- Guard:

```ts
if (carId !== config.testCarId) throw new Error("prepare só no projeto-teste");
```

## Fallback se API de escrita não existir ainda

P0/P1 pode importar **sem** prepare (Santa Clara já no município certo para testes locais).  
P2 bloqueia import com erro claro se município do shape ≠ projeto e mutação indisponível:

> “Não foi possível ajustar o município do projeto-teste automaticamente. Configure manualmente no SIMCAR ou complete a integração da aba Propriedade.”

## Testes

- `extractShapeContext` com fixture `backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip`
- `coversBbox` unitário
- prepare com mock client (município muda / não muda)
