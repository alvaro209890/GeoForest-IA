# Validação da aba "Análise de vetorização" (modo `vectorized-analysis`)

**Data:** 2026-08-21
**Motivo:** a aba não era tocada há meses e **não tinha um único teste**.
**Escopo auditado:** `POST /api/simcar/clip/import-vectorized`,
`parseCachedContextFromOutputZip`, encadeamento AC/AVN → AUAS, persistência do
card, geração do laudo e restauração após F5.

## O que a aba faz

Recebe o ZIP do modelo SIMCAR **já vetorizado** e roda a mesma análise de IA do
pós-recorte, sem consulta WFS. O imóvel é reconstruído a partir do ATP/AIR do
próprio ZIP. Depois do import, o cliente encadeia sozinho AC/AVN → AUAS e
consolida um laudo único.

## Veredito: a aba está funcional

Rodei o pipeline contra o **ZIP real versionado** (`backend/fixtures/teste_1/
Recorte_SANTA_CLARA_FINAL_16-07-26.zip`, CAR da Santa Clara, 906 KB). O parser
reconstrói o imóvel corretamente:

| Item | Resultado |
|---|---|
| Camada de propriedade | `ATP` (1 feição, 38.037,30 ha) |
| Parse | 137 ms |
| Camadas com dados | 13 de 28 |
| AC / AVN / AUAS | 33 / 238 / 38 feições — todas com geometria disponível |
| bbox | coerente com MT |
| Warnings | nenhum |

**Persistência: confirmada.** A aba grava no mesmo documento do recorte
(`users/<uid>/simcar_clips/<jobId>`), com o mesmo contrato de merge. Testei o
ciclo inteiro (import → AC/AVN → AUAS → laudo) verificando que **cada etapa
acrescenta sem apagar a anterior**. Todos os campos que o card precisa para
reabrir depois do F5 estão lá.

## Duas hipóteses que investiguei e descartei

Registro porque parecem bug e voltarão a chamar atenção:

1. **AVN e ARL com áreas idênticas (62.578,16 ha cada).** Não é o parser lendo o
   mesmo arquivo duas vezes — são arquivos distintos com o mesmo tamanho. Neste
   CAR a ARL foi declarada coincidente com a AVN, o que é comum.

2. **Área da AVN maior que a do imóvel (62.578 ha em 38.037 ha).** Suspeitei do
   tratamento de multipart: o parser monta `turfPolygon(rings)` tratando
   `rings[1..n]` como buraco, e se fossem ilhas separadas a área sairia errada.
   Medi ring a ring pela orientação (horário = anel externo, anti-horário =
   buraco) nas 24 feições multipart: **delta de 0,00 ha**. São buracos de
   verdade. O excesso é sobreposição entre polígonos no dado de origem, e o modo
   recorte soma exatamente do mesmo jeito (`clip-pipeline.ts` acumula
   `turfArea` por feição, sem união). Não é divergência entre as abas.

## Dois defeitos reais corrigidos

### 1. Laudo antigo ficava órfão no storage a cada regeração 🔴

`generateAndPersistSimcarReport` sobe um arquivo novo a cada chamada (o nome
carrega `Date.now()`) e grava a URL nova no card. A URL antiga era simplesmente
substituída — **o arquivo anterior ficava no storage para sempre**, e o `DELETE`
do card só apaga a última URL conhecida.

Isso vale para as duas abas, mas dói mais na vetorizada: ela gera o laudo
**duas vezes por rodada** (uma ao fim do AC/AVN, outra ao fim do AUAS), então
cada análise deixava um par PDF+DOCX órfão. Com o DOCX novo, o lixo dobrou.

Corrigido em `report.ts` com `discardSupersededReportFiles`: antes de persistir o
laudo novo, apaga o PDF/DOCX anterior do mesmo job — só dentro de
`users/<uid>/`, e falhar em apagar não derruba a entrega do laudo novo.

**A dupla geração foi mantida de propósito.** Se o AUAS falhar, o laudo parcial
do AC/AVN é o único artefato que sobra para o usuário. O custo agora é só CPU,
não lixo em disco.

### 2. O laudo não dizia de onde vieram os vetores 🟠

`sourceMode` chegava aos dois renderizadores e era **ignorado** — parâmetro
morto. O laudo do modo vetorizado saía idêntico ao do recorte.

Isso importa porque muda o significado do resultado:

| Modo | Origem dos polígonos | O que "AC fora do shape" significa |
|---|---|---|
| `auto-clip` | WFS da SEMA-MT | divergência contra o **cadastro publicado** |
| `vectorized-analysis` | ZIP que o RT enviou | erro na **vetorização em revisão**, ainda não submetida |

Um laudo que não distingue os dois convida a ler erro de desenho como
divergência cadastral. Agora `vectorSourceNote` (`report-theme.ts`) imprime a
origem num box acima dos Quantitativos, nos dois formatos.

## O que ficou como está, e por quê

- **`status: "completed"` gravado já no import.** A rota marca o card como
  concluído antes de a análise rodar; o cliente compensa com
  `isVectorized && status === 'completed' && !hasVectorizedFinalReport` para
  saber que ainda falta processar. Funciona, mas o nome do estado mente. Trocar
  mexe na retomada de card interrompido — vale um passo próprio.

- **Após F5, o card vetorizado mostra as mensagens de AC/AVN.** Durante a
  execução ao vivo a aba as esconde (`setSimcarAnalysisMessages([])`), porque o
  laudo unificado já as contém. Na restauração elas voltam. É inconsistência de
  apresentação, não perda de dado — e mostrar a mais é o lado seguro.

- **`TIPOLOGIA_VEGETAL` dentro do ZIP importado.** O ZIP da Santa Clara traz a
  camada com 88 feições. O laudo (PDF e DOCX) **não a exibe**, pelo filtro
  `EXPORT_EXCLUDED_LAYERS`. Mas o ZIP que a aba devolve para download é cópia
  literal do que o usuário enviou — não removo camada de arquivo que não é
  nosso. Se a preferência for devolver o ZIP já limpo, é decisão do Álvaro.

## Testes criados

A aba saiu de **zero** para **16 testes**:

- `backend/simcar/vectorized-import.test.ts` — **9 testes** contra o ZIP real:
  reconstrução do imóvel pelo ATP, bbox coerente com MT, camadas que a análise
  consome, classificação property × wfs, shapefile vazio do modelo sem virar
  erro, teto de tempo do parse, laudo sem tipologia, paridade de blocos com o
  modo recorte, e ZIP inválido rejeitado.
- `backend/simcar/vectorized-persistence.test.ts` — **7 testes** do ciclo de
  vida do card: cada etapa acrescenta sem apagar a anterior, o card restaurado
  tem os 12 campos necessários, e não vaza para outro `uid`.
- `report-theme.test.ts` — **+4** para `vectorSourceNote`.

Suíte completa: **759 passed / 8 skipped, 0 falhas**. `tsc --noEmit` e
`pnpm run build` verdes.

Conferência visual do laudo no modo vetorizado:

```bash
npx tsx scripts/preview-laudo-pdf.ts /tmp/laudo.pdf --fase=acavn --docx --vetorizado
```
