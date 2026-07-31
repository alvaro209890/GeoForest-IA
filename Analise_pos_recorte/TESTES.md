# Plano de testes e aceite — AUAS pré-2008 V2

## 1. Estratégia

Os testes devem seguir a configuração atual do projeto:

- Vitest workspace;
- unitários/backend em `backend/**/*.test.ts`;
- rede sempre injetada ou mockada;
- testes live desabilitados por padrão;
- nenhuma fixture contém chave, authkey ou URL assinada.

Pirâmide:

1. funções puras e schemas;
2. clientes HTTP com fetch injetável;
3. orquestrador com relógio e clientes falsos;
4. contrato SSE/persistência/PDF;
5. frontend;
6. live WMS/Groq/DeepSeek;
7. E2E no fluxo completo;
8. conjunto dourado revisado por humano.

## 2. Arquivos de teste planejados

```text
backend/analise-pos-recorte/
  auas-polygons.test.ts
  schemas.test.ts
  evidence-reducer.test.ts
  wms-scenes.test.ts
  image-quality.test.ts
  groq-vision-client.test.ts
  groq-vision-client-live.test.ts
  deepseek-text-client.test.ts
  deepseek-text-client-live.test.ts
  report-builder.test.ts
  orchestrator.test.ts
  route-contract.test.ts
  resume.test.ts
  fixtures/
    golden-manifest.json
    geometries/
    responses/

client/src/.../
  AuasPre2008Summary.test.tsx
  simcarAuasV2Contract.test.ts
```

## 3. Unitários obrigatórios

### 3.1 Polígonos

- lê somente a chave literal `AUAS`;
- retorna vazio quando a camada não existe;
- preserva Polygon com buraco;
- preserva MultiPolygon disjunto;
- rejeita geometria não poligonal;
- calcula área e bbox;
- gera IDs determinísticos;
- gera o mesmo hash para GeoJSON canônico equivalente;
- gera hash diferente quando a geometria muda;
- não une dois polígonos.

### 3.2 Schemas

- aceita exemplo completo válido;
- rejeita enum inventado;
- rejeita `polygonId`, `sceneId` e `windowId` não solicitados;
- rejeita ano fora de 2003–2008;
- rejeita transição invertida;
- rejeita mais de três cenas;
- limita tamanho de evidence/limitations;
- rejeita campos jurídicos na observação visual;
- transforma qualquer segunda falha de parse em resultado inconclusivo.

### 3.3 Redutor

Casos mínimos:

| Evidência | Resultado |
|---|---|
| antropizado já em 2003 | `ALERTA_PRE_2008` |
| transição 2003→2004 | `ALERTA_PRE_2008` |
| transição 2006→2007 | `ALERTA_PRE_2008` |
| apenas transição 2007→SPOT 2008 | `INCONCLUSIVO_NO_MARCO_2008` |
| vegetação observável em toda a série | `SEM_EVIDENCIA_PRE_2008` |
| uma cena obrigatória ausente | `INCONCLUSIVO` |
| conflito W2003_2005 × W2005_2007 | `INCONCLUSIVO` |
| todas as cenas ocluídas | `INCONCLUSIVO` |
| um polígono alerta em dez | agregado `ALERTA_PRE_2008` |
| nenhum alerta e um inconclusivo | agregado `INCONCLUSIVO` |
| todos conclusivos e sem alerta | agregado `SEM_EVIDENCIA_PRE_2008` |

As mensagens devem falar em intervalo e nunca promover `toYear` a data exata.

### 3.4 WMS e imagem

- monta WMS 1.1.1 com EPSG:4326 e bbox na ordem correta;
- usa as seis camadas esperadas;
- aplica override/alias por env;
- não inclui `authkey` em log, metadado persistido ou erro;
- mantém bbox/dimensões iguais na série;
- aplica overlay do polígono correto;
- reconhece PNG/JPEG válido;
- rejeita HTML/XML de erro com HTTP 200;
- retry em timeout/5xx;
- não repete 4xx não transitório;
- classifica imagem uniforme/sem dados;
- calcula checksum reprodutível;
- falha fechada quando falta uma cena.

## 4. Cliente Groq Vision

Com `fetchImpl` falso:

- usa exatamente `qwen/qwen3.6-27b`;
- envia `reasoning_effort: "none"`;
- nunca envia mais de 3 `image_url`;
- rejeita localmente uma quarta imagem sem fazer fetch;
- envia somente imagens da janela/polígono;
- valida JSON antes de retornar;
- faz uma repetição em JSON inválido;
- não entra em loop depois da segunda falha;
- trata timeout;
- trata 400 por payload;
- trata 401 sem vazar chave;
- trata 429 por `retry-after`;
- trata `x-ratelimit-reset-tokens`;
- serializa duas chamadas que excederiam tokens;
- usa relógio fake para provar o tempo de espera;
- checkpoint evita repetição;
- cancelamento interrompe antes da próxima chamada;
- log não contém base64, URL assinada, authkey ou bearer token.

## 5. Cliente DeepSeek

- usa `deepseek-v4-pro` por padrão;
- request contém somente texto;
- não existe `image_url` no payload;
- recebe apenas objeto sanitizado;
- timeout e retry finito;
- valida referências de `polygonId`;
- rejeita área/status/intervalo inventado;
- rejeita conclusão jurídica;
- não persiste `reasoning_content`;
- fallback determinístico preserva todos os status;
- Groq textual nunca é acionada como fallback.

## 6. Orquestrador e retomada

- zero AUAS termina sem cobrar IA e informa ausência da camada;
- um AUAS cria 3 janelas;
- N AUAS cria `3 × N` janelas, sem truncar;
- uma janela falha e apenas o polígono correspondente vira inconclusivo;
- 429 não perde progresso anterior;
- queda depois de W1 retoma em W2;
- mudança no hash da imagem invalida só a janela afetada;
- mudança de `rulesVersion` invalida o checkpoint;
- cancelamento persiste `CANCELLED`;
- `complete` ocorre somente depois de persistência e PDF;
- erro de PDF emite `report_error`, preservando o resultado;
- ETA e percentual são monotônicos;
- billing/usage corresponde às chamadas realmente feitas.

## 7. Contrato SSE, persistência e compatibilidade

- parser lida com chunks quebrados no meio de `data:`;
- heartbeat não vira evento;
- todos os eventos são JSON válido;
- `complete.auasMeta.schemaVersion === 2`;
- card V2 é salvo uma vez sem corrida entre backend e frontend;
- reabrir o card recupera todos os polígonos;
- card V1 antigo continua renderizando;
- o PDF V2 usa `pre2008Status/pre2008Alert`;
- o PDF não exibe “passivo pós-2008” para V2;
- o PDF lista limitações e fonte/ano;
- falha de DeepSeek ainda gera PDF determinístico;
- nenhum dado interno bruto da Groq aparece no cliente.

## 8. Frontend

- badge vermelho/âmbar para `ALERTA_PRE_2008`;
- badge neutro para `SEM_EVIDENCIA_PRE_2008`;
- badge âmbar para os dois tipos inconclusivos;
- lista por polígono com área, intervalo, confiança e evidência;
- “já visível em 2003” não aparece como “desmate em 2003”;
- mudança 2007→2008 mostra a limitação do marco;
- fonte ausente fica visível;
- progresso mostra polígono, janela e ETA;
- dezenas de polígonos não travam a tela;
- acessibilidade: status não depende só de cor.

## 9. Testes live

Todos usam `it.skipIf`/`describe.skipIf`, timeout explícito e flags:

```dotenv
SEMA_WMS_LIVE=1
GROQ_VISION_LIVE=1
DEEPSEEK_LIVE=1
```

### 9.1 WMS live

- GetCapabilities contém as seis camadas;
- GetMap retorna imagem real para um bbox de teste;
- dimensão e content type são válidos;
- resposta não é imagem uniforme;
- camada ausente resulta em diagnóstico útil.

### 9.2 Groq live

- uma imagem real produz JSON válido;
- três imagens reais produzem JSON válido;
- `reasoning_effort: none` não retorna `<think>`;
- uma tentativa local com 4 imagens é bloqueada antes da API;
- usage e rate-limit headers são capturados;
- o teste não imprime a chave nem payload base64.

O teste live não deve deliberadamente provocar 429 em toda execução.

### 9.3 DeepSeek live

- gera relatório válido a partir de um resultado sintético;
- preserva status, intervalo e área;
- não afirma que recebeu/viu imagens;
- não inventa polígono;
- não emite conclusão jurídica.

## 10. Conjunto dourado

Manifesto mínimo de 12 polígonos, revisado por responsável técnico:

- 3 com alerta pré-2008 claro;
- 3 sem evidência pré-2008;
- 2 com mudança apenas 2007→SPOT 2008;
- 2 ocluídos/baixa resolução;
- 1 MultiPolygon;
- 1 polígono pequeno no limite de observabilidade.

Cada item guarda:

- geometry hash;
- image hashes;
- fonte/ano;
- status humano esperado;
- intervalo permitido;
- limitações;
- data e responsável pela revisão.

Critérios iniciais de aceite:

- 100% das fontes/IDs reportados correspondem ao input;
- zero falso “pré-2008” nos casos 2007→SPOT 2008;
- zero ano exato inventado;
- zero conclusão jurídica;
- todos os casos tecnicamente ilegíveis ficam inconclusivos;
- pelo menos 90% de concordância de status nos casos conclusivos;
- 100% de concordância do redutor dado o mesmo JSON validado.

Discordâncias da visão são registradas; não se altera o gabarito para fazer o
teste passar sem nova revisão humana.

## 11. Comandos de validação previstos

```bash
pnpm run check
pnpm exec vitest run --project backend backend/analise-pos-recorte
pnpm exec vitest run --project client
pnpm test

SEMA_WMS_LIVE=1 pnpm exec vitest run backend/analise-pos-recorte/wms-scenes-live.test.ts
GROQ_VISION_LIVE=1 pnpm exec vitest run backend/analise-pos-recorte/groq-vision-client-live.test.ts
DEEPSEEK_LIVE=1 pnpm exec vitest run backend/analise-pos-recorte/deepseek-text-client-live.test.ts
```

Os comandos live exigem env local e nunca entram como requisito da CI comum.

## 12. Gate de produção

Só habilitar `SIMCAR_AUAS_V2_ENABLED=true` depois de:

- unitários e integração verdes;
- build e typecheck verdes;
- conjunto dourado aprovado;
- uma execução E2E completa com múltiplos polígonos;
- retomada testada após interrupção;
- PDF e card reaberto validados;
- limite/ETA apresentados ao usuário;
- observabilidade de 429, latência e tokens ativa;
- chave Groq anteriormente exposta revogada e substituída no ambiente;
- rollback por feature flag ensaiado.

