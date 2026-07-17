# 04 — P2: Município (Propriedade) + Área de abrangência (v2 com endpoints REAIS)

> Endpoints e payloads: **`11-endpoints-sema-descobertos.md`**. Os de escrita vieram do bundle
> e ainda exigem **1 validação live cada** no CAR-teste antes de produção (tasks 9–10).

## Objetivo

Antes de importar o ZIP no CAR-teste:

1. **Município** (aba Propriedade): igual ao município do shape. Se diferente →
   `SalvarGrupoPropriedade` trocando SÓ o `Municipio` (**`PropriedadeNome` intocável — D5**).
2. **Área de abrangência** (aba Caracterização): retângulo `Menor/Maior{Lat,Long}Gdec` deve
   conter o bbox do shape + margem. Se não → `SalvarAreaAbrangencia` e **aguardar BaseRef**.

## Detecção do município do shape (local, sem SEMA)

Ordem de fontes em `municipio-mt.ts`:

1. **Malha municipal IBGE de MT** embarcada no repo (GeoJSON simplificado, ~141 municípios;
   gerar uma vez de malha IBGE 2024 e commitar em `config/` ou `banco_de_dados/07_geoprocessamento/`).
   `turf.booleanPointInPolygon(centroid ATP∪AIR, municipio)` → `{nome, ibge}`.
   - Malha simplificada = risco de erro na divisa → confirmar com o polígono OFICIAL da SEMA:
     `Municipio/BuscarMunicipioGeo/{ibge}` (GeoJson Polygon) antes de decidir MUDAR o município.
2. **Fallback WFS SEMA** (`wfs-intersection.ts` já existe; envs `SEMA_WMS_*` configuradas):
   INTERSECTS(point) na camada municipal.
3. **Fallback manual**: dropdown no front com `Municipio/ListarMatoGrosso` (142 itens
   `{Chave, Texto}` — validado ao vivo). Job não toca a SEMA sem município resolvido.

Mapeamentos necessários (tabela estática `municipios-mt.ts`, gerada 1×):
`nomeNormalizado → { ibge, chaveSimcar }` — `chaveSimcar` obtida em runtime de
`ListarMatoGrosso` (cache 24h) casando por nome normalizado (sem acento/caixa);
   divergências de grafia resolvidas na tabela estática.

### Implementado em T4 (2026-07-16)

- `config/municipios-mt.geojson`: **142** municípios da Malha Municipal IBGE 2024,
  simplificação de 0,001° e precisão de 5 casas; origem oficial registrada no próprio arquivo.
- `scripts/generate-municipios-mt.mjs`: baixa a edição oficial, reprojeta EPSG:4674→4326,
  simplifica, normaliza `{ibge,nome}` e exige exatamente 142 códigos únicos; duas execuções
  produziram o mesmo SHA-256.
- `municipio-mt.ts`: índice bbox+point-in-polygon local; fallback WFS na camada descoberta e
  validada ao vivo `Geoportal:LIM_MUNICIPIOS_MT` (`MUNICIPIO`, `COD_IBGE`, `SHAPE`).
- `shape-context.ts`: bbox/centroid passam a ser reprojetados para 4326 quando o ZIP está em
  UTM; o fixture Santa Clara detecta Querência/`5107065` sem rede.
- `GET /api/simcar-oraculo/municipios`: lista para fallback manual; validação live retornou
  142 itens e casou Querência com Chave SIMCAR `751` e IBGE `5107065`.

## Algoritmo `prepare-project.ts`

```ts
export async function prepareTestProject(args: {
  token: string; carId: string;              // = SIMCAR_TEST_CAR_ID (guard!)
  shape: ShapeContext;                        // bbox + centroid + municipioDetectado
  onEvent: (ev: OraculoEvent) => void;
}): Promise<{
  municipioAntes: string; municipioDepois: string; municipioChanged: boolean;
  abrangenciaChanged: boolean; baserefWaitedMs: number; warnings: string[];
}>
```

1. `req = Buscar(carId)` — snapshot salvo como artefato (`prepare-snapshot.json`) p/ debug.
2. **Município**: `req.Municipio.Codigo` (IBGE) vs `shape.municipioDetectado.ibge`.
   - Igual → skip (evento `municipio_check` "já está em X").
   - Diferente → confirmar com `BuscarMunicipioGeo` (centroid DENTRO do polígono oficial do
     município alvo; se fora dos dois, abortar com warning — divisa ambígua, usuário decide).
   - `SalvarGrupoPropriedade`: enviar o objeto do `Buscar` com `Municipio` substituído pelo
     objeto completo do alvo (`{Id: chaveSimcar, Estado: {Id: 11,…}, Texto, Codigo: ibge, …}`),
     `PropriedadeNome` e demais campos INALTERADOS.
   - Re-`Buscar` e conferir `Municipio.Codigo` mudou. Falhou → job `failed` (não importar
     shape em município errado — a SEMA valida contenção no município).
3. **Abrangência**: retângulo atual = `req.{Menor,Maior}{Latitude,Longitude}Gdec`.
   - `cobre = abrangência ⊇ expand(bbox_shape, SIMCAR_ABRANGENCIA_MARGIN_M=500)` (em graus,
     conversão simples por latitude média).
   - Não cobre (ou campos nulos/zerados) → alvo = `expand(bbox_shape, 2000 m)`:
     a. tentar `SalvarAreaAbrangencia {Id, Menor…, Maior…}` direto;
     b. se rejeitar/não surtir efeito (re-Buscar confere), `LimparAreaAbrangencia/{id}` e
        salvar de novo. **Limpar descarta as geometrias do projeto** — aceitável no CAR-teste
        (vamos importar por cima), mas registrar na timeline.
   - Poll `BuscarStatusProcessamento.BaseRefStatus` até `[CONCLUIDO]` (ou `null` está ok se a
     SEMA não disparar BaseRef — validar na task 10; timeout `SIMCAR_BASEREF_TIMEOUT_MS=20min`;
     `[ERRO]` → 1 tentativa `ReprocessarBaseRef/{id}`, depois `failed`).
4. **Nunca** mexer em Interessados/Dominialidade/objetivo — fora do escopo.

### Skip inteligente

Município igual E abrangência já cobre → prepare vira 2 GETs (rápido). É o caso comum quando
o escritório trabalha vários shapes da mesma região.

## Validação live dos endpoints de escrita (pré-requisito, task 9)

Sequência segura no 270069 (estado atual: Querência, V24 importado):

- [ ] `SalvarGrupoPropriedade` trocando Querência → Canarana; re-Buscar confirma; **reverter**
      para Querência; re-Buscar confirma. Documentar payload mínimo aceito em `11`.
- [ ] `SalvarAreaAbrangencia` com retângulo ~igual ao atual +1 km; observar `BaseRefStatus`
      e cronometrar; documentar se precisou de Limpar.
- [ ] Se precisou Limpar: reimportar o ZIP FINAL da Santa Clara
      (`backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip`) para restaurar estado.
- [ ] Registrar TUDO (payloads reais, respostas) em `11-endpoints-sema-descobertos.md`.

## Testes

- `municipio-mt`: centroid da Santa Clara → QUERÊNCIA/5107065; ponto em Cuiabá → CUIABÁ;
  ponto fora de MT → `nao-detectado`.
- `coversBbox` com margem: casos cobre/não-cobre/abrangência nula.
- `prepare-project` com client mockado: skip / muda-município / muda-abrangência /
  BaseRef timeout / Salvar falha → failed.
- Live checklist acima (não em CI).
