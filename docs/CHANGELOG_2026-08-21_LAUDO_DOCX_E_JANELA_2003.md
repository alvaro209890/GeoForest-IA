# CHANGELOG — Laudo em DOCX, janela AC/AVN contígua 2003–2008 e vocabulário AC × AUAS

**Data:** 2026-08-21
**Escopo:** `backend/simcar/*`, `backend/analise-pos-recorte/groq-vision-core.ts`,
`client/src/pages/Dashboard.tsx`, `client/src/dashboard/*`, `docs/IMAGENS_E_CAMADAS_LAUDO.md`
**Doc de apoio:** [`IMAGENS_E_CAMADAS_LAUDO.md`](IMAGENS_E_CAMADAS_LAUDO.md)

Quatro frentes, todas nascidas de erros apontados pelo Álvaro lendo um laudo real.

---

## 1. A janela temporal do laudo não era a que o código dizia ter

**Sintoma:** o cartão "Janela temporal" do laudo saía **2006–2008**, mesmo depois de
o commit `68d41e2c` ter expandido a janela AC/AVN para começar em 2003.

**Causa:** o backend só cai na janela padrão quando `selectedLayers` chega **vazio**
([`routes.ts:1138`](../backend/simcar/routes.ts)). O frontend manda a própria lista fixa,
e ela ainda era a antiga de 4 cenas — `SIMCAR_FIXED_AC_AVN_SATELLITES` em
`client/src/pages/Dashboard.tsx`. A expansão do backend nunca chegava a rodar.

**Correção:**

| Onde | Antes | Depois |
|---|---|---|
| `Dashboard.tsx` (lista do cliente) | 2006, 2007, SPOT 2008, 2008 | 2003, 2004, 2005, 2006, 2007, SPOT 2008, 2008 |
| `analysis.ts` (`AC_AVN_DEFAULT_KEYS`) | 2003, 2005, 2006, 2007, SPOT, 2008 | **+ 2004** — série contígua |

O 2004 faltava dos dois lados. Ele importa porque a classificação depende do **ano da
última atividade visível** (ver §2): um ano faltando pode mover a contagem de um lado ao
outro do limite de 5 anos do pousio.

**Bug encontrado no caminho.** `reduceImageSet` é o retry de quando o payload de visão
estoura. Ele filtrava legendas contendo `"Visão Geral"` — o que fazia sentido quando cada
satélite gerava 3 vistas. Desde `0e429b3b` cada satélite gera **um** composite, já rotulado
assim: o filtro deixou de reduzir qualquer coisa e o retry remandava payload idêntico. Com
4 cenas passava batido; com 7 (+75% de payload) viraria falha da análise inteira. Agora ele
reduz de verdade, preservando as cenas de maior peso jurídico: SPOT 2008, a cena do marco e
a de 2003.

Corrigido também `imagesPerSat = 3` na reserva de billing (`routes.ts`) — inflava a
estimativa em 3x. Sem efeito prático hoje (billing desligado), mas com 7 cenas o número
ficaria absurdo.

---

## 2. A regra do pousio estava implementada pela metade — e na metade errada

O prompt mandava, textualmente: *regeneração jovem sobre traçado antigo de talhão é pousio
— **NÃO classifique como vegetação nativa***. Regra de mão única: toda área regenerada
virava AC, sem nunca perguntar **há quanto tempo** a atividade parou.

O pousio do art. 3º, XXIV da Lei 12.651/2012 é a interrupção **por no máximo 5 anos**.
Passando disso, a interrupção descaracteriza a consolidação e a vegetação regenerada volta
a ser AVN. O código não detectava esse caso e instruía o modelo a decidir o contrário.

**A regra agora (`POUSIO_PROMPT_RULE` em `groq-vision-core.ts`), pelo ano da última
atividade visível — não pela aparência da cena de 2008:**

| Última atividade visível | Interrupção até 2008 | Classificação |
|---|---|---|
| 2004 ou depois | até 4 anos | **AC** — pousio |
| 2003 | 5 anos | **AC**, no limite legal — sinaliza para o RT |
| nenhuma em toda a série | mais de 5 anos | **AVN** |

Frase que fechava o buraco, agora explícita no prompt: *traço antigo de talhão prova que a
área já foi usada; não prova que o uso continuava dentro da janela de 5 anos.*

**Fronteira deliberadamente não cravada.** Exatos 5 anos (última atividade em 2003) ainda
cabem em "por no máximo 5 anos". O laudo classifica como AC **sinalizando o limite legal**,
em vez de decidir sozinho uma questão de fronteira. Mudar para "5 anos já é AVN" é uma
linha em `POUSIO_PROMPT_RULE`.

Entrou nos três prompts. No prompt **por satélite** o papel mudou: a cena isolada agora só
**reporta** se há atividade em curso ou só vegetação, e está proibida de concluir AC/AVN
sozinha — duração não se mede numa cena.

**Citação legal corrigida:** o marco de 22/07/2008 aparecia no prompt de síntese como
"Art. 68". O art. 68 trata de quem suprimiu respeitando a lei vigente à época; o marco da
área consolidada é o **art. 3º, IV** (c/c art. 61-A).

---

## 3. Vocabulário AC × AUAS — a confusão que mais estragava a redação

AC e AUAS descrevem **o mesmo estado do terreno** (solo sem vegetação nativa) e se separam
só pelo marco. Chamar AC de "área antropizada" é defensável pela letra da lei ("ocupação
antrópica"), mas no vocabulário do SIMCAR "antropizado" puxa para AUAS — ou seja, para
supressão que dependia de autorização. Em laudo que vai para a SEMA, isso lê como acusação.

**Regra de escrita adotada: AC → "uso consolidado"; AUAS → "supressão pós-2008".**

O erro estava espalhado e o código era internamente inconsistente: `explainAcVerdict` já
dizia "uso consolidado" enquanto `buildAcDecisionText`, na mesma etapa, dizia "uso
antrópico". 17 pontos uniformizados em `analysis.ts`, mais o quadro de achados:

| Onde | Antes | Depois |
|---|---|---|
| Achado de AC | "Nenhum uso **antrópico** relevante fora da AC" | "Nenhum uso **consolidado** relevante fora da AC" |
| Achado de AVN | "Antropização dentro do polígono AVN" | "Uso consolidado dentro do polígono AVN" |
| Fase 1 | "polígono AUAS com sinal de uso antrópico antes do marco" | "uso já implantado antes do marco — se confirmado, a área é consolidada (AC), não supressão pós-2008" |
| Fase 2 | "Conversões datadas" / "Já antropizados" | "Supressões datadas" / "Já em uso no início da série" |
| Front (painel AC/AVN) | `AC fora do shape` / `AVN antropizada` | "Uso consolidado fora da AC" / "Uso consolidado dentro da AVN" |

Duas fontes geram o texto do parecer e **as duas** estavam erradas: o gerador determinístico
(`buildAcDecisionText`, `buildSatelliteReadableLine`, blocos de "Resumo para o Usuário") e
os prompts da IA. O modelo nunca tinha recebido a distinção — `AC_AUAS_PROMPT_GLOSSARY`
agora entra nos prompts por satélite, unificado e na revisora final, dizendo explicitamente
que **constatar uso consolidado não é apontar irregularidade**.

O glossário sai impresso no laudo, num box abaixo da Fundamentação Legal.

**Códigos internos não mudaram** (`AVN_DENTRO_SHAPE_ANTROPIZADO`,
`alreadyAnthropizedCount`): são chaves de dado persistido e trocá-las quebraria os laudos
já salvos. Só o texto visível mudou.

**Resumo executivo:** removido o bullet `Imóvel de X ha; N de M camadas...` — duplicava
exatamente os quatro cartões de métrica logo acima.

---

## 4. Laudo em DOCX + exclusão da TIPOLOGIA_VEGETAL da entrega

### 4.1 DOCX editável (`backend/simcar/report-docx.ts`)

O PDF é a peça final, mas o responsável técnico precisa **editar** antes de assinar. Até
aqui, mudar um parágrafo significava reescrever o laudo inteiro no Word.

A decisão de conteúdo **não é duplicada**: veredito, achados, bullets, linha do tempo,
natureza de camada e glossário vêm de `report-theme.ts`, os mesmos que o PDF consome. O
DOCX só traduz aquele modelo para objetos do pacote `docx` (já era dependência, usada pelo
croqui). Texto que mudar no tema muda nos dois formatos junto.

Sai no mesmo papel timbrado da IMAP, reaproveitando `report-imap.ts` — as margens do Ofício
já estavam registradas em twips, que é a unidade do Word.

Diferenças inevitáveis em relação ao PDF, documentadas no cabeçalho do módulo:

- linha do tempo vira **tabela de anos** (não há canvas para o eixo com o marco tracejado);
- gráfico de barras não é reproduzido — os números já estão na tabela de quantitativos;
- **sem anexo fotográfico**: embutir os PNGs dobraria o tamanho do arquivo que o RT vai
  editar. O PDF segue sendo a peça com as imagens.

**Falha no DOCX não retém a entrega:** o `try/catch` em `generateAndPersistSimcarReport`
loga e segue com o PDF, que já está pronto. O front só esconde o botão de Word.

No site, o painel virou "Laudo Técnico SIMCAR" com **Baixar PDF** e **Baixar DOCX**; o card
do histórico ganhou o ícone de Word ao lado do de PDF. O download do .docx vai pelo
`file-proxy` em modo `download` — o navegador abriria um .docx numa aba em branco.

O DOCX é apagado junto com o card (antes ficaria órfão no storage).

### 4.2 TIPOLOGIA_VEGETAL fora de tudo que é entregue

`EXPORT_EXCLUDED_LAYERS` em `backend/simcar/constants.ts` é a fonte única. A camada é o
mapa de tipologia do imóvel inteiro: cobre ~100% da área, vem truncada pelo WFS em 50.000
feições e não declara nada (é o gotcha já registrado no `CLAUDE.md` — somá-la à área
declarada fazia 100% dos polígonos saírem com alerta ALTO na Fase 3). No pacote entregue
ela só polui: ocupa a maior parte do ZIP e domina a tabela do laudo com um número que não
significa sobreposição.

Aplicada em cinco pontos:

| Artefato | O que muda |
|---|---|
| ZIP de saída | camada não é escrita **e** seus arquivos do template são barrados |
| `QUANTITATIVOS.xlsx` | linha removida |
| Laudo PDF | fora da tabela, do gráfico, dos contadores e dos avisos |
| Laudo DOCX | idem |
| `GET /api/simcar/layers` | não é oferecida na lista de checkbox |

O passthrough do ZIP é o ponto delicado e o motivo de `isExcludedExportEntry` existir: o
ZIP repassa **todo** o `Modelo.zip`, então mesmo sem recorte os `.shp/.shx/.dbf/.prj`
**vazios** da camada entrariam. A função casa pelo nome inteiro do arquivo, não por
substring — `TIPOLOGIA_VEGETAL_ANEXO.shp` não é levado junto (teste trava isso).

**É filtro de saída, não de análise.** `TIPOLOGIA_VEGETAL` continua em `TEMPLATE_LAYERS` e
continua sendo recortada: as fases que a consultam (Fase 3, `geometry-evidence.ts`) seguem
recebendo a camada. O que muda é só o que sai no pacote. Para parar de buscá-la também,
seria tirar de `TEMPLATE_LAYERS` — decisão separada, não tomada aqui.

Existe um `--sem-tipologia` em `tools/rodar-recorte-simcar-cli.ts` que fazia isso à mão no
ZIP; ele continua funcionando, mas agora é redundante para o fluxo do app.

---

## Testes

- `backend/simcar/report-docx.test.ts` — **8 testes** (OOXML válido, paridade de conteúdo
  com o PDF, tipologia não vaza, contadores descontam a camada, laudo sem análise).
- `backend/simcar/export-exclusions.test.ts` — **9 testes** (nome de camada, nome de
  arquivo, subpasta, caixa, e o caso de substring que não pode casar).
- `backend/simcar/reduce-image-set.test.ts` — **7 testes** (redução real, cenas de maior
  peso preservadas, compatibilidade com o formato antigo de 3 vistas).
- `backend/simcar/report-theme.test.ts` — **+12** (vocabulário AC × AUAS, pousio dos dois
  lados, resumo executivo sem os quantitativos).
- `backend/simcar/satellite-window.test.ts` — **+1** (série 2003–2008 sem furo).

Suíte completa: **739 passed / 8 skipped, 0 falhas**. `tsc --noEmit` limpo.

Conferência visual dos dois formatos, sem rede e sem Firebase:

```bash
npx tsx scripts/preview-laudo-pdf.ts /tmp/laudo.pdf --fase=acavn --docx
```

---

## Decisões deixadas em aberto

1. **Pousio de exatos 5 anos** — classificado como AC com sinalização de limite. Se a
   leitura preferida for "5 anos já é AVN", é uma linha em `POUSIO_PROMPT_RULE`.
2. **Buscar ou não a TIPOLOGIA_VEGETAL** — hoje ainda é recortada (só não é entregue).
   Tirá-la de `TEMPLATE_LAYERS` economizaria a consulta WFS mais pesada do pipeline, ao
   custo da evidência geométrica da Fase 3.
3. **`VISION_API_URL` × `VISION_MODEL`** — o par de defaults segue inconsistente (Groq vs
   OpenRouter), conforme já registrado no changelog de 2026-08-20. Não mexido.
