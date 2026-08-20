# CHANGELOG — Laudo PDF v2 e janela temporal expandida

**Data:** 2026-08-20
**Escopo:** `backend/simcar/report.ts`, `backend/simcar/report-theme.ts` (novo),
`backend/simcar/analysis.ts`, `backend/analise-pos-recorte/pos2008/*`
**Doc de apoio:** [`IMAGENS_E_CAMADAS_LAUDO.md`](IMAGENS_E_CAMADAS_LAUDO.md)

## Problema

O laudo (`simcar-report-v1`) era um paredão de texto: resumo executivo em
parágrafo corrido, tabela monocromática, nenhuma pista visual de gravidade e
nenhuma noção de que anos foram olhados. Pior, `reportCleanText` **apagava a
estrutura markdown** que a própria IA produzia (`##`, `- **Rótulo:**`),
achatando parecer inteiro em blocos de 950 caracteres.

Na janela temporal, a análise AC/AVN olhava só 2006–2008 — insuficiente para
aplicar o **pousio quinquenal** (IN SEMA-MT 04/2023, art. 42 §6º), que exige ver
a atividade em **2003**. A série AUAS pulava 2012 e parava em 2024, embora a SEMA
publique `RESOURCESAT_2012` e `SENTINEL_2_2025`.

## Mudanças

### 1. Laudo PDF v2 (`simcar-report-v2`)

Novo módulo `backend/simcar/report-theme.ts` com **toda a decisão de conteúdo e
cor em funções puras** (o `report.ts` só desenha). Isso é o que permitiu testar o
laudo sem gerar PDF — 29 testes novos.

- **Painel de veredito** no topo, com semáforo e confiança: `Requer revisão`
  (vermelho) / `Parcialmente inconclusivo` (amarelo) / `Sem ajuste indicado`
  (verde). Um achado vermelho manda no painel inteiro.
- **Resumo executivo em bullets**, teto de 5 achados, cada um com marcador da cor
  do seu tom. Fim do parágrafo de 2.200 caracteres.
- **Quadro de achados**: uma linha por indicador com pílula colorida e uma frase
  de consequência. `INCONCLUSIVO` é amarelo, nunca verde — pendência não é
  aprovação.
- **Linha do tempo visual**: ponto cheio = ano com cena, vazado = ano sem cena,
  vermelho = conversão datada, e o **marco de 22/07/2008** tracejado. Quando há
  datação depois do marco, um box lembra que aquilo exige AUAS/AUTEX (art. 26).
- **Markdown estruturado**: títulos viram subtítulos verdes, `- **Rótulo:** texto`
  vira bullet com rótulo em negrito, parágrafo longo é quebrado por frase.
- **Tabela de camadas** com coluna **Natureza** (Restrição / Uso / Base) colorida
  e `% do imóvel` destacado acima de 25%; o gráfico usa as mesmas cores.
- **Fundamentação legal aplicada**: seção nova com as normas que definem os
  marcos usados.
- **Título correto por fase**: a Fase 2 e a Fase 3 apareciam como "Análise de
  Área de Uso Alternativo do Solo (AUAS)" porque compartilham o campo `auasText`.
  Agora `detectReportKind` identifica a etapa e nomeia a seção.

### 2. Três bugs do PDF corrigidos no caminho

- 🔴 **Páginas em branco no fim do laudo.** O rodapé era escrito abaixo da margem
  inferior e o pdfkit abre uma página nova a cada escrita nessa faixa: um laudo de
  4 páginas saía com **12**. Corrigido zerando `page.margins.bottom` antes de
  escrever o rodapé.
- 🟠 **Logo sumia fora de produção.** O caminho resolvia para `backend/`, e a logo
  está na raiz do repo — só funcionava com o bundle `dist/`. Agora resolve por
  candidatos.
- 🟠 **Título órfão do gráfico.** A seção era escrita antes de saber se a imagem
  cabia; título ficava no rodapé de uma página e o gráfico sozinho na seguinte.
  Agora a imagem é decodificada e o espaço reservado antes do título.

### 3. Janela temporal expandida

| Etapa | Antes | Depois |
|---|---|---|
| AC/AVN | 2006, 2007, SPOT 2008, 2008 | **2003**, 2005, 2006, 2007, SPOT 2008, 2008 |
| Série AUAS | 2008–2024, sem 2012 | 2008–**2025**, sem furo de ano |
| Catálogo | — | + `landsat7_2002`, `resourcesat_2012`, `sentinel2_2025` |
| Fase 2 | fixa 2009–2019 | configurável até 2025 (janelas geradas) |

- `getFixedAcAvnSatelliteKeys()` passou a ler `SIMCAR_ACAVN_SATELLITE_KEYS`;
  override inválido cai na janela padrão em vez de zerar a análise.
- `AUAS_SATELLITE_KEYS` ficou contígua de 2008 a 2025 (teste trava ano a ano).
- Metadados de sensor para Landsat 7 e ResourceSat.
- `analysisRulesVersion` foi de `acavn-fixed-v4` para **`acavn-fixed-v5`**.

**Fase 2 configurável:** `buildPos2008Windows(start, end)` gera as janelas de 3
anos com 1 ano compartilhado a partir da série efetiva; `Pos2008WindowId` virou
template literal (`W${number}_${number}`) e o schema Zod valida por formato. O
default segue **2009–2019** — a fronteira do handoff para o SCCON é decisão do
Álvaro, registrada em `IMAGENS_E_CAMADAS_LAUDO.md` §3.

### 4. Prompts de visão AC/AVN acertados

- Os prompts ainda descreviam **3 imagens por satélite** e "sem preenchimento",
  contrato que morreu no commit `0e429b3b` (1 composite com fills e legenda). O
  modelo procurava duas imagens que não existiam.
- `FALSE_COLOR_PROMPT_NOTE` passou a valer também para AC/AVN. Os mosaicos da
  SEMA são falsa-cor (só o SPOT 2008 é cor natural) e o aviso só existia nas
  fases 1/2/3 — sem ele o modelo trata a cena como corrompida.
- Regra do **pousio** adicionada: cobertura vegetal jovem e homogênea sobre
  traçado antigo de talhão, em cena pré-marco, é área em descanso, não vegetação
  nativa.

### 5. Teste vermelho no `main` corrigido

`groq-vision-client.test.ts` cravava `qwen/qwen3.6-27b` como modelo default;
o commit `cee54247` tornou o modelo configurável (`VISION_MODEL`, default
`google/gemini-2.5-flash`). O teste agora passa o modelo por `deps`.

## Ponto de atenção não resolvido

`VISION_API_URL` tem default **Groq** e `VISION_MODEL` tem default
**`google/gemini-2.5-flash`** (OpenRouter): sem env, as fases 1/2/3 mandam um
modelo do OpenRouter para a API da Groq. Em produção as duas variáveis estão
setadas, então não quebra hoje — mas o par default é inconsistente. Não mexi por
não ser decisão minha qual dos dois lados deve mudar.

## Testes

- `backend/simcar/report-theme.test.ts` — **29 testes** (semáforo, achados por
  fase, painel de veredito, linha do tempo, markdown, natureza de camada).
- `backend/simcar/satellite-window.test.ts` — **11 testes** (janela AC/AVN nos
  marcos legais, série AUAS sem furo, override por env).
- `backend/analise-pos-recorte/pos2008/timeline.test.ts` — **+7 testes** (janelas
  geradas, série configurável, teto de 3 cenas, validação de env).
- Suíte completa: **694 passed / 8 skipped, 0 falhas**. `pnpm check` e
  `pnpm run build` verdes.

Conferência visual (sem rede, sem Firebase):

```bash
npx tsx scripts/preview-laudo-pdf.ts /tmp/laudo.pdf --fase=acavn
```
