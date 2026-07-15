# Processar projeto — fluxo completo Importar → ProcessarGeo (SIMCAR)

Sub-aba **Análise de Erros → Processar projeto** que recria o fluxo oficial do
**Importador GEO / Projeto Geográfico do SIMCAR** (SEMA-MT):

1. **Importar** shapefile (conformidade estrutural)
2. **Processar** projeto (`ProcessarGeo`): topologia + Anexo 01 + **camadas derivadas**
   (APP, APPP, APPD, APPRL, AURD, ARLDR) + pacotes de saída

Motor **local** no mesmo backend do recorte SIMCAR (PC + Cloudflare Tunnel).

## Fluxo SIMCAR vs GeoForest

| Etapa | SIMCAR (oficial) | GeoForest |
|-------|------------------|-----------|
| Importar | `[CAR_IMPORTAR_SHAPEFILE]` | `POST /api/processar-projeto/importar` |
| Processar | `POST …/ProcessarGeo/{id}` | `POST /api/processar-projeto/processar` |
| Arquivo processado | ZIP com projeto **+ APP*** | `arquivo_processado.zip` com limpos **+ APP*** |
| Erros APP | `[ARQUIVO_ERROS_PROCESSAMENTO_APP]` | `erros_processamento_app.zip` |
| Erros topologia | `[ARQUIVO_ERROS_PROCESSAMENTO]` | `erros_processamento.zip` |

## O que o ProcessarGeo local calcula

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

## Validações (fase Processar)

Além da derivação:

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

```
POST /api/processar-projeto/upload
POST /api/processar-projeto/importar
POST /api/processar-projeto/processar   → job SSE
GET  /api/processar-projeto/download/:id
```

## Arquitetura

| Módulo | Papel |
|--------|-------|
| `backend/simcar-processar-geo.ts` | Buffers APP + APPP/APPD/APPRL/AURD/ARLDR |
| `backend/processar-projeto.ts` | Orquestra import/process + ZIP |
| `backend/geometry-errors.ts` | Topologia / Anexo 01 / AIR×ATP |
| `backend/simcar-rules.ts` | Nomenclatura, conformidade, regras Anexo 01 |
| `client/.../ProcessarProjetoAnalysis.tsx` | UI |

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
4. Clique **Processar projeto** — roda topologia + Anexo 01 + **ProcessarGeo (APP*)**.
5. Baixe o **ZIP completo** e abra no SIG:
   - `arquivo_processado/APP.shp` (e APPD, APPP, …)
   - `erros/` e `erros_app/` se houver inconsistências

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

## Changelog

Ver [`CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md`](CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md).
