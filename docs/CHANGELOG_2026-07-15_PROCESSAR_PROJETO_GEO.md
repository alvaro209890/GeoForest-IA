# Changelog — Processar projeto (fluxo completo SIMCAR / ProcessarGeo)

**Data:** 2026-07-15  
**Branch:** `main`  
**Commits principais:**
- `746448ae` — sub-aba Processar projeto (Importar + Processar)
- `e5def92d` — pacotes arquivo processado / enviado / conferência / erros
- `e002aa24` — ProcessarGeo com APP / APPP / APPD / APPRL / AURD / ARLDR

## Resumo

A aba **Análise de Erros → Processar projeto** recria o fluxo oficial do
**Importador GEO / Projeto Geográfico do SIMCAR** (SEMA-MT):

1. **Importar** shapefile (conformidade estrutural)
2. **Processar** (`ProcessarGeo` local): topologia + Anexo 01 + **camadas derivadas APP*** + ZIP completo

O backend roda no **mesmo host físico do recorte SIMCAR** (Cloudflare Tunnel →
Firebase Hosting). Não usa Render.

## O que entrou por fase

### 1. Sub-aba e API em 2 etapas

- UI: `client/src/components/ProcessarProjetoAnalysis.tsx`
- Wiring: 4ª aba em `Dashboard.tsx` (`errorAnalysisTab === 'processar-projeto'`)
- API:
  - `POST /api/processar-projeto/upload`
  - `POST /api/processar-projeto/importar`
  - `POST /api/processar-projeto/processar` (job SSE)
  - `GET  /api/processar-projeto/jobs/:id/status|events`
  - `GET  /api/processar-projeto/download/:id`
  - `DELETE /api/processar-projeto/jobs/:id`

### 2. Pacotes de saída estilo SIMCAR

| Artefato | Equivalente SIMCAR |
|----------|-------------------|
| `arquivo_processado.zip` | `[ARQUIVO_PROCESSADO]` |
| `arquivo_enviado.zip` | `[ARQUIVO_ENVIADO]` |
| `arquivo_conferencia.zip` | `[ARQUIVO_CONFERENCIA]` |
| `erros_processamento.zip` | `[ARQUIVO_ERROS_PROCESSAMENTO]` |
| `erros_processamento_app.zip` | `[ARQUIVO_ERROS_PROCESSAMENTO_APP]` |
| `relatorio_importacao.txt` | PDF importação (texto) |
| `relatorio_processamento.txt` | PDF processamento (texto) |
| `quadro_areas.csv` | quadro de áreas |
| Pastas espelhadas | uso direto no SIG |

### 3. ProcessarGeo — camadas derivadas

Módulo: `backend/simcar-processar-geo.ts`

| Código | Fórmula |
|--------|---------|
| APP | buffers hidrografia (Código Florestal) ∩ AIR/ATP |
| APPP | APP ∩ AVN |
| APPD | APP − APPP |
| APPRL | APP ∩ ARL |
| AURD | (declividade ∪ pantaneira) ∩ AUAS |
| ARLDR | ARL ∩ AUAS |

Buffers (m): rio &lt;10 → 30; 10–50 → 50; 50–200 → 100; 200–600 → 200; &gt;600 → 500;  
nascente/vereda → 50; lagoa → 50; reservatório → 30.

Aliases de nomenclatura do modelo clip (`RIO_ATE_10`, `RIO_10_A_50`, …) em
`backend/simcar-rules.ts`.

### 4. Validações já reutilizadas

De `geometry-errors.ts` / `simcar-rules.ts`:

- conformidade (CRS, 2D, nomes, atributos, ATP única)
- borda se cruza, vértices, gaps, overlaps
- contenção e sobreposições proibidas Anexo 01
- soma AIR vs ATP

## Arquivos

| Caminho | Função |
|---------|--------|
| `backend/processar-projeto.ts` | Orquestração + rotas + ZIP |
| `backend/simcar-processar-geo.ts` | Motor APP* / ProcessarGeo |
| `backend/simcar-rules.ts` | Nomenclatura + conformidade + Anexo 01 |
| `backend/geometry-errors.ts` | Topologia e regras de área |
| `client/src/components/ProcessarProjetoAnalysis.tsx` | UI |
| `client/src/pages/Dashboard.tsx` | Sub-aba |
| `docs/PROCESSAR_PROJETO_SIMCAR.md` | Manual da feature |
| `tools/simcar-parity/` | Calibração opcional com API SEMA |

## Testes

```bash
npx vitest run --root . \
  backend/simcar-processar-geo.test.ts \
  backend/processar-projeto.test.ts \
  backend/simcar-rules.test.ts \
  backend/geometry-errors.test.ts
```

## Deploy (PC backend)

```bash
cd /caminho/GeoForest-IA
git pull origin main
# reiniciar o processo Node do backend
```

Front no Firebase Hosting: rebuild/deploy se a UI ainda não estiver na versão
que contém a sub-aba.

## Limites documentados

- APPP/APPD/AURD/ARLDR são aproximações (sem módulo fiscal / consolidada 2008 completa)
- Lagoa &gt; 20 ha deveria usar 100 m — usa 50 m padrão
- Sem croqui PDF nem CAR federal
- Bases externas (TI, UC, embargo) não integradas

## Documentação relacionada

- [`docs/PROCESSAR_PROJETO_SIMCAR.md`](PROCESSAR_PROJETO_SIMCAR.md) — manual
- [`docs/ERROS_GEOMETRIA_SIMCAR.md`](ERROS_GEOMETRIA_SIMCAR.md) — checks avulsos (aba irmã)
- [`docs/CHANGELOG_2026-07-15_GAPS_AIR_ATP.md`](CHANGELOG_2026-07-15_GAPS_AIR_ATP.md) — gaps + AIR×ATP
- [`tools/simcar-parity/README.md`](../tools/simcar-parity/README.md) — oráculo API SEMA
