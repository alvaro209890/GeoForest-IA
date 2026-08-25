# 06 — Laudo NDVI em Word (.docx)

## 0. Regra de convivência

⚠️ **Enquanto este plano foi escrito, outro agente estava editando
`backend/simcar/report-docx.ts`, `backend/simcar/report.ts` e
`backend/simcar/report-docx.test.ts`, e criou `backend/simcar/report-images.ts`.**

O laudo NDVI é **módulo novo e separado**:

```
backend/ndvi/report-ndvi-docx.ts
```

Isso não é só para evitar conflito de merge — o pedido é de **laudo próprio**, com
identidade e conteúdo próprios. O laudo SIMCAR continua sendo o laudo SIMCAR.

| Arquivo | Pode mexer? |
|---|---|
| `backend/ndvi/**` | ✅ território novo |
| `backend/simcar/report-theme.ts` | ✅ acrescentar (não reescrever) — ver §6 |
| `backend/simcar/report-imap.ts` | ✅ só ler e importar |
| `backend/simcar/report-images.ts` | ✅ só ler e importar |
| `backend/simcar/report-docx.ts` | ❌ **quente** |
| `backend/simcar/report.ts` | ❌ **quente** |
| `backend/simcar/report-docx.test.ts` | ❌ **quente** |
| `backend/simcar/phases.ts` + `phases.test.ts` | ⚠️ **quente** — mas o doc 07 exige tocar. Ver aviso abaixo |
| `backend/analise-pos-recorte/wms-scenes.ts` | ⚠️ **quente** — só importar, não editar |
| `backend/analise-pos-recorte/ac-vegetacao/**` | ❌ **quente** |
| `client/src/dashboard/panels/analise-pos-recorte/phase-state.ts` | ⚠️ **quente** — o doc 07 exige tocar |

> **Conferir `git status` antes de começar.** Em 25/08/2026 o outro agente ampliou o
> alcance para `phases.ts`, `wms-scenes.ts`, `ac-vegetacao/` e o `phase-state.ts` do
> frontend. Os dois pontos onde este plano precisa desses arquivos — acrescentar o
> `PhaseId` `"NDVI"` e o cartão da UI — devem ser **os últimos commits** da
> implementação, depois que o outro trabalho tiver assentado. Tudo em `backend/ndvi/`
> pode ser feito antes, sem esperar.

---

## 1. O que reusar do laudo existente

O renderizador DOCX atual (`backend/simcar/report-docx.ts`) é o gabarito de estilo.
Reusar de lá o **padrão**, e importar diretamente estas peças:

| Peça | Origem | Uso |
|---|---|---|
| `IMAP_ADDRESS_LINES`, `IMAP_COLORS`, `loadTimbradoImapPng()` | `backend/simcar/report-imap.ts` | Papel timbrado oficial |
| `pngImageSize(buffer)` | `backend/simcar/report-images.ts` | Proporção das figuras |
| `PALETTE`, `TONES`, `Tone`, `worstTone` | `backend/simcar/report-theme.ts` | Cores |
| `parseMarkdownBlocks`, `splitLongParagraph` | idem | Texto livre → parágrafos |
| `LEGAL_BASIS_LINES`, `AC_VS_AUAS_GLOSSARY` | idem | Fundamentação e vocabulário |
| `docx` (`^9.7.1`) | npm | `Document`, `Packer`, `Paragraph`, `Table`, `ImageRun`, `Header`, `Footer`… |

### Geometria da página — não inventar

O laudo sai **no papel timbrado oficial da IMAP**, o mesmo PNG e as mesmas margens que o
sistema de acompanhamento de processos usa:

```ts
const PT = 20;                                    // twips por ponto
const DOCX_MARGINS = { top: 2154, bottom: 1700, left: 1418, right: 1418,
                       header: 15 * PT, footer: 15 * PT };
const CONTENT_WIDTH = 11906 - 1418 - 1418;        // 9070 twips = 453,5 pt
```

⚠️ **A área útil é a do Ofício: 453 pt, não 511 pt.** Toda tabela nova tem que caber
nela. `IMAP_CONTENT_WIDTH = 453.48` em `report-imap.ts:60` é o mesmo número em pontos.
Como o laudo NDVI tem uma tabela larga (9 colunas), esse limite é o que mais aperta —
ver §4.

Cabeçalho: o timbrado entra como `ImageRun` **flutuante**, `behindDocument: true`,
595×842 px, `horizontalPosition/verticalPosition offset 0`. Título à direita:
**`LAUDO TÉCNICO — ÍNDICE DE VEGETAÇÃO (NDVI)`**.

Rodapé: `IMAP_ADDRESS_LINES` + linha de meta à direita com `PageNumber.CURRENT`.

Fonte `Calibri`. Lembrar que o `docx` conta **meio-pontos**: `size: pontos * 2`.

---

## 2. Versão do documento

```ts
export const NDVI_REPORT_DOCX_VERSION = "ndvi-report-docx-v1";
```

Bumpar quando a estrutura mudar (o laudo SIMCAR já está em `simcar-report-v3` no PDF).

---

## 3. Estrutura do laudo

### Seção 1 — Capa e identificação

| Campo | Origem |
|---|---|
| Nº do CAR / identificação do imóvel | contexto do recorte |
| Município / UF | idem |
| Área total (ha) | `summary.propertyAreaHa` |
| Data de emissão | `new Date()` |
| Job de origem | `clipJobId` |
| Versão | `NDVI_REPORT_DOCX_VERSION` |

### Seção 2 — Origem do dado (quadro, tom `info`)

**Obrigatória.** É o equivalente NDVI do `vectorSourceNote`/`imageSourceNote` do laudo
SIMCAR: quem lê precisa saber exatamente de onde veio o número.

```
Fonte:        Landsat Collection 2 Nível 2 — Reflectância de Superfície (landsat-c2l2-sr)
Plataforma:   Landsat 5 TM
Órbita/ponto: 224/069
Passagem:     20/07/2008
Nuvem na cena: 4,2%
Resolução:    30 m
Processamento: recorte pelo perímetro do imóvel, conversão DN → reflectância
               (ρ = DN × 0,0000275 − 0,2), máscara de nuvem/sombra pelo QA_PIXEL
CRS:          EPSG:32621 (nativo da cena)
```

### Seção 3 — Metodologia (texto curto)

Fórmula, a conversão de escala, a máscara de nuvem, e a frase que amarra a
reprodutibilidade: mesmo insumo + mesma expressão = mesmo número.

### Seção 4 — Mapa NDVI (figura principal)

Recorte colorido pela rampa, com o perímetro do imóvel sobreposto. Ver §5.

### Seção 5 — Estatísticas por polígono ⭐

**O coração do laudo.** É o número que a reunião pediu. Ver §4 abaixo para o layout.

### Seção 6 — Faixas de interpretação (legenda)

A tabela de [03 §3.10](03-pipeline-ndvi.md#310-faixas-de-interpretação), com a tarja de
cor de cada faixa. Sem ela o leitor não sabe ler o mapa.

### Seção 7 — Série temporal (só quando houver > 1 ano)

Tabela ano × NDVI médio por feição, com **colunas de plataforma e data de passagem**
(obrigatórias — ver [04 §4.5](04-estatisticas-zonais.md#45-série-temporal-r6)), e um
gráfico de barras opcional.

### Seção 8 — Limitações ⚠️ OBRIGATÓRIA

**Não pode ser suprimida, nem quando tudo dá certo.** É o R9 + R10 da reunião virando
peça escrita. Sem ela o laudo afirma mais do que o dado sustenta.

Texto-base (`NDVI_LIMITATION_LINES`):

> - O NDVI é um **indicador de vigor da cobertura vegetal**, não uma classificação de
>   uso do solo nem uma datação de supressão.
> - A resolução de **30 m** do Landsat produz **pixel misto**: num mesmo pixel podem
>   coexistir solo exposto, vegetação em regeneração e vegetação nativa, e o índice
>   devolve a média deles. Em bordas e fragmentos estreitos o valor tende ao meio da
>   escala e **não descreve nenhum dos componentes**.
> - O NDVI **satura em floresta densa**: acima de ~0,8 ele deixa de discriminar
>   diferenças reais de biomassa.
> - Valores dependem da **fenologia** (estação, chuva recente) e da **plataforma**.
>   Comparações entre anos com sensores diferentes exigem cautela.
> - Este laudo é o **primeiro elemento** de uma cadeia de evidências. Ele **não conclui
>   isoladamente** sobre área consolidada, vegetação nativa ou supressão pós-2008.

A quarta e a quinta linhas são citação técnica direta da reunião:

> "devido à escala do Landsat de 30 por 30, ele acabava **mascarando** esse resultado…
> tinha que ser uma coisa mais avançada" — IMAP, 37:33–37:52
>
> "**NDVI, SAVI** e por último você mata com o índice espectral" — IMAP, 31:59

Quando houver falha parcial (`nuvem_excessiva`, `cobertura_parcial`,
`area_pequena_demais`), acrescentar aqui a linha correspondente de
[02 §2.7](02-fonte-das-bandas.md#27-quando-não-houver-nir-falhar-declarando-nunca-estimar).

### Seção 9 — Fundamentação legal

Reusar `LEGAL_BASIS_LINES` do `report-theme.ts` (marco 22/07/2008 da Lei 12.651/2012
art. 3º IV; marco do pousio 22/07/2003, art. 3º XXIV c/c IN SEMA-MT 04/2023 art. 42 §6º).

---

## 4. A tabela de estatísticas — cabe em 453 pt?

Nove colunas em 9070 twips. Distribuição sugerida, com a **última coluna levando o
resto** para o total fechar exato (é o padrão do `report-docx.ts`):

| Coluna | Fração | Twips |
|---|---|---|
| Camada | 0,17 | 1542 |
| Feição | 0,07 | 635 |
| Área (ha) | 0,11 | 998 |
| Mín. | 0,09 | 816 |
| **Média** | 0,11 | 998 |
| Máx. | 0,09 | 816 |
| Desvio | 0,09 | 816 |
| Válidos % | 0,10 | 907 |
| Classe | resto | 1542 |

Regras de renderização:

- **Média em negrito** — é o número que o leitor procura.
- Célula da classe com `shading` no tom da faixa (`TONES`), igual ao Quadro de Achados.
- `validPct < 60%` → linha inteira em tom `warn` e classe vazia.
- Bordas: só horizontais (`TABLE_BORDERS` do padrão da casa).
- Cabeçalho com fundo escuro, texto branco 8 pt em negrito; corpo 8,5 pt.
- Valores de NDVI com **duas casas decimais** e **vírgula decimal** (pt-BR).
- Linha do **imóvel inteiro primeiro**, destacada, depois as feições agrupadas por camada.

Se ainda ficar apertado: fundir "Mín." e "Máx." numa coluna "Mín.–Máx.".

---

## 5. As figuras

### Como gerar (sem depender de rede)

O laudo é gerado no mesmo processo que acabou de produzir o `ndvi_rgb.tif`. Converter
localmente é mais rápido e mais confiável do que pedir GetMap ao GeoServer:

```bash
gdal_translate -of PNG -outsize 1400 0 \
  -co WORLDFILE=NO \
  "$TMP/ndvi_rgb.tif" "$TMP/fig_ndvi.png"
```

Sobrepor o perímetro do imóvel com `sharp` + SVG — o projeto já faz exatamente isso:
`buildAuasPolygonOverlaySvg` e `compositeOverlay` em
`backend/analise-pos-recorte/wms-scenes.ts:428` e `:473`. Esse módulo é testado e é a base
melhor; o de `backend/simcar/analysis.ts` é o legado.

### Como embutir no Word

Mesma matemática do laudo atual (`report-docx.ts:636-645`):

```ts
const dims = pngImageSize(buffer);
const aspectRatio = dims && dims.height > 0 ? dims.width / dims.height : 4 / 3;
const maxW = 600, maxH = 560;                   // px @96dpi
let w = maxW, h = Math.round(maxW / aspectRatio);
if (h > maxH) { h = maxH; w = Math.round(maxH * aspectRatio); }
```

Parágrafo centralizado com `keepNext: true`, seguido de legenda itálica centralizada
`Figura N — …`.

### Quais figuras

| # | Figura | Quando |
|---|---|---|
| 1 | Mapa NDVI colorido + perímetro | sempre |
| 2 | Barra de legenda da rampa | sempre |
| 3 | Mapa por classe | opcional |
| 4+ | Um mapa por ano | só na série temporal |

Figura que falhar **não some em silêncio** — entra numa lista `figurasIndisponiveis` e
vira um quadro de aviso, como o laudo atual faz (`report.ts:926-937`).

---

## 6. O que acrescentar em `report-theme.ts`

O `report-theme.ts` é a fonte única de conteúdo do repo — a casa manda pôr conteúdo lá,
não no renderizador. **Acrescentar, nunca reescrever** (o arquivo tem teste completo):

```ts
export type NdviClass = "agua" | "solo" | "rala" | "intermediaria" | "arborea" | "densa";

export const NDVI_CLASS_BANDS: ReadonlyArray<{
  min: number; max: number; id: NdviClass; label: string; tone: Tone;
}> = [ /* faixas do doc 03 §3.10 */ ];

export function classifyNdvi(mean: number | null): { id: NdviClass; label: string; tone: Tone } | null;

export const NDVI_LIMITATION_LINES: readonly string[];   // seção 8
export const NDVI_METHOD_LINES: readonly string[];        // seção 3

export function buildNdviFindings(ndvi: NdviResult): Finding[];
```

`Finding` já existe (`{ label; status; tone; detail }`) e é o que alimenta o Quadro de
Achados. Produzir `Finding[]` a partir do NDVI deixa a porta aberta para, no futuro,
o laudo SIMCAR incorporar um achado de NDVI sem duplicar lógica.

---

## 7. Entrada e saída do módulo

```ts
export async function buildNdviReportDocxBuffer(args: {
  clipJobId: string;
  ndvi: NdviResult;                 // doc 04 §4.6
  summary?: any;                    // do recorte: área, CRS, camadas
  job?: CachedJob;
  figures?: Array<{ caption: string; buffer: Buffer }>;
  series?: NdviResult[];            // > 1 ano
}): Promise<Buffer>;
```

**Sem I/O de rede e sem filesystem**, exceto `loadTimbradoImapPng()`. É essa disciplina
que deixa o laudo atual renderizável offline em teste — manter.

### Persistência

Seguir `generateAndPersistSimcarReport` (`backend/simcar/report.ts:1016`):

1. `persistSimcarClipArtifacts({ patch: { ndviReportStatus: "generating" } })`
2. Nome: `NDVI_Laudo_Tecnico_${clipJobId.slice(0,8)}.docx`
3. Upload: `uploadRawBufferToCloudinary(buffer, filename, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", uid)`
   → cai em `STORAGE_ROOT/users/<uid>/simcar/output/<Date.now()>_<nome>.docx`
4. Descartar laudo NDVI anterior do mesmo job — molde `discardSupersededReportFiles`
   (`report.ts:992`), **incluindo o guarda `storagePathBelongsToUid`**, que é proteção
   contra travessia de caminho e não pode ser omitido
5. `persistSimcarClipArtifacts({ patch: { ndviReportUrl, ndviReportDownloadUrl,
   ndviReportFilename, ndviReportVersion, ndviReportStatus: "ready" } })`
6. Em falha: `{ ndviReportStatus: "failed", ndviReportError }` e propagar

⚠️ **Falha no laudo não pode derrubar o que já foi publicado.** O raster e a camada WMS
são entregas independentes — se o DOCX quebrar, o job termina com o raster publicado e o
laudo marcado como falho. É a mesma regra que já vale para o DOCX do laudo SIMCAR
("falha no DOCX não retém a entrega: o PDF vai assim mesmo").

---

## 8. E o PDF?

O pedido é **laudo em Word**, e é só isso que este plano entrega. O DOCX é o formato que
o RT edita antes de assinar — a mesma razão pela qual o laudo SIMCAR tem versão Word.

Se um PDF for pedido depois: o `report-theme.ts` já estará com o conteúdo NDVI (§6), e o
renderizador PDF vira um irmão que consome o mesmo modelo, exatamente como
`report.ts` e `report-docx.ts` fazem hoje. Nenhuma decisão deste plano fecha essa porta.
