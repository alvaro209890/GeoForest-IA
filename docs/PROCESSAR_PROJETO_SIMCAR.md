# Processar projeto — Oráculo SIMCAR real

Desde 2026-07-16, a sub-aba **Análise de Erros → Processar projeto** usa o próprio
**Importador GEO / Projeto Geográfico do SIMCAR** (SEMA-MT):

1. envia o ZIP ao projeto-teste CAR 270069;
2. confirma município/abrangência sem alterar o nome “Santa clara”;
3. executa **Importar** e **ProcessarGeo** reais em uma fila serial;
4. devolve PDFs e ZIPs oficiais por rodada.

O antigo motor local descrito nas seções técnicas abaixo permanece como biblioteca de
regressão e primitivas de correção. Ele **não é mais chamado pela aba e não emite o veredito**.
Os endpoints antigos `/importar` e `/processar` respondem 410 durante a migração.

## Fluxo SIMCAR vs GeoForest

| Etapa | Fonte atual | Rota GeoForest |
|-------|------------------|-----------|
| Importar | `[CAR_IMPORTAR_SHAPEFILE]` real | `POST /api/simcar-oraculo/pipeline` |
| Processar | `ProcessarGeo/{id}` real | mesmo job/pipeline |
| Arquivos e relatórios | downloads oficiais da SEMA | `/jobs/:id/artifact/:key` |
| Timeline | status reais da SEMA | `/jobs/:id/events` |

## Referência do antigo ProcessarGeo local (fora do fluxo da aba)

### Camadas de entrada (técnico envia)

ATP, AIR, AVN, AUAS, AREA_CONSOLIDADA, ARL, rios por faixa, NASCENTE, lagoa,
reservatório, vereda, relevo, etc. (nomenclatura oficial + aliases do modelo clip:
`RIO_ATE_10`, `RIO_10_A_50`, …).

### Camadas **derivadas** (geradas no processar)

| Código | Fórmula (local) | Base legal / regra |
|--------|-----------------|--------------------|
| **APP** | união dos buffers de hidrografia ∩ AIR (ou ATP) | Código Florestal Art. 4º |
| **APPP** | APP ∩ AVN | APP preservada (aprox.) |
| **APPD** | APP − APPP | APP degradada / passivo (aprox.) |
| **APPRL** | APP ∩ ARL | APP em Reserva Legal |
| **AURD** | (AREA_DECLIVIDADE ∪ AREA_PANTANEIRA) ∩ AUAS | Uso restrito degradado (aprox.) |
| **ARLDR** | ARL ∩ AUAS | RL a recuperar (aprox.) |

### Buffers oficiais de APP (metros)

| Origem | Buffer |
|--------|--------|
| Rio &lt; 10 m (`RIO_MENOR_10` / `RIO_ATE_10`) | **30 m** |
| Rio 10–50 m | **50 m** |
| Rio 50–200 m | **100 m** |
| Rio 200–600 m | **200 m** |
| Rio &gt; 600 m | **500 m** |
| Nascente | **50 m** (raio) |
| Lagoa natural | **50 m** (padrão rural) |
| Reservatório artificial | **30 m** (padrão rural) |
| Vereda | **50 m** |

Sem camadas hidrográficas no ZIP, APP* não é gerada (aviso no relatório).

## Detectores locais preservados para regressão/autofix

Essas regras ajudam nos testes e nas correções mecânicas; somente a resposta real da SEMA
aprova ou reprova a importação exibida ao usuário:

- Conformidade estrutural (CRS, 2D, nomenclatura, atributos, ATP)
- **Borda do polígono se cruza** (`borda_se_cruza`) — auto-interseção exata
  (kinks) **ou anel colapsado**: largura mínima ≤ 0,02 m (agulha/sliver) ou
  área ≤ 0,01 m² (micro-resíduo). Encoste PONTUAL de vértice em borda **não**
  reprova (regra ESRI, comprovada no oráculo com sondas de 0,015–0,076 m).
- **A geometria contém pontos repetidos** (`vertice_duplicado`) — vértices consecutivos ≤ ~0,1 m

Oráculo: importador real do SIMCAR (CAR 270069/Santa Clara), bissecção com
camadas-sonda em 2026-07-16 — ver
[`CHANGELOG_2026-07-16_ORACULO_SEMA_SANTA_CLARA.md`](CHANGELOG_2026-07-16_ORACULO_SEMA_SANTA_CLARA.md)
(inclui o contrato completo da API de importação/processamento do SIMCAR).

## Regras locais preservadas do processamento

No motor legado, só rodavam com importação **OK**. As primitivas preservadas incluem:

- Auto-interseção, vértices duplicados, anéis degenerados  
- Sobreposição mesma camada, vazios/gaps  
- Contenção e sobreposições proibidas do Anexo 01  
- Soma AIR vs ATP  
- Pontos `erro_calculo_app` se o buffer falhar  

## ZIP de saída

| Arquivo | Conteúdo |
|---------|----------|
| `arquivo_processado.zip` | Camadas limpas **+ APP / APPP / APPD / APPRL / AURD / ARLDR** |
| `arquivo_enviado.zip` | Originais |
| `arquivo_conferencia.zip` | Processadas com `area_m2` / `area_ha` |
| `erros_processamento.zip` | Topologia / Anexo 01 |
| `erros_processamento_app.zip` | Erros de cálculo de APP |
| `quadro_areas.csv` | Inclui linhas APP* |
| Relatórios + pastas espelhadas | Para abrir no SIG |

## API

Todas as rotas exigem **Firebase Bearer** (`requireAuth` em `backend/index.ts`).

```
POST   /api/processar-projeto/upload
POST   /api/simcar-oraculo/pipeline
GET    /api/simcar-oraculo/jobs/:id
GET    /api/simcar-oraculo/jobs/:id/events
GET    /api/simcar-oraculo/jobs/:id/artifact/:key
DELETE /api/simcar-oraculo/jobs/:id

POST   /api/processar-projeto/importar            → 410 Gone
POST   /api/processar-projeto/processar            → 410 Gone
```

### Persistência / cards

Jobs novos são server-owned em `users/{uid}/simcar_oraculo_jobs`; o Dashboard lê também
`processar_projeto_jobs` apenas para histórico legado. Clique no card novo restaura o snapshot
e os downloads; o front não replica `timeline`/linhas extensas nem sobrescreve o job.

### Settings do processar legado

| Campo | Uso |
|-------|-----|
| `minOverlapM2` | Área mínima (m²) para marcar sobreposição/vazio |

Esses settings não são expostos na aba atual.

## Arquitetura

| Módulo | Papel |
|--------|-------|
| `backend/simcar-processar-geo.ts` | Buffers APP + APPP/APPD/APPRL/AURD/ARLDR |
| `backend/simcar-oraculo/pipeline.ts` | Orquestra prepare/import/process reais + rodadas |
| `backend/processar-projeto.ts` | Upload/preview, compatibilidade 410 e biblioteca legada |
| `backend/geometry-errors.ts` | Topologia / Anexo 01 / AIR×ATP |
| `backend/simcar-rules.ts` | Nomenclatura, conformidade, regras Anexo 01 |
| `backend/import-report-pdf.ts` | PDF legado/testes; não aparece na aba |
| `client/.../ProcessarProjetoAnalysis.tsx` | UI ORACULO-only + SSE/poll/downloads |
| `client/.../Dashboard.tsx` | Histórico novo+legado na sidebar |

## Testes

```bash
npx vitest run --root . \
  backend/simcar-processar-geo.test.ts \
  backend/processar-projeto.test.ts \
  backend/simcar-rules.test.ts
```

## Limites (honestidade)

- APPP/APPD/AURD/ARLDR são **aproximações** das regras oficiais (o servidor SEMA usa
  mais atributos de domínio, consolidada 2008, módulos fiscais, etc.).
- Lagoa &gt; 20 ha deveria usar 100 m de APP — hoje usa 50 m padrão.
- Não gera croqui PDF nem envio CAR federal.
- Continua útil como **pré-validação local completa do fluxo** Importar→Processar.

## Como usar (passo a passo)

1. Abra o GeoForest → **Análise de Erros** → **Processar projeto**.
2. Envie o **ZIP** do Projeto Geográfico (mesmo padrão do SIMCAR técnico).
3. Clique **Importar** — confere estrutura; veja camadas reconhecidas e erros de importação.
4. (Opcional) **Baixar PDF da importação** — relatório GeoForest (situação + erros).
5. Clique **Processar projeto** — roda topologia + Anexo 01 + **ProcessarGeo (APP*)**.
6. Baixe o **ZIP completo** e abra no SIG:
   - `arquivo_processado/APP.shp` (e APPD, APPP, …)
   - `erros/` e `erros_app/` se houver inconsistências
7. Para outro imóvel: **Reiniciar com outro ZIP** / **Novo projeto (outro ZIP)**.
8. Cards na sidebar guardam importações e processamentos anteriores.

### Pré-requisitos no ZIP para gerar APP*

Pelo menos uma entre:

- rios (`RIO_MENOR_10` / `RIO_ATE_10` / faixas 10–50, 50–200, 200–600, &gt;600)
- `NASCENTE` (ponto)
- `LAGOA_NATURAL` / `LAGO_LAGOA_NATURAL`
- `RESERVATORIO_ARTIFICIAL`
- `VEREDA`

Recomendado também: **AIR** (ou ATP), **AVN** (para APPP/APPD), **ARL** (para APPRL).

## Tipos de erro (tabela UI)

| `tipo` | Significado |
|--------|-------------|
| `borda_se_cruza` | Auto-interseção do anel |
| `vertice_duplicado` / `anel_degenerado` | Topologia de anel |
| `sobreposicao` | Feições da mesma camada se sobrepõem |
| `vazio` | Gap entre polígonos adjacentes |
| `fora_do_continente` | Anexo 01 contenção |
| `sobreposicao_proibida` | Anexo 01 pares proibidos |
| `air_atp_area` | Soma AIR ≠ ATP |
| `erro_calculo_app` | Buffer APP falhou na feição |
| `crs_*` / `nomenclatura_*` / `atributo_*` / … | Importação (conformidade) |

## Deploy

No PC do backend (Cloudflare Tunnel → `geoforest-api` / localhost):

```bash
git pull origin main
# reiniciar o processo Node do backend
```

Front (Firebase Hosting): rebuild + deploy para a UI da sub-aba.

## PDF de importação (GeoForest)

Após **Importar**, a API gera um PDF de relatório (situação, erros por feição,
inventário de geometrias) com **identidade visual GeoForest** (sem marca SEMA
no layout).

- Download: `GET /api/processar-projeto/import/:importId/pdf` (auth obrigatória)
- UI: botão **Baixar PDF da importação** no banner de situação
- Implementação: `backend/import-report-pdf.ts`

## Changelog

- [`CHANGELOG_2026-07-15_PROCESSAR_PROJETO_UX_AUTH.md`](CHANGELOG_2026-07-15_PROCESSAR_PROJETO_UX_AUTH.md) — auth, cards, PDF sem SEMA, reinício ZIP, remoção generateFixed
- [`CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md`](CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md) — ProcessarGeo / APP* / pacotes de saída
- [`CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md`](CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md) — paridade de importação com PDF SEMA (teste_1)
- [`CHANGELOG_2026-07-15_IMPORT_PDF_REPORT.md`](CHANGELOG_2026-07-15_IMPORT_PDF_REPORT.md) — PDF de relatório de importação
