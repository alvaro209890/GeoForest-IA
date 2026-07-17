# 11 — Endpoints SEMA descobertos (contrato canônico)

> **Fonte:** bundle `tecnico.app/js/bundle.js` (extraído 2026-07-16) + sondas read-only ao vivo
> com a conta técnica (login OK, CAR 270069). Onde diz **validado ao vivo**, a resposta real
> foi capturada. Onde diz **do bundle**, o path/payload vem do código do app técnico e ainda
> precisa de 1 teste live antes de virar produção.
>
> Base: `https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api`
> Headers obrigatórios em tudo: `authorization: TECNICO …` (minúsculo, valor cru) + browser-like
> (User-Agent Chrome, Origin/Referer monitoramento.sema.mt.gov.br) — já implementados em
> `backend/simcar-oraculo/client.ts:9-14`.

## Autenticação e sessão

| Endpoint | Método | Payload / retorno | Status |
|---|---|---|---|
| `Autenticacao/Autenticar` | POST | `{v: scramble(JSON{Login: cpf_só_dígitos, Senha, NovaSenha:""})}` → string `"TECNICO …"` | ✅ validado ao vivo (client.ts:37-58) |

- Sessão **ÚNICA por conta**: cada login derruba a sessão do técnico no navegador. Cache de token 25 min + fila serial minimizam.
- API só responde de **IP brasileiro** (lição do acompanhamento-de-processos: Render/EUA dá `UND_ERR_CONNECT_TIMEOUT`). O backend do PC servidor atende.

## Leitura do requerimento

| Endpoint | Método | Retorno | Status |
|---|---|---|---|
| `Requerimento/Buscar/{id}` | GET | Objeto completo do requerimento (ver campos abaixo) | ✅ validado ao vivo — dump em nota¹ |
| `Requerimento/BuscarStatusProcessamento/{id}` | GET | `{BaseRefStatus, BaseRefDetalhes, ImportacaoShapeStatus, ImportacaoShapeDetalhes, ImportacaoResultado, ProcessamentoStatus, ProcessamentoDetalhes, ProcessamentoResultado, CroquiStatus, CroquiResultado, ARLSubstituirResultado, Arquivos[]}` | ✅ validado ao vivo |
| `Requerimento/ListarRasc` | POST | Aba "Listar". Body do componente genérico `{Filtros:{PROPRIEDADE_NOME?, PARA_PROPRIETARIO:true,…}, paginação}` — corpos genéricos (`{}`, `{Pagina:1}`) dão **400** | ⚠️ opcional; NÃO necessário (endereçamos o CAR-teste por ID) |

**Campos do `Buscar` relevantes ao P2 (validado ao vivo, CAR 270069):**

```jsonc
{
  "Id": 270069,
  "PropriedadeNome": "Santa clara",          // NUNCA alterar (decisão do Álvaro)
  "Municipio": {
    "Id": 751,                                // id interno SIMCAR ("Chave" do ListarMunicipios)
    "Estado": { "Id": 11, "Uf": "MT", "Codigo": "51" },
    "Texto": "Querência",
    "Codigo": "5107065",                      // código IBGE
    "Texto4Query": "QUERENCIA"
  },
  "ZonaLocalizacao": "…", "RoteiroLocalizacao": "…", "Bioma": "…",
  // ÁREA DE ABRANGÊNCIA mora aqui (bbox em graus decimais):
  "MenorLongitudeGdec": …, "MenorLatitudeGdec": …,
  "MaiorLongitudeGdec": …, "MaiorLatitudeGdec": …,
  "Situacao": "[EM_CADASTRAMENTO]",
  "SituacaoPropriedade": "…", "SituacaoCaracterizacao": "…",
  "SituacaoImportarGeo": "…", "SituacaoProcessamentoGeo": "…",
  "Arquivos": [ { "Id", "Descricao": "[PDF_RELATORIO_IMPORTACAO]|[PDF_RELATORIO_PROCESSAMENTO]|[ARQUIVO_CONFERENCIA]|[ARQUIVO_ENVIADO]", "Arquivo": {"Id","Nome","Situacao"}|null, "Categoria": "[REQUERIMENTO_CARACTERIZACAO]" } ]
}
```

¹ Dump completo (não commitado): sondas salvas no scratchpad da sessão de 2026-07-16; para regerar:
`SIMCAR_CPF=… SIMCAR_SENHA=… npx tsx backend/simcar-oraculo/scripts/smoke-buscar.ts 270069`.

## Municípios

| Endpoint | Método | Retorno | Status |
|---|---|---|---|
| `Municipio/ListarEstados` | GET | lista de estados (MT = `Estado.Id` **11**) | do bundle |
| `Municipio/ListarMunicipios/{estadoId}` | GET | `[{Chave, Texto}]` — 142 itens p/ `11`; `Chave` = `Municipio.Id` interno (Querência=751) | ✅ validado ao vivo |
| `Municipio/ListarMatoGrosso` | GET | idem (atalho MT) | ✅ validado ao vivo |
| `Municipio/BuscarMunicipioGeo/{codigoIBGE}` | GET | `{Id, Chave:"5107065", Nome:"QUERÊNCIA", GeoJson: "<Polygon stringificado>"}` — polígono oficial do município | ✅ validado ao vivo |

Revalidação T4 (2026-07-16): `ListarMatoGrosso` retornou **142** itens; o casamento por nome
normalizado com a malha IBGE 2024 resolveu Querência como `{Chave:751, ibge:"5107065"}`.
Fallback geográfico WFS validado na camada `Geoportal:LIM_MUNICIPIOS_MT`, filtro
`INTERSECTS(SHAPE,POINT(lon lat))`, retornando `MUNICIPIO=QUERÊNCIA` e `COD_IBGE=5107065`
para o centroid do fixture Santa Clara.

⚠️ `Chave` (id interno) ≠ código IBGE. `BuscarMunicipioGeo` aceita o **código IBGE** (`Municipio.Codigo`), não a Chave.

## Escrita (P2) — validada live no CAR-teste em T5

| Endpoint | Método | Payload (do código do app) |
|---|---|---|
| `Requerimento/SalvarGrupoPropriedade` | POST | Objeto do requerimento (estado do form da aba Propriedade). Campos do form: `PropriedadeNome` (**não mexer**), `PropriedadeAtividades[]`, `Municipio` (objeto), `ZonaLocalizacao`, endereço etc. Estratégia: `Buscar` → trocar só `Municipio` → POST de volta |
| `Requerimento/SalvarGrupoCaracterizacao` | POST | Objeto do requerimento (aba Caracterização) — mesmo padrão `Requerimento/{acao}` do dispatcher `[CARACTERIZACAO]` |
| `Requerimento/SalvarAreaAbrangencia` | POST | `{Id, MenorLatitudeGdec, MenorLongitudeGdec, MaiorLatitudeGdec, MaiorLongitudeGdec}` (retângulo; front usa south/west/north/east do mapa) |
| `Requerimento/LimparAreaAbrangencia/{id}` | POST | sem body. **DESTRUTIVO**: modal do app avisa "Todas as geometrias do seu projeto serão descartadas e esta ação não poderá ser desfeita!" |
| `Requerimento/ReprocessarBaseRef/{id}` | POST | sem body — regera base de referência |
| `Requerimento/CancelarProcessamentoBaseRef/{id}` | POST | sem body |

### Evidência live T5 — 2026-07-16

Probe reproduzível: `SIMCAR_LIVE=1 npx tsx
backend/simcar-oraculo/scripts/probe-escrita.ts` (credenciais somente via env gitignored).

- `SalvarGrupoPropriedade`: contrato seguro aceito = **objeto inteiro retornado por `Buscar`**,
  alterando somente `Municipio`. Querência `{Id:751,Codigo:"5107065"}` → Canarana
  `{Id:703,Codigo:"5102702"}` → Querência. Cada POST foi confirmado por re-`Buscar`.
  `PropriedadeNome` permaneceu byte a byte `"Santa clara"`. Subset mínimo não é suportado
  pelo nosso cliente: por segurança, a produção sempre envia o snapshot inteiro preservado.
- `SalvarAreaAbrangencia`: aceitou sobrescrever diretamente o retângulo existente com
  ±0,01°; re-`Buscar` confirmou as quatro coordenadas em **4.883 ms**. Não exigiu nem chamou
  `LimparAreaAbrangencia` (`precisouLimpar:false`).
- `BaseRefStatus`: permaneceu `null` em três polls por ~11 s tanto após mudar quanto após
  restaurar; assim, neste estado do CAR, salvar abrangência não iniciou BaseRef observável.
  O pipeline deve aceitar `null` estável como concluído, além de aguardar `[CONCLUIDO]` quando
  a SEMA efetivamente iniciar o processamento.
- Restauração: bbox original confirmado em **1.817 ms**; estado final Querência/5107065,
  `PropriedadeNome="Santa clara"`, bbox original. Nenhum ZIP precisou ser reimportado.

**Sequência observada no app** após `SalvarAreaAbrangencia`: o front chama `Buscar` e inicia
timer de status — a abrangência dispara processamento de **BaseRef** no servidor
(`BaseRefStatus` em `BuscarStatusProcessamento`). O import de shape só deve ser disparado com
BaseRef concluída (`existeBaseRefEmProcessamento` bloqueia a tela no app oficial).

**Estados de processamento** (enum do bundle): `[AGUARDANDO]`, `[EXECUTANDO]`, `[ERRO]`,
`[CONCLUIDO]`; resultados: `[FINALIZADO]`, `[COM_PENDENCIA]`, `[EM_ABERTO]`.

## Import / Processamento

| Endpoint | Método | Payload | Status |
|---|---|---|---|
| `Arquivo/Upload/` (barra final!) | POST multipart | campo único `file` (Blob application/zip). Retorno = objeto arquivo (se array, `[0]`) | ✅ validado ao vivo (client.ts:139-156) |
| `Requerimento/ImportarArquivoShape` | POST | `{RequerimentoId: Number(carId), Arquivo: <objeto do upload>}` — **substitui o shape do CAR imediatamente** | ✅ validado ao vivo (import-shape.ts:50-53) |
| `Requerimento/CancelarImportacaoShape/{id}` | POST | sem body | do bundle |
| `Requerimento/ProcessarGeo/{id}` | POST | sem body | ✅ validado ao vivo (process-geo.ts:41) |
| `Requerimento/CancelarProcessamentoGeo/{id}` | POST | sem body | do bundle |

Poll: `BuscarStatusProcessamento` a cada `SIMCAR_POLL_MS` (5 s). Import ~2 min; process ~6 min (Santa Clara).

## Downloads (binários; client.ts:112-137 já cobre com fallback form-urlencoded)

| Endpoint | Conteúdo |
|---|---|
| `Requerimento/DownloadPdfImportacaoShapefile/{id}` | PDF do relatório de importação (o que o usuário baixa quando reprova) ✅ live |
| `Requerimento/DownloadPdfRelatorioProcessamento/{id}` | PDF do relatório de processamento ✅ live |
| `Requerimento/DownloadArquivoErrosProcessamento/{id}` | ZIP shapefile de erros do processamento (400 se não existir) ✅ live |
| `Requerimento/DownloadArquivoEnviado/{id}` | ZIP enviado atual do CAR — ✅ live T9: 641.273 bytes, ZIP, SHA `33bd2573…d199` |
| `Requerimento/DownloadArquivoProcessado/{id}` | ZIP processado (com APP/ARL derivadas) — ✅ endpoint live T9; 400 = ausente no estado atual |
| `Requerimento/DownloadArquivoConferencia/{id}` | arquivo de conferência — ✅ live T9: 811.556 bytes, ZIP, SHA `c9d41599…c55d` |
| `Requerimento/DownloadArquivoPendencias/{id}` | pendências — ✅ endpoint live T9; 400 = ausente no estado atual |
| `Requerimento/DownloadArquivoAreaAbrangencia/{id}` | shape da área de abrangência (do bundle) |
| `Requerimento/DownloadArquivoModelo?requerimentoId={id}` | ZIP modelo da SEMA (do bundle) |

Probe T9: `scripts/probe-downloads.ts`, guard `SIMCAR_LIVE=1` + `assertTestCarId(270069)`,
somente leitura. PDFs de import/process também responderam; erros de processamento retornou
400 no estado corrente. O pipeline tenta cada artefato apenas depois da etapa que o gera, para
não capturar saída antiga do CAR compartilhado.

## Pendências opcionais / decisões fechadas

- [x] Contrato de propriedade adotado/validado: snapshot inteiro do `Buscar`; subset não será
      usado para não apagar campos omitidos.
- [x] Abrangência existente aceita sobrescrita direta; `Limpar` não é necessário no fluxo normal.
- [x] BaseRef no probe ficou `null` estável; implementação aceita `null` ou aguarda
      `[CONCLUIDO]`, timeout de 20 min quando houver estado ativo.
- [x] `SalvarGrupoCaracterizacao` não é necessário: o endpoint específico de abrangência
      alterou e restaurou as coordenadas sozinho.
- [ ] Body real do `ListarRasc` (opcional — só se um dia quisermos descobrir o CAR-teste dinamicamente).
