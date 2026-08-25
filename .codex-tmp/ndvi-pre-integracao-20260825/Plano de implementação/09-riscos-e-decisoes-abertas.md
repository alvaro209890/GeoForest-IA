# 09 — Riscos, armadilhas e decisões abertas

## 1. Riscos técnicos

Ordenados por custo esperado (probabilidade × estrago).

### R-01 · O offset do C2 L2 não cancela na razão 🔴

**Estrago:** número errado com aparência de certo, variando com o brilho da cena — erra
mais em uns polígonos que em outros e nada denuncia na saída. Laudo assinado com dado
falso.

**Mitigação:** conversão para reflectância antes da divisão; teste unitário que
**exige** que o NDVI no DN cru difira do correto ([08 §2.1](08-fases-e-aceitacao.md#21-unitários));
sanidade `min ≥ −1 / max ≤ 1` no `gdalinfo` após o cálculo.

---

### R-02 · `gdal_calc.py` ausente no servidor 🟠

**Estrago:** F1 trava.

**Mitigação:** F0 confere antes de qualquer código; Plano B com `osgeo.gdal` + `numpy`
já especificado ([03 §3.1](03-pipeline-ndvi.md#31-ferramentas-gdal--conferir-antes-de-escrever-código)).
As bindings Python do GDAL estão comprovadamente instaladas — `gdal_pansharpen.py`
funciona hoje.

---

### R-03 · Nuvem contamina a média 🟠

**Estrago:** média mede nuvem, não vegetação. Nuvem puxa NDVI para baixo; sombra também.
Uma AVN íntegra pode sair classificada como degradada.

**Mitigação:** máscara `qa_pixel`; `validPct` obrigatório em toda linha e em todo cartão;
feição abaixo de 60% de pixels válidos não é classificada.

---

### R-04 · Pixel misto em 30 m 🟠

**Estrago:** é o R9 da reunião — *"devido à escala do Landsat de 30 por 30, ele acabava
mascarando esse resultado"*. Bordas e fragmentos estreitos devolvem o meio da escala, que
não descreve nada.

**Mitigação:** não é um bug a corrigir, é um limite a declarar. Seção de Limitações
obrigatória; `NDVI_MIN_PIXELS` bloqueia classificação de feição minúscula. Extensão
futura com CBERS-4A (8 m) atenua, sem eliminar.

---

### R-05 · Cena deslocada 🟠

**Estrago:** NDVI medido no chão errado. O acervo local já teve cenas com **1,4 km** de
deslocamento como escolha primária do ranqueamento
(`docs/ACERVO_LANDSAT_LOCAL.md`), e **bbox não detecta desvio de 30–300 m** — a variação
natural de enquadramento entre datas da mesma órbita é de 1 a 10 km e engole o erro real.

**Mitigação:** usar STAC do USGS/Planetary Computer, não o acervo local — as cenas C2 L2
são ortorretificadas e georreferenciadas na origem. **Não reaproveitar
`config/acervo-landsat.json`** como fonte de cena para NDVI.

---

### R-06 · Falso positivo na comparação entre anos 🟠

**Estrago:** troca de sensor (L5 → L7 → L8 → L9) ou mudança de data de passagem lida como
mudança no chão. É o mesmo risco que o repositório já documentou para série de imagem
mista, e já custou caro lá.

**Mitigação:** colunas de plataforma e data de passagem **obrigatórias** na tabela de
série; marcação explícita do ano em que o sensor troca; ressalva no laudo.

---

### R-07 · Conflito com a refatoração em voo 🟡

**Estrago:** merge conflict e retrabalho.

**Mitigação:** laudo NDVI é módulo novo em `backend/ndvi/`; `report-docx.ts`, `report.ts`
e `report-docx.test.ts` são **território proibido** nesta implementação
([06 §0](06-laudo-docx.md#0-regra-de-convivência)).

---

### R-08 · Volume no HD 🟡

**Estrago:** o HD de 2 TB já hospeda CBERS e Landsat.

**Mitigação:** o recorte acontece **antes** do cálculo — o NDVI arquivado cobre só o
imóvel, não a cena de 180 × 180 km. Um imóvel de 1.000 ha em 30 m dá ~11.000 pixels: o
Float32 fica em dezenas de KB. Risco baixo por construção; vira alto se alguém inverter a
ordem e calcular a cena inteira.

---

### R-09 · Estilo SLD divergindo da rampa do `gdaldem` 🟡

**Estrago:** figura do laudo e camada do WMS com cores diferentes para o mesmo valor —
constrangedor num laudo técnico.

**Mitigação:** teste `style-consistency.test.ts` comparando `.clr` e `.sld`.

---

### R-10 · `POST /rest/styles` é endpoint inédito no repo 🟡

**Estrago:** publicação do estilo falha silenciosamente e a camada renderiza cinza.

**Mitigação:** `ensureNdviStyle()` idempotente com `GET` antes; validação de GetMap
inclui checagem de **PNG não uniforme** e de estilo aplicado
([05 §5.5](05-publicacao-wms.md#55-validação-getmap-png)).

---

### R-11 · URL assinada do Planetary Computer expira 🟢

**Estrago:** job longo perde o acesso no meio.

**Mitigação:** assinar imediatamente antes do uso; reassinar entre bandas; fallback para
o STAC do USGS.

---

### R-12 · Overview com `average` no Float32 🟢

**Estrago:** zoom-out mostra valores que não existem, porque a média mistura nodata
`-9999` com dado válido.

**Mitigação:** `nearest` no Float32, `average` só no RGB
([03 §3.8](03-pipeline-ndvi.md#38-overviews)).

---

## 2. Armadilhas já medidas no repositório

Não são hipóteses — já aconteceram, estão documentadas, e o NDVI passa perto das quatro.

| Armadilha | Onde está registrada | Como afeta o NDVI |
|---|---|---|
| **`TIPOLOGIA_VEGETAL` não é declaração de vegetação nativa** — cobre ~100% de toda AC; somá-la fez 100% dos polígonos saírem com alerta ALTO | `CLAUDE.md`, gotcha 1 | Fica fora da estatística zonal e de tudo que é entregue. Reusar `isExcludedExportEntry` |
| **Teste sintético não valida código geométrico** — bugs passaram pela suíte inteira e só caíram com shapefile real | `CLAUDE.md`, gotcha 2 | Validação com CAR 270069 e CAR 6816 é obrigatória, não opcional |
| **`\b` não casa com `_` em JS** — `\bl7\b` nunca casou em `..._l7_etm_...`, e o ranqueamento premiou justamente a cena riscada | `backend/landsat/naming.ts:22-30` | Detecção de plataforma no NDVI usa lookaround |
| **Seleção por texto de legenda quebra em silêncio** — duas funções viraram no-op e o SPOT 2008 sumiu do anexo | `docs/CHANGELOG_2026-08-21_ANEXO_SPOT_SUMIA.md` | Seleção de figura do laudo NDVI é por **campo estruturado**, nunca por parse de legenda |

---

## 3. Decisões abertas

### D-A · Quais anos por padrão?

O laudo SIMCAR trabalha com janela fixa (2003–2008 para AC/AVN, 2009–2019 para Fase 2).
O NDVI poderia:

1. **Um ano só**, o mais recente com cena boa — mais barato, responde "como está hoje".
2. **Os dois marcos**, 2003 e 2008 — casa com a janela legal.
3. **Série completa** do ano do CAR até hoje — mais caro, mais poder de prova.

**Sugestão:** começar com (1) como padrão e deixar `anos[]` explícito na rota. A série
completa entra na F6.

**Precisa do Álvaro.**

---

### D-B · O NDVI entra no laudo SIMCAR?

Hoje o plano entrega **laudo próprio**, conforme pedido. Mas o `report-theme.ts` vai
ganhar `buildNdviFindings()` — então incorporar um achado de NDVI ao Quadro de Achados do
laudo SIMCAR fica barato.

Vale a pena? Argumento a favor: o NDVI reforça a narrativa de AC × AVN. Contra: mistura
uma medida com incerteza declarada num laudo que hoje é qualitativo, e aumenta a
superfície do laudo principal.

**Sugestão:** não agora. Reavaliar depois de 3 imóveis rodados.

---

### D-C · SAVI, EVI e NDRE

A reunião citou SAVI duas vezes, sempre ao lado do NDVI:

> "o NDVI, SAVI, tem algum script que facilita essa coisa?" (26:55)
> "NDVI, SAVI e por último você mata com o índice espectral" (31:59)

E `banco_de_dados/06_sensoriamento_remoto/indices_vegetacao.md` já descreve os quatro,
com uma observação relevante: **SAVI é melhor que NDVI em vegetação aberta e regeneração
inicial**, que é justamente o caso difícil dos laudos de AC × AVN.

A arquitetura deste plano é genérica: trocar a expressão do `gdal_calc.py` e a rampa
produz SAVI (`((NIR−RED)/(NIR+RED+L))×(1+L)`, L=0,5) sem mexer em mais nada.

**Sugestão:** SAVI como F7, logo depois do NDVI estabilizar. EVI e NDRE só sob demanda
(NDRE exige Red Edge, que o Landsat não tem).

**Precisa do Álvaro.**

---

### D-D · CBERS-4A para estado atual

8 m contra 30 m é uma diferença grande, e as bandas já são baixadas
(`CBERS_REQUIRED_ASSETS` inclui BAND3 e BAND4). Mas é DN sem calibração: comparável
dentro da cena, não entre datas.

**Sugestão:** depois do NDVI Landsat estável, adicionar como produto **rotulado
separadamente** ("NDVI aparente CBERS-4A — não comparável entre datas"), útil só para
delimitar feição em alta resolução. Nunca na mesma tabela de série que o Landsat.

---

### D-E · Publicar o NDVI no WMS público?

O WMS local é exposto por Cloudflare Tunnel em `wms.cursar.space`, e o proxy filtra o que
sai. O grupo `NDVI` deve aparecer publicamente ou ficar só no `127.0.0.1:8081`?

Conteúdo de laudo de cliente tem sensibilidade. **Sugestão:** manter interno até haver
decisão explícita; conferir o filtro de `geoserver_wms_public_proxy.py` antes de publicar.

**Precisa do Álvaro.**

---

### D-F · Retenção

CBERS e Landsat guardam a folha inteira para sempre. O NDVI é recorte por imóvel — muitos
arquivos pequenos, um por job. Vale expirar NDVI de job excluído pelo usuário, ou guardar
sempre?

**Sugestão:** guardar sempre (é barato, ver R-08) e marcar `userDeletedAt`, igual aos
outros dois pipelines. Reavaliar se passar de alguns milhares de entradas.

---

## 4. O que este plano deliberadamente não resolve

- **NDVI não data supressão.** Ele mede vigor num instante. A datação continua sendo da
  Fase 2 e da aba AUAS × SCCON.
- **NDVI não classifica uso do solo.** As faixas de [03 §3.10](03-pipeline-ndvi.md#310-faixas-de-interpretação)
  são descritivas; nenhuma afirma AC, AVN ou AUAS.
- **NDVI não substitui a análise visual.** É o primeiro elo (R10), não o último.
- **Não há integração com GEE.** O método da reunião foi replicado com GDAL local.
- **MapBiomas, PRODES, DETER e TerraClass continuam fora** — citados na reunião, mas
  cada um é integração própria (ver `docs/IMAGENS_E_CAMADAS_LAUDO.md`).
