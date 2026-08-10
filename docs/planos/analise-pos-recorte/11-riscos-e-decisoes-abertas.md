# 11 — Riscos e decisões em aberto

## 1. Riscos (com mitigação)

| # | Risco | Mitigação |
|---|---|---|
| R1 | **Troca de sensor vira falso positivo** — mudar de Landsat 5 para ResourceSat (2012), para Landsat 8 (2013) ou para Sentinel-2 (2018) muda cor, textura e resolução; o modelo pode ler isso como "mudou o uso" | O redutor conhece as fronteiras: transição em fronteira só vira **ano confirmado** com janela-ponte no sensor alternativo; senão vira intervalo. Nunca é o prompt que resolve isso |
| R2 | **Polígono menor que a resolução** — um AUAS de 0,5 ha em Landsat 30 m tem ~5 pixels | Resolução dinâmica já existe (`calculateDynamicResolution`); abaixo de um mínimo observável o resultado é `INCONCLUSIVO` com a limitação explícita, nunca "sem mudança" |
| R3 | **8k TPM** torna imóvel grande insuportavelmente lento | Prévia com ETA antes do clique, fila guiada por headers, checkpoint por janela, cancelar/retomar, e a Fase 3 (barata) podendo rodar mesmo com a 2 pendente se o Álvaro escolher A6 |
| R4 | **`INCONCLUSIVO` lido como "está limpo"** | Proibido em UI e PDF apresentar inconclusivo como ausência de desmate; contagem de inconclusivos sempre visível no agregado; alarme quando > 30% |
| R5 | **Fase 2 contradiz a Fase 1** (ex.: diz "convertido em 2014" num polígono com alerta pré-2008) | A Fase 2 ecoa o resultado da Fase 1 por polígono e o redutor trata `JA_ANTROPIZADO_NO_INICIO_DA_SERIE` como coerente com alerta pré-2008; o texto explica as duas leituras em vez de escolher uma |
| R6 | **Mosaico da SEMA muda** (republicação de um ano) e checkpoints ficam inválidos | `catalogVersion` entra na chave do checkpoint → invalidação automática |
| R7 | **Recorte refeito** e as fases desalinham | `geometryHash` amarra as fases; divergência → `PHASE1_MISMATCH` e resultados marcados `stale` |
| R8 | **Vegetação na AC confundida com cultura perene/silvicultura** (eucalipto, café, seringal parecem "mata" no RGB) | Cena NIR na Fase 3, distribuição (`RIPARIAN`/`EDGE`/`INTERIOR`) no JSON, e precedência da evidência **geométrica** (AVN declarada) sobre a visual |
| R9 | **Groq indisponível ou 429 persistente** | Checkpoints + retomada; na Fase 3 o cruzamento geométrico é entregue mesmo sem visão |
| R10 | **DeepSeek fora do ar** | Fallback determinístico já implementado na Fase 1 — replicar nas fases 2 e 3. Nunca usar modelo textual da Groq como substituto |
| R11 | **Dashboard.tsx cresce mais 1.000 linhas** | Painel novo nasce em `client/src/dashboard/panels/analise-pos-recorte/`; o Dashboard só monta o componente |
| R12 | **Duas análises AUAS coexistindo** (V1 2008–2024 e V2) confundem o usuário e o histórico | Decisão A5: definir se V1 vira legado somente-leitura assim que a Fase 1 ligar |
| R13 | **Chave de API vazando** em prompt, log ou fixture | Regra herdada: segredo só em env do backend; URLs persistidas sem `authkey`; revisão no PR de cada fase |
| R14 | **Custo cobrado sem resultado** (job cai depois de 40 chamadas) | Reserva/liquidação por fase + checkpoints: retomar não recobra o que já foi feito |

## 2. Decisões fechadas (Álvaro | 2026-08-10)

| # | Pergunta | Decisão |
|---|---|---|
| **A1** | A Fase 2 começa em **2009** (primeiro ano pós-marco) ou inclui **Landsat 5 2008** como cena de calibração do mesmo ano do SPOT? | **Começar em 2009**; L5 2008 entra apenas como cena de referência opcional, sem poder de datar |
| **A2** | Em 2016 e 2017 há **Landsat 8 e Sentinel-2**. Qual usar? | **Landsat 8** (continuidade com 2013–2015); Sentinel-2 fica como candidato da janela-ponte |
| **A3** | Na Fase 3, qual o **limiar de vegetação declarada** que dispara alerta ALTO, e o tamanho de sliver a descartar? | **≥ 1% da AC ou ≥ 0,5 ha** (o que vier primeiro); slivers < 500 m² descartados |
| **A4** | Existe **teto de polígonos** por job (para não travar a fila com um imóvel de 200 AUAS)? | **Sem teto (`0`)**, mas com prévia de ETA e aviso quando passar de ~30 polígonos |
| **A5** | O que acontece com o **fluxo V1 (2008–2024)** quando a Fase 1 ligar? | **Legado somente-leitura**: cards antigos abrem, mas nenhuma análise nova usa V1 |
| **A6** | A Fase 3 **precisa mesmo** da Fase 2 concluída, ou pode ser liberada logo após a Fase 1? | **Manter o pedido original** (exige Fase 2). Nota técnica: ela não depende de dado da Fase 2 — é escolha de fluxo, e pode ser afrouxada depois sem retrabalho |
| **A7** | Quando a Fase 2 der `SEM_MUDANCA_OBSERVADA`, o sistema deve **encadear automaticamente** a consulta SCCON (≥2019) ou só sugerir a aba? | **Só sugerir**, com link para a aba AUAS × SCCON |
| **A8** | As **cenas** analisadas devem ser guardadas para o usuário rever, ou só o hash/proveniência? | **Só proveniência + hash**; guardar imagem apenas dos polígonos com alerta |
| **A9** | O laudo em PDF deve trazer as **três fases num documento só** ou um PDF por fase? | **Um documento só**, com três seções e sumário |
| **A10** | Uma fase pode ser **refeita isoladamente** pelo usuário, invalidando as seguintes? | **Sim**, com confirmação explícita e marcação `stale` nas posteriores |

**Decisão extra (Fase 3, fonte da área declarada, Álvaro | 2026-08-10):** manter a área
declarada **só com `AVN`** (`SIMCAR_AC_VEG_DECLARED_SOURCES` inalterado); a
`TIPOLOGIA_VEGETAL` segue como contexto no JSON, nunca como gatilho de alerta — medido em
2026-08-07, ela cobre ~100% de toda AC e saturaria o alerta (falso ALTO universal).

**Rollout combinado (Álvaro | 2026-08-10):** **F1** pronta para ligar
(`SIMCAR_AUAS_V2_ENABLED=true` no servidor — dourado humano + live DeepSeek ok); **F2**
liga após F1 estável ≥ 1 semana + dourado F2 conferido; **F3** liga após F2 estável +
conferência GIS de ≥ 3 imóveis.

## 3. Fora de escopo (não entra neste plano)

- Comparação raster determinística pixel a pixel (NDVI calculado por nós).
- Reintroduzir PRODES ou qualquer fonte vetorial de desmate além da SCCON já existente.
- Classificação legal automática (infração, passivo, anistia).
- Alterar a análise AC/AVN existente.
- Enviar imagens ao DeepSeek (proibido por contrato).
- Datação pós-2019 por imagem — é da aba AUAS × SCCON.
