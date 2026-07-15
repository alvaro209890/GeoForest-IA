# Aba "Processar projeto" — fluxo Projeto Geográfico (estilo SIMCAR)

Sub-aba da **Análise de Erros** do GeoForest que espelha o fluxo oficial do
**Importador GEO / Projeto Geográfico do SIMCAR** em dois passos:

1. **Importar** — conformidade estrutural do ZIP  
2. **Processar** — topologia + Anexo 01 + soma AIR×ATP  

Motor **local** (mesmo backend do recorte SIMCAR neste PC / host com Cloudflare
Tunnel). **Não** substitui o validador oficial da SEMA-MT.

## Onde fica na UI

**Análise de Erros** → 4ª sub-aba **Processar projeto** (ao lado de Vértices
Próximas, Áreas Não Contidas e Erros de Geometria).

## Relação com "Erros de Geometria"

| | Erros de Geometria | Processar projeto |
|--|--------------------|-------------------|
| UX | Checks opcionais por camada | Fluxo fixo Importar → Processar (ZIP inteiro) |
| Motor | Mesmas funções `detect*` / `checkSimcarConformity` | Orquestra as mesmas funções em 2 fases |
| Saída | ZIP de erros | ZIP com relatórios de importação + processamento |

Use **Erros de Geometria** para análises pontuais; use **Processar projeto**
quando quiser o fluxo completo no espírito do SIMCAR.

## Fases

### 1. Importar (`POST /api/processar-projeto/importar`)

Equivalente conceitual a `[CAR_IMPORTAR_SHAPEFILE]`:

- Inventário de camadas + reconhecimento de nomenclatura SIMCAR  
- `checkSimcarConformity`: CRS (EPSG:4674), 2D, primitiva, ATP única, atributos  

Artefatos: `relatorio_importacao.txt` (no ZIP final) e tabela na UI.

### 2. Processar (`POST /api/processar-projeto/processar`)

Equivalente conceitual a `[CAR_PROCESSAR_GEOMETRIAS]`:

- Auto-interseção, vértices duplicados, sobreposição, vazios/gaps  
- Contenção e sobreposições proibidas do Anexo 01  
- Soma das AIRs vs ATP  

Job assíncrono com SSE; download do ZIP ao concluir.

## API

```
POST   /api/processar-projeto/upload
POST   /api/processar-projeto/importar
POST   /api/processar-projeto/processar   → 202 { jobId }
GET    /api/processar-projeto/jobs/:id/status
GET    /api/processar-projeto/jobs/:id/events
GET    /api/processar-projeto/download/:id
DELETE /api/processar-projeto/jobs/:id
```

## ZIP de resultado (estilo SIMCAR)

| Artefato | Equivalente SIMCAR | Conteúdo |
|----------|--------------------|----------|
| `arquivo_processado.zip` + pasta `arquivo_processado/` | `[ARQUIVO_PROCESSADO]` | Todas as camadas com geometria limpa (vértices duplicados removidos, auto-interseção unkink) |
| `arquivo_enviado.zip` + pasta `arquivo_enviado/` | `[ARQUIVO_ENVIADO]` | Cópia dos shapefiles originais do ZIP |
| `arquivo_conferencia.zip` + pasta `arquivo_conferencia/` | `[ARQUIVO_CONFERENCIA]` | Camadas processadas com `area_m2` / `area_ha` |
| `erros_processamento.zip` + pasta `erros/` | `[ARQUIVO_ERROS_PROCESSAMENTO]` | `pontos_erros`, sobreposições, vazios, regras Anexo 01 |
| `relatorio_importacao.txt` | PDF importação | Fase Importar (texto) |
| `relatorio_processamento.txt` | PDF processamento | Fase Processar (texto) |
| `resumo_erros.csv` | — | Tabela unificada de erros |
| `quadro_areas.csv` | quadro de áreas | Área / feições / erros por camada |
| `inventario_saidas.txt` | — | Índice do que veio no ZIP |
| `pontos_erros.shp` (raiz) | pontos de erro | Atalho na raiz do ZIP |

O **arquivo processado é sempre gerado**, mesmo quando não há erros (geometria apenas sanitizada).

## Backend / deploy

O backend roda no **mesmo host físico do recorte SIMCAR** (não Render). Após
`git pull`, reinicie o processo Node; o front no Firebase Hosting continua
apontando para o backend via **Cloudflare Tunnel**.

## Arquitetura

- `backend/processar-projeto.ts` — rotas + `runImportPhase` / `runProcessPhase`
- `client/src/components/ProcessarProjetoAnalysis.tsx` — UI
- Reuso: `geometry-errors.ts`, `simcar-rules.ts`, `vertices-proximas.ts`

## Testes

```bash
npx vitest run --root . backend/processar-projeto.test.ts
```

## Calibração com API SEMA (opcional)

Ver `tools/simcar-parity/README.md`. Credenciais **nunca** vão para o repositório;
use variáveis de ambiente locais (`SIMCAR_LOGIN`, `SIMCAR_SENHA`,
`SIMCAR_REQUERIMENTO_ID`) apenas no PC de desenvolvimento.

## Limites de paridade

- Sem cálculo completo de APP/buffers oficiais  
- Sem bases externas (TI, UC, embargo, CAR aprovado)  
- Tolerâncias e casos limítrofes podem divergir do `tecnico.api` v1.57.x  
- Posicione a ferramenta como **pré-validação**
