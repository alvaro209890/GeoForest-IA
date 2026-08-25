# 02 — Fonte das bandas NIR e RED

> **Decisão D1 (confirmada):** fonte primária é **Landsat Collection 2 Level-2
> Surface Reflectance** (`landsat-c2l2-sr`), que o repositório já consome.

NDVI = `(NIR − RED) / (NIR + RED)`. A conta só tem significado físico sobre
**reflectância por banda**. Tudo neste documento decorre disso.

---

## 2.1 O que NÃO serve, e por quê

Três fontes são as mais óbvias dentro do projeto e **nenhuma das três serve**. O motivo
precisa ficar registrado porque a tentação de usá-las é real — são as que já estão
prontas.

| Fonte | Por que não serve |
|---|---|
| **WMS da SEMA** (`Mosaicos:*`) | `GetMap` devolve **PNG renderizado de 8 bits**. Pior: o "NIR" da SEMA **é estilo, não camada** — pedir `Mosaicos:Geoportal_Sentinel_2_2021_NIR` em `layers` devolve `LayerNotDefined`; a forma correta é `layers=<mosaico>&styles=<estilo NIR>`. Ou seja, é uma **composição falsa-cor já esticada**, não reflectância. Ver `docs/planos/analise-pos-recorte/03-catalogo-wms.md:118` |
| **Acervo local Landsat** (104 cenas do GeoServer da casa) | Todas são composições RGB já renderizadas — sufixos `c543`, `comp654`, `band5_4_3` em `config/acervo-landsat.json`. O realce por banda destrói a razão entre bandas |
| **Saída atual do recorte SIMCAR** | O recorte **não produz raster nenhum**. `backend/simcar/clip-pipeline.ts` trabalha só com vetores e com PNG do WMS via `sharp`. Não há GDAL nem GeoTIFF em `backend/simcar/` |

> Sobre o acervo local: numa composição 5-4-3 o NIR está no canal verde e o vermelho no
> canal azul — as duas bandas *estão fisicamente lá*. É por isso que a ideia parece
> funcionar. Mas o `gdal_translate -scale` aplicado na geração esticou cada banda com
> limites próprios da cena; a razão entre elas já não é a razão entre reflectâncias.
> O número sairia, teria cara de NDVI, e não mediria nada.

E o R11 da reunião fecha a porta pelo lado do dado:

> "é na SPOT da SEMA, que é aquela da mistura… é muito **mistura de datas**… não dá para
> concluir nada" — IMAP, 31:14

Um mosaico estadual costurado de passagens de datas diferentes não tem "uma data" — e
NDVI sem data não entra em laudo.

---

## 2.2 O que serve: Landsat C2 L2 SR

`backend/landsat/constants.ts` já aponta para o produto certo:

```ts
LANDSAT_STAC_ROOT       = "https://landsatlook.usgs.gov/stac-server"
LANDSAT_STAC_COLLECTION = "landsat-c2l2-sr"      // Collection 2, Level-2, Surface Reflectance
LANDSAT_PC_STAC_ROOT    = "https://planetarycomputer.microsoft.com/api/stac/v1"
LANDSAT_PC_COLLECTION   = "landsat-c2-l2"        // espelho, para download assinado
LANDSAT_PC_SIGN_ROOT    = "https://planetarycomputer.microsoft.com/api/sas/v1/sign"
```

Os assets STAC são **nomeados por semântica**, não por número de banda — e dois deles já
estão mapeados em `backend/landsat/naming.ts:101`:

```ts
export function landsatAssetKeysForComposition(composition: LandsatComposition): [string, string, string] {
  return composition === "natural_color"
    ? ["red", "green", "blue"]
    : ["swir16", "nir08", "red"];
}
```

Para o NDVI o implementador precisa de três assets:

| Asset | Papel | Observação |
|---|---|---|
| `nir08` | NIR | banda 5 no L8/L9, banda 4 no L4/L5/L7 — resolvido pelo nome |
| `red` | RED | banda 4 no L8/L9, banda 3 no L4/L5/L7 |
| `qa_pixel` | máscara de nuvem | bitmask; ver §2.4 |

⚠️ **O STAC do USGS serve para buscar, não para baixar.** Medido no servidor em
25/08/2026: `landsatlook.usgs.gov/data/...` devolve **302 para `ers.cr.usgs.gov`** —
exige login ERS, e o `/vsicurl/` responde *"not recognized as a supported file format"*.
Os assets vêm do **Planetary Computer** (os mesmos GeoTIFF, em Azure Blob), assinados
por SAS. Validado com `gdalinfo /vsicurl/<href>?<token>` numa cena real de 2008.

### Cobertura temporal

| Período | Plataforma | Resolução | Situação |
|---|---|---|---|
| 1984–2011 | Landsat 5 TM | 30 m | ✅ cobre a janela AC/AVN (2003–2008) inteira |
| 2012 | Landsat 7 ETM+ | 30 m | ⚠️ SLC-off desde 31/05/2003: faixas de vazio |
| 2013–2019 | Landsat 8 OLI | 30 m | ✅ cobre a Fase 2 (2009–2019) |
| 2020–hoje | Landsat 8 / 9 | 30 m | ✅ estado atual |

Ou seja: **a janela legal inteira** — o marco de 22/07/2008 (Lei 12.651/2012, art. 3º, IV)
e o marco do pousio de 22/07/2003 — está coberta por reflectância calibrada.

---

## 2.3 A armadilha do fator de escala

**Este é o erro mais provável da implementação inteira.** Leia antes de escrever a conta.

Landsat C2 L2 SR é distribuído como **inteiro escalado**, não como reflectância direta:

```
ρ = DN × 0,0000275 − 0,2
```

O instinto é dizer "NDVI é uma razão, o fator de escala cancela". **O fator cancela; o
offset não.** Com `ρ = a·DN + b`:

```
ρ_nir − ρ_red = a·(DN_nir − DN_red)                 ← b cancela aqui
ρ_nir + ρ_red = a·(DN_nir + DN_red) + 2b            ← b NÃO cancela aqui
```

Logo:

```
NDVI_correto = a·(DN_nir − DN_red) / ( a·(DN_nir + DN_red) + 2b )
             ≠ (DN_nir − DN_red) / (DN_nir + DN_red)
```

Como `b = −0,2` é grande em relação às reflectâncias típicas (0,02–0,45 no vermelho e no
NIR de vegetação), o erro **não é pequeno nem constante**: ele varia com o brilho da
cena, que é exatamente o pior caso — o número erra mais em uns polígonos do que em
outros, e nada denuncia isso na saída.

**Regra:** converter para reflectância **antes** da divisão. Sempre. Travado por teste
unitário, ver [08-fases-e-aceitacao.md](08-fases-e-aceitacao.md).

### Outros detalhes do produto que não podem ser ignorados

- **`nodata = 0`** nas bandas SR. Pixel 0 é preenchimento de borda, não reflectância zero.
  Sem tratar, a borda da cena vira NDVI espúrio.
- **Faixa válida** do DN em C2 L2 SR é 7273–43636. Fora disso é saturação ou artefato e
  deve cair para nodata.
- **Colisão de nome:** `LANDSAT_SCALE_MIN=1` / `LANDSAT_SCALE_MAX=30000` em
  `backend/landsat/constants.ts` são os limites do **realce visual** do composto RGB.
  Não têm relação com a escala radiométrica acima e **não devem ser reaproveitados no
  cálculo do NDVI**.

---

## 2.4 Máscara de nuvem (`qa_pixel`)

R7 da reunião pede a cena com menos nuvem. Escolher a cena é metade; a outra metade é
**tirar a nuvem que sobrou de dentro da estatística** — senão a média do polígono mede
nuvem, não vegetação.

`qa_pixel` do Collection 2 é um bitmask de 16 bits:

| Bit | Significado | Entra na máscara? |
|---|---|---|
| 0 | Fill (sem dado) | ✅ sim |
| 1 | Dilated Cloud | ✅ sim |
| 2 | Cirrus (só L8/L9) | ✅ sim, quando existir |
| 3 | Cloud | ✅ sim |
| 4 | Cloud Shadow | ✅ sim |
| 5 | Snow | ✅ sim |
| 6 | Clear | — |
| 7 | Water | ❌ **não** mascarar — água é informação (NDVI < 0) |

Máscara padrão: bits 0+1+3+4+5 = 1+2+8+16+32 = **59**; mais o bit 2 (cirrus, +4 = **63**)
quando a plataforma for L8/L9. Exposta em `NDVI_QA_MASK_BITS` para ajuste sem deploy.

> ⚠️ Este número já foi escrito errado uma vez na implementação (43, que esquece o
> bit 4 = sombra de nuvem). `ndvi-math.test.ts` agora trava cada bit individualmente.

O pixel mascarado vira `nodata` no NDVI (`-9999`), e o percentual de pixels válidos
dentro de cada polígono é **reportado no laudo** — ver [04](04-estatisticas-zonais.md).

---

## 2.5 CBERS-4A WPM — por que fica de fora agora

Vale registrar, porque a pergunta vai voltar.

`backend/cbers/constants.ts:17` já baixa exatamente o que seria preciso:

```ts
export const CBERS_REQUIRED_ASSETS = ["BAND3", "BAND4", "BAND2", "BAND0"] as const;
//                                     RED      NIR      GREEN    PAN
```

BAND3 é o vermelho e **BAND4 é o NIR**, salvos como GeoTIFF de 16 bits separados em
`sceneDir` **antes** do pansharpen (`backend/cbers/pipeline.ts:74-79`). A resolução é
muito melhor: 8 m multiespectral, 2 m pansharpened, contra 30 m do Landsat.

Dois motivos para não ser a fonte primária:

1. **Não alcança a janela legal.** CBERS-4A opera a partir de **2020** — o próprio grupo
   do WMS se chama `CBERS-4A-Apos_2019`. A janela AC/AVN (2003–2008) e a Fase 2
   (2009–2019) ficam inteiramente fora.
2. **É L4-DN, não reflectância.** Sem os coeficientes de calibração radiométrica do INPE,
   o resultado é **NDVI aparente sobre DN**: comparável dentro da mesma cena, **não
   comparável entre datas** — o que mata o R6 (série temporal).

Fica como extensão futura para **estado atual em alta resolução**, com rótulo próprio
("NDVI aparente CBERS-4A, não comparável entre datas"). Ver
[09-riscos-e-decisoes-abertas.md](09-riscos-e-decisoes-abertas.md).

---

## 2.6 Matriz final de suporte

| Período | Fonte | Sensor | Res. | Qualidade do NDVI |
|---|---|---|---|---|
| 1984–2011 | Landsat C2 L2 SR | L5 TM | 30 m | ✅ reflectância calibrada |
| 2012 | Landsat C2 L2 SR | L7 ETM+ | 30 m | ⚠️ SLC-off, faixas de vazio |
| 2013–2019 | Landsat C2 L2 SR | L8 OLI | 30 m | ✅ reflectância calibrada |
| 2020–hoje | Landsat C2 L2 SR | L8 / L9 | 30 m | ✅ reflectância calibrada |
| 2020–hoje | CBERS-4A WPM | CB4A | 8 m | ⚠️ futuro; DN, não comparável entre datas |
| Qualquer ano | Mosaico SEMA | — | — | ❌ **não suportado** |

---

## 2.7 Quando não houver NIR: falhar declarando, nunca estimar

Se a cena não existir, não cobrir o imóvel, ou tiver nuvem demais, o job **não inventa
número**. Termina com status explícito e o laudo imprime um quadro de limitação:

| Código | Quando | O que o laudo diz |
|---|---|---|
| `sem_cena_nir` | Nenhum item STAC no ano/janela cobrindo o imóvel | "Não há cena com banda NIR disponível para o período" |
| `cobertura_parcial` | Footprint da cena não contém o imóvel inteiro | "A cena cobre X% do imóvel; estatística restrita à porção coberta" |
| `nuvem_excessiva` | Pixels válidos < `NDVI_MIN_VALID_PCT` (padrão 60%) no polígono | "Cobertura de nuvem impediu medida representativa (X% de pixels válidos)" |
| `fonte_sem_reflectancia` | Só existe mosaico/composição para o período | "Fonte disponível não fornece reflectância; NDVI não calculável" |
| `sensor_degradado` | L7 SLC-off no ano pedido | "Cena Landsat 7 posterior a 31/05/2003 apresenta faixas sem dado" |

Isso é a aplicação direta da regra que já está no repositório — *"NÃO fabrique valores de
NDVI, área em hectares ou percentuais a menos que tenham sido calculados e fornecidos"*
(`client/src/pages/Dashboard.tsx:3563`).
