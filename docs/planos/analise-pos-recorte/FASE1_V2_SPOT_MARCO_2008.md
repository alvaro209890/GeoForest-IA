# Fase 1 v2 — a IA passa a enxergar o SPOT 2008

> 2026-08-23 · continuação de [`FASE1_V2_SINAL_DUVIDA.md`](FASE1_V2_SINAL_DUVIDA.md)
> Imóvel de teste: job `27ca02d3-a2a8-40bb-8f82-461e1c72d18e` (265 ha, 2 polígonos AUAS / 33,45 ha)

## O sintoma

O laudo saía com todos os polígonos `INCONCLUSIVO` e a limitação
*"Cena de 2008 ausente, ilegível ou sem observação conclusiva"* — mesmo com as
**12/12 cenas persistidas** e o SPOT baixado corretamente do WMS da SEMA
(`Mosaicos:MOSAICO_SPOT_SEPLAN`, `usability: USABLE`).

Ou seja: a imagem existia, aparecia no anexo fotográfico do laudo, e **a IA
nunca a analisava**. Como o SPOT 2008 é justamente o marco legal
(22/07/2008), o veredicto saía sem passar pelo marco.

## Causa raiz — medida, não suposta

A janela `W2007_2008` (Landsat 2007 + SPOT 2008) falhava com `TIMEOUT` em
**todos** os polígonos, nas 3 tentativas.

A primeira hipótese foi o peso do PNG (o SPOT em zoom alto dá 790 KB → ~1 MB em
base64). Medição na mesma janela, mesmas cenas, mesmo prompt:

| Modelo | PNG original (43 KB + 790 KB) | JPEG q80 (5 KB + 82 KB) |
|---|---|---|
| `qwen/qwen3.6-27b` | 6,7 s · **>200 s (abortado)** | **119,9 s** |
| `google/gemini-2.5-flash` | 3,7 s | 5,3 s |

O tamanho do payload não explicava nada — a latência era **do modelo**. E o
modelo estava preso num literal:

```ts
// config.ts, antes
visionModel: readString("SIMCAR_AUAS_VISION_MODEL", "qwen/qwen3.6-27b"),
```

O `backend.env` já traz `VISION_MODEL=google/gemini-2.5-flash` (o que o resto do
backend usa), mas a Fase 1 o ignorava. Como a janela do SPOT é a mais pesada da
série, era sempre ela que estourava o timeout de 120 s.

## As correções

### 1. Modelo de visão herda o ambiente (`config.ts`)

```ts
SIMCAR_AUAS_VISION_MODEL  →  VISION_MODEL  →  "google/gemini-2.5-flash"
```

O override específico continua valendo; some o literal que contrariava o
ambiente.

### 2. `conflicts` ausente não derruba mais a janela (`text-sanitizer.ts`)

Com o modelo novo apareceu o segundo bloqueio: `INVALID_SCHEMA
(conflicts:invalid_type)` — reproduzido 2 em 3 chamadas. O
`gemini-2.5-flash` às vezes **omite** o campo `conflicts` do JSON; o zod o
exige, e a janela inteira caía (o polígono ia para `INCONCLUSIVO` por causa de
uma lista vazia que não veio).

`conflicts` é lista de "nada a relatar" — ausente significa nenhum conflito. O
sanitizador agora normaliza sempre, presente ou não.

### 3. Falha no SPOT vira limitação explícita (`orchestrator.ts`)

Se a janela do marco falhar de novo (rede, provedor fora do ar), o laudo passa a
declarar em vez de esconder dentro de um `INCONCLUSIVO` genérico:

> A cena SPOT 2008 (marco legal de 22/07/2008) foi obtida do WMS, mas a análise
> de visão falhou em N janela(s) [TIMEOUT]: o veredicto desses polígonos não
> considera o mosaico de 2008.

A janela do marco é derivada, não escrita à mão: `SPOT_MARCO_WINDOW_ID` sai de
`AUAS_VISION_WINDOWS` procurando quem carrega o ano 2008.

### 4. Compressão JPEG antes do envio (`orchestrator.ts`)

Mantida, mas com o comentário corrigido: é economia de banda/tokens (~1 MB → ~110 KB
por cena, sem resize, resolução nativa preservada), **não** a correção do
timeout. Falha de compressão cai no PNG original.

### 5. Glifos fora do WinAnsi no PDF (`report-text.ts`, `report.ts`)

Bug encontrado ao conferir o PDF gerado: as fontes padrão do PDFKit
(Helvetica & cia) só codificam WinAnsi/CP1252, então `"2007→SPOT 2008"` era
impresso como `2007!’SPOT 2008` e `"AC∩AVN"` como `AC A)VN` — no laudo
entregue, não só no `pdftotext`.

`reportPdfWinAnsiText()` translitera (`→` → `->`, `∩` → ` x `, `≤` → `<=`, …),
preserva o que o CP1252 representa (travessão, aspas curvas, bullet, toda a
acentuação portuguesa) e troca por `?` o que não tem representação alguma. Roda
num ponto só, no `doc.text` do PDF: o texto chega ali por ~40 chamadas e por
caminhos que não controlamos (saída da IA, nome de camada do SIMCAR). O `.docx`
é UTF-8 e não passa por aqui.

## Resultado no imóvel real

Antes (2 rodadas seguidas):

```
AUAS-0001 W2007_2008 FAILED  TIMEOUT
AUAS-0002 W2007_2008 FAILED  TIMEOUT
AUAS-0001 INCONCLUSIVO — "Cena de 2008 ... sem observação conclusiva"
AUAS-0002 INCONCLUSIVO — "Cena de 2008 ... sem observação conclusiva"
```

Depois:

```
AUAS-0001 W2003_2005 / W2005_2007 / W2007_2008  COMPLETED
AUAS-0002 W2003_2005 / W2005_2007 / W2007_2008  COMPLETED
AUAS-0001 INCONCLUSIVO            (janelas divergem em 2005 — conflito legítimo)
AUAS-0002 INCONCLUSIVO_NO_MARCO_2008 [ONLY_2007_TO_2008_CHANGE]
```

O `AUAS-0002` só chega a esse veredicto **porque a IA leu o SPOT**:

| Ano | Estado | Confiança | Fração | Evidência |
|---|---|---|---|---|
| 2007 (Landsat 5) | `NATIVE_VEGETATION` | HIGH | 0 | vegetação densa e contínua em verde forte/neon |
| 2008 (SPOT) | `MIXED` | HIGH | 0,40 | parte do polígono com vegetação densa em verde escuro |
| transição | `ANTHROPIZATION_APPEARED` | HIGH | — | mudança para solo exposto/pastagem na porção leste |

E o laudo declara o que isso significa: *"Mudança observada apenas entre 2007 e o
mosaico SPOT de 2008; não é possível determinar de qual lado de 22/07/2008 ela
ocorreu."*

## Testes

- `backend/analise-pos-recorte/spot-marco.test.ts` (6) — `SPOT_MARCO_WINDOW_ID`
  aponta para a janela de 2008; falha na janela do SPOT declara a limitação do
  marco; sem falha não inventa limitação; precedência
  `SIMCAR_AUAS_VISION_MODEL` > `VISION_MODEL` > padrão.
- `backend/simcar/report-winansi.test.ts` (6) — transliteração, preservação de
  acento/travessão/aspas curvas, substituto único para emoji.
- `backend/analise-pos-recorte/text-sanitizer.test.ts` (+2) — `conflicts`
  ausente e `conflicts` de tipo errado viram lista vazia.
- Suíte completa: **855 passando / 8 skipped**, `tsc --noEmit` limpo.

## Pendência conhecida

`INVALID_SCHEMA` ainda aparece esporadicamente em outras janelas (o modelo
devolve JSON fora do schema). O retry de 3 tentativas cobre o caso comum; se
voltar a ficar frequente, o caminho é logar o `failed_generation` da resposta
por janela, hoje só disponível no HTTP 400.
