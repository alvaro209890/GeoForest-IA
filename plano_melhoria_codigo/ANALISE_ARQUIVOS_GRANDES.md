# Análise de Arquivos Grandes — GeoForest-IA

**Data:** 2026-07-31
**Total de linhas (TS/TSX):** ~69,867 (excluindo node_modules, dist, testes)

## Resumo

Foram identificados **16 arquivos backend** e **4 arquivos frontend** com mais de 500 linhas que deveriam ser desmembrados. Abaixo, análise detalhada com sugestão de desmembramento para cada um.

---

## 🔴 CRÍTICOS (>2000 linhas)

### 1. `backend/simcar-clip.ts` — **10,103 linhas**

**Problema:** Monólito absoluto. Contém TODO o pipeline de recorte SIMCAR: clipping de shapefiles, geração de AIR/ATP, união de polígonos, buffer, dissolve, exportação de shapefiles, e lógica de análise pós-recorte.

**Sugestão de desmembramento:**
```
backend/simcar/
├── index.ts                  # re-exports, entry point (~50 linhas)
├── clip-pipeline.ts          # orquestrador principal do recorte (~300 linhas)
├── polygon-ops.ts            # operações geométricas (union, buffer, dissolve, clip) (~800 linhas)
├── air-atp-generator.ts      # geração de AIR e ATP por lote (~1200 linhas)
├── shapefile-io.ts           # leitura/escrita de .shp/.dbf/.prj (~600 linhas)
├── area-calculator.ts        # cálculo de áreas (ha, km², percentuais) (~500 linhas)
├── attribute-mapper.ts       # mapeamento de atributos SIMCAR (~400 linhas)
├── validation.ts             # validação de geometria pós-recorte (~500 linhas)
├── types.ts                  # interfaces e tipos (~200 linhas)
└── constants.ts              # tabelas de lookup, configurações (~300 linhas)
```

**Estimativa:** ~10,000 linhas distribuídas em 10 arquivos

---

### 2. `client/src/pages/Dashboard.tsx` — **9,765 linhas**

**Problema:** Este arquivo é o dashboard INTEIRO. Já houve modularização parcial (hooks/panels), mas o arquivo principal ainda concentra:
- Estado global do dashboard
- Roteamento interno (abas)
- Sidebar + header
- Auth + loading states
- Telegramas de estado entre painéis
- Lógica de upload de shapefile
- Navegação mobile

**Sugestão de desmembramento:**
```
client/src/dashboard/
├── DashboardPage.tsx          # entry point (~150 linhas)
├── DashboardShell.tsx         # layout: sidebar + header + conteúdo (~300 linhas)
├── DashboardContent.tsx       # roteador de abas (switch/case) (~200 linhas)
├── DashboardAuthGate.tsx      # wrapper de autenticação + loading (~100 linhas)
├── MobileNav.tsx              # navegação inferior mobile (~150 linhas)
├── SidebarNav.tsx             # sidebar desktop (~200 linhas)
├── useDashboardState.ts       # hook: estado global do dashboard (~300 linhas)
├── useShapefileUpload.ts      # hook: upload de shapefile (~200 linhas)
├── useAuthRedirect.ts         # hook: redirect + refresh token (~150 linhas)
└── context/
    └── DashboardContext.tsx   # React context provider (~100 linhas)
```

**Estimativa:** ~9,700 linhas distribuídas em 10+ arquivos

---

### 3. `backend/index.ts` — **2,956 linhas**

**Problema:** O servidor Express principal acumulou:
- Configuração do app (CORS, body parser, auth middleware)
- Rotas de WMS/CBERS
- Rotas de SIMCAR
- Rotas de croqui
- Rotas de recibos
- Rotas de oráculo
- Rotas de admin
- Rotas de billing
- SSRF whitelist
- Error handlers

**Sugestão de desmembramento:**
```
backend/
├── index.ts                   # bootstrap: cria app, carrega rotas, sobe servidor (~80 linhas)
├── routes/
│   ├── cbers.ts               # rotas CBERS/WPM (~250 linhas)
│   ├── simcar.ts              # rotas SIMCAR (~200 linhas)
│   ├── croqui.ts              # rotas croqui (~150 linhas)
│   ├── receipts.ts            # rotas recibos SIMCAR+APF (~150 linhas)
│   ├── oraculo.ts             # rotas oráculo SEMA (~150 linhas)
│   ├── admin.ts               # rotas admin (~150 linhas)
│   ├── billing.ts             # rotas cobrança (~100 linhas)
│   ├── overlap.ts             # rotas sobreposição (~80 linhas)
│   ├── auas.ts                # rotas AUAS/SCCON (~80 linhas)
│   └── knowledge.ts           # rotas base de conhecimento (~80 linhas)
├── middleware/
│   ├── auth.ts                # middleware auth (~80 linhas)
│   ├── cors.ts                # CORS config (~30 linhas)
│   ├── error-handler.ts       # error handler global (~60 linhas)
│   └── ssrf-guard.ts          # SSRF whitelist (~60 linhas)
└── config.ts                  # portas, CORS origins, etc (~40 linhas)
```

**Estimativa:** ~2,950 linhas distribuídas em 16 arquivos

---

### 4. `backend/geometry-errors.ts` — **2,885 linhas**

**Problema:** Detecta erros de geometria SIMCAR (borda se cruza, anéis sobrepostos, pontos repetidos, úmida contida, etc). Contém TODAS as funções de detecção, regras do oráculo SEMA, e cálculos geométricos.

**Sugestão de desmembramento:**
```
backend/geometry/
├── index.ts                   # re-exports (~30 linhas)
├── detectors/
│   ├── collapsed-ring.ts      # anel colapsado (borda se cruza) (~300 linhas)
│   ├── duplicate-points.ts    # pontos repetidos (~150 linhas)
│   ├── overlapping-rings.ts   # anéis sobrepostos (~350 linhas)
│   ├── complex-polygon.ts     # polígono complexo/multipart (~150 linhas)
│   ├── umida-containment.ts   # AREA_UMIDA contida (~400 linhas)
│   ├── reservatorio.ts        # regras de reservatório (~200 linhas)
│   └── forbidden-overlap.ts   # sobreposição proibida (~300 linhas)
├── runner.ts                  # orquestrador: roda todos detectores (~150 linhas)
├── types.ts                   # interfaces de erro (~100 linhas)
├── constants.ts               # thresholds (0.01 m², 0.02 m, 1 m compartilhado, etc) (~50 linhas)
└── utils.ts                   # funções auxiliares (área, largura, amostra de borda) (~200 linhas)
```

**Estimativa:** ~2,800 linhas distribuídas em 11 arquivos

---

## 🟠 GRANDES (500–2000 linhas)

### 5. `backend/cbers-wpm.ts` — **2,693 linhas**

**Sugestão de desmembramento:**
```
backend/cbers/
├── index.ts                   # re-exports (~40 linhas)
├── stac-search.ts             # busca STAC INPE (~400 linhas)
├── download.ts                # download de bandas (~350 linhas)
├── pansharpen.ts              # pansharpening (~250 linhas)
├── enhance.ts                 # realce (média+2.5σ, 8 bits) (~300 linhas)
├── publish.ts                 # publicação no GeoServer (~300 linhas)
├── validate.ts                # validação contra footprint STAC (~200 linhas)
├── pipeline.ts                # orquestrador do pipeline (~200 linhas)
├── types.ts                   # tipos (~100 linhas)
└── constants.ts               # coleções, resoluções (~80 linhas)
```

---

### 6. `backend/landsat.ts` — **1,621 linhas**

**Sugestão de desmembramento:**
```
backend/landsat/
├── index.ts                   # re-exports (~30 linhas)
├── stac-search.ts             # busca STAC LandsatLook (~300 linhas)
├── download-sas.ts            # download via Planetary Computer SAS (~300 linhas)
├── composite.ts               # composição RGB (gdalbuildvrt, gdal_translate) (~250 linhas)
├── publish.ts                 # publicação no GeoServer (~200 linhas)
├── pipeline.ts                # orquestrador (~200 linhas)
└── types.ts                   # tipos (~100 linhas)
```

---

### 7. `client/src/components/ProcessarProjetoAnalysis.tsx` — **2,178 linhas**

**Observação:** Segundo a memória do projeto, a aba "Processar Projeto" foi REMOVIDA do dashboard em 2026-07-21. Este componente ficou no repo sem import.

**Recomendação:** Se não está sendo usado, manter como está ou remover. Se voltar a usar, dividir em:
```
client/src/components/processar-projeto/
├── ProcessarProjetoAnalysis.tsx  # container (~200 linhas)
├── ImportPhase.tsx               # fase 1: import (~400 linhas)
├── ProcessPhase.tsx              # fase 2: process (~400 linhas)
├── ErrorList.tsx                 # lista de erros (~250 linhas)
├── ShapePreview.tsx              # preview do shape (~200 linhas)
├── useImportJob.ts               # hook: job de import (~250 linhas)
├── useProcessJob.ts              # hook: job de process (~200 linhas)
└── types.ts                      # tipos (~100 linhas)
```

---

### 8. `backend/processar-projeto.ts` — **1,489 linhas**

**Sugestão de desmembramento:**
```
backend/processar-projeto/
├── index.ts                   # re-exports (~30 linhas)
├── import-phase.ts            # fase de importação (~400 linhas)
├── process-phase.ts           # fase de processamento (~350 linhas)
├── report-builder.ts          # geração de relatório (~250 linhas)
├── download.ts                # download de artefatos (~200 linhas)
└── types.ts                   # tipos (~100 linhas)
```

---

### 9. `backend/overlap-analysis.ts` — **1,364 linhas**

**Sugestão de desmembramento:**
```
backend/overlap/
├── index.ts                   # re-exports (~30 linhas)
├── sigef-client.ts            # cliente SIGEF (já existe separado!) (~200 linhas)
├── car-intersection.ts        # interseção com CAR (~300 linhas)
├── excel-builder.ts           # geração de XLSX (~300 linhas)
├── pipeline.ts                # orquestrador (~200 linhas)
└── types.ts                   # tipos (~100 linhas)
```

---

### 10. `client/src/admin/main.tsx` — **1,310 linhas**

**Sugestão de desmembramento:**
```
client/src/admin/
├── main.tsx                   # entry point (~50 linhas)
├── AdminDashboard.tsx         # dashboard principal (~300 linhas)
├── UserManagement.tsx         # gestão de usuários (~250 linhas)
├── UsageStats.tsx             # estatísticas de uso (~200 linhas)
├── BillingPanel.tsx           # painel de cobrança (~200 linhas)
├── SystemHealth.tsx           # saúde do sistema (~150 linhas)
└── hooks/
    ├── useAdminAuth.ts        # auth admin (~100 linhas)
    └── useAdminData.ts        # dados admin (~100 linhas)
```

---

### 11. `backend/cbers-archive.ts` — **1,105 linhas**

**Sugestão:** Já está no escopo de CBERS — poderia ser incorporado ao desmembramento do `cbers/` como `archive.ts`.

---

### 12. `backend/vertices-proximas.ts` — **1,104 linhas**

**Sugestão:** Arquivo com escopo único (análise de vértices próximos). Pode manter como está ou dividir em:
```
backend/vertices-proximas/
├── index.ts                   # re-exports (~30 linhas)
├── detector.ts                # detector de vértices (~350 linhas)
├── cluster.ts                 # agrupamento de vértices (~300 linhas)
├── report.ts                  # relatório (~200 linhas)
└── types.ts                   # tipos (~80 linhas)
```

---

### 13. `backend/knowledge-base.ts` — **1,064 linhas**

**Sugestão:** Manter como está. Base de conhecimento tende a ser monolítica por natureza (catálogo de regras).

---

### 14. `backend/auas-sccon.ts` — **1,037 linhas**

**Sugestão:** Escopo específico. Pode manter como está.

---

### 15. `backend/simcar-oraculo/pipeline.ts` — **1,187 linhas**

**Sugestão de desmembramento:**
```
backend/simcar-oraculo/
├── pipeline.ts                # orquestrador (~200 linhas)
├── pipeline-steps/
│   ├── upload.ts              # upload do shape (~150 linhas)
│   ├── import.ts              # fase import (~200 linhas)
│   ├── process.ts             # fase process (~200 linhas)
│   ├── download.ts            # download resultados (~150 linhas)
│   └── status-poll.ts         # polling de status (~150 linhas)
```

---

### 16. `client/src/dashboard/panels/CbersPanel.tsx` — **927 linhas**

**Sugestão de desmembramento:**
```
client/src/dashboard/panels/cbers/
├── CbersPanel.tsx             # container (~150 linhas)
├── CbersSceneSelector.tsx     # seletor de cena/órbita (~250 linhas)
├── CbersPreviewMap.tsx        # preview do mapa (~200 linhas)
├── CbersJobList.tsx           # lista de jobs (~150 linhas)
├── CbersDownloadButton.tsx    # botão download (~100 linhas)
└── useCbersForm.ts            # hook: formulário (~100 linhas)
```

---

## 📊 Métricas comparativas

| Arquivo | Linhas atuais | Arquivos sugeridos | Redução média |
|---------|---------------|-------------------|---------------|
| `simcar-clip.ts` | 10,103 | 10 | ~1,010/arq |
| `Dashboard.tsx` | 9,765 | 10 | ~976/arq |
| `index.ts` | 2,956 | 16 | ~184/arq |
| `geometry-errors.ts` | 2,885 | 11 | ~262/arq |
| `cbers-wpm.ts` | 2,693 | 10 | ~269/arq |
| `ProcessarProjetoAnalysis.tsx` | 2,178 | 8 | ~272/arq |
| `landsat.ts` | 1,621 | 6 | ~270/arq |
| `processar-projeto.ts` | 1,489 | 5 | ~297/arq |
| `overlap-analysis.ts` | 1,364 | 5 | ~272/arq |
| `admin/main.tsx` | 1,310 | 7 | ~187/arq |
| `simcar-oraculo/pipeline.ts` | 1,187 | 5 | ~237/arq |

---

## ⚠️ Riscos do desmembramento

1. **Importações circulares** — risco real em `geometry-errors.ts` e `simcar-clip.ts` onde funções se referenciam mutuamente. Resolver com barrel exports (`index.ts`) e interfaces compartilhadas.

2. **Testes quebrando** — `geometry-errors.test.ts` (925 linhas) e `simcar-clip-snap.test.ts` fazem imports diretos. Precisam ser atualizados após mover funções.

3. **Caminho de import no `index.ts` (backend)** — as rotas importam funções de `./simcar-clip`, `./geometry-errors`, etc. Manter barrel exports (`index.ts`) em cada nova pasta para não quebrar compatibilidade.

4. **Git blame / histórico** — o `git mv` preserva histórico melhor que criar arquivos novos.

---

## 📋 Plano de execução sugerido (ordem de prioridade)

### Fase 1 — Cirúrgico (baixo risco, alto impacto)
1. `backend/index.ts` → desmembrar em `routes/*.ts` + `middleware/*.ts`
2. `client/src/pages/Dashboard.tsx` → continuar modularização (já iniciada com panels/hooks)

### Fase 2 — Domínio (médio risco)
3. `backend/simcar-clip.ts` → `backend/simcar/*.ts`
4. `backend/geometry-errors.ts` → `backend/geometry/*.ts`

### Fase 3 — Pipelines (baixo risco, domínio isolado)
5. `backend/cbers-wpm.ts` → `backend/cbers/*.ts`
6. `backend/landsat.ts` → `backend/landsat/*.ts`
7. `backend/processar-projeto.ts` → `backend/processar-projeto/*.ts`

### Fase 4 — Finalização
8. `backend/overlap-analysis.ts`
9. `backend/simcar-oraculo/pipeline.ts`
10. `client/src/admin/main.tsx`
11. `client/src/dashboard/panels/CbersPanel.tsx`

---

## ✅ Conclusão

Dos ~69,867 linhas totais, **~36,000 linhas (51%)** estão concentradas em apenas 11 arquivos. O desmembramento reduziria o tamanho médio de arquivo de ~400 para ~150 linhas, melhorando:
- **Navegabilidade:** encontrar funções específicas sem scroll infinito
- **Testabilidade:** testar módulos isolados sem dependências ocultas
- **Revisão de código:** diffs menores e mais legíveis
- **Onboarding:** novos devs entendem um domínio por vez
