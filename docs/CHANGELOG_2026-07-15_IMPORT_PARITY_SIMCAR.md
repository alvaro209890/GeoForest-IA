# Changelog — Paridade de importação SIMCAR (PDF SEMA / fixture teste_1)

**Data:** 2026-07-15  
**Branch:** `main`  
**Feature:** Análise de Erros → **Processar Projeto** (fase **Importar**)

## Resumo

A fase **Importar** do Processar Projeto passou a espelhar o **Importador GEO do SIMCAR (SEMA-MT)**:

1. Conformidade estrutural **+ topologia impeditiva** na importação (não só no Processar).
2. Importação **reprovada** se houver qualquer erro → **Processar não libera** (API + UI).
3. Calibração com ZIP real e PDF oficial da SEMA (`teste_1`).

## Oráculo SEMA (fonte da verdade)

| Item | Valor |
|------|--------|
| Pasta de teste | `C:\Users\Usuario\Downloads\teste_1\` (cópia no repo: `backend/fixtures/teste_1/`) |
| ZIP | `Recorte_13.07.26_CORRIGIDO_SIMCAR.zip` |
| PDF | `Relatorio de Importacao (1).pdf` |
| Situação no PDF | **Reprovado** — *Corrija os erros encontrados e envie novamente!* |
| Erros no ARL (PDF) | **Borda do polígono se cruza: 4** · **A geometria contém pontos repetidos: 2** |

### Resultado GeoForest no mesmo ZIP (após esta entrega)

| Camada | Borda se cruza | Pontos repetidos |
|--------|----------------|------------------|
| **ARL** | **4** (igual ao PDF) | **2** (igual ao PDF) |
| AVN | 4 | 2 |
| AREA_CONSOLIDADA | 1 | 0 |

- `ok = false` (importação reprovada)
- Processar recusado (`IMPORT_FAILED` / botão desabilitado)
- **Paridade no ARL + situação + tipos:** alinhada ao parecer
- **Lista global:** o GeoForest também reporta os mesmos tipos em AVN/AREA_CONSOLIDADA (pré-validação um pouco mais abrangente que o resumo do PDF, que destaca o ARL)

## O que foi implementado

### 1. Topologia na fase Importar

`runImportPhase` (`backend/processar-projeto.ts`) agora:

1. Roda `checkSimcarConformity` (CRS, 2D, nomenclatura, atributos, ATP).
2. Roda `analyzeLayerGeometry` em **cada** camada poligonal:
   - `borda_se_cruza` (auto-interseção)
   - `vertice_duplicado` (pontos repetidos)
3. `ok = rows.length === 0`
4. Relatório com texto no estilo SEMA: *Situação da importação: Reprovado…*

### 2. Tolerâncias métricas (calibração do importador)

Em `backend/geometry-errors.ts`:

| Constante | Valor | Uso |
|-----------|-------|-----|
| `SIMCAR_IMPORT_SNAP_TOLERANCE_M` | **0,05 m** | Cluster/snap em UTM antes do kinks → “Borda do polígono se cruza” |
| `SIMCAR_IMPORT_DUP_TOLERANCE_M` | **0,1 m** | Vértices consecutivos a ≤ 0,1 m → “A geometria contém pontos repetidos” |

Coordenadas geográficas (SIRGAS/WGS84) são projetadas para UTM estimada; coordenadas métricas usam as unidades do CRS.

### 3. Gate duro no Processar

- **API:** `assertImportAllowsProcess` — se importação não estiver OK, `POST /api/processar-projeto/processar` responde **400** com `code: "IMPORT_FAILED"` e a mensagem do PDF.
- **UI:** `canProcess = importOk === true`; toast e texto de status iguais ao SEMA.
- Labels de erro alinhados ao PDF:
  - `borda_se_cruza` → *Borda do polígono se cruza*
  - `vertice_duplicado` → *A geometria contém pontos repetidos*

### 4. Nomenclatura do inventário SIMCAR

Camadas do relatório de importação SEMA / ProcessarGeo reconhecidas em `simcar-rules.ts`:

`AREA_UMIDA`, `AREA_USO_RESTRITO`, `AURD`, `ARLDR`, `ARLREM`, `ARCUC`, `APP`, `APPP`, `APPD`, `APPRL` (+ aliases).

### 5. Storage local

`processar_projeto_jobs` incluído na whitelist de `backend/local-storage.ts` (evita `INVALID_DOC_PATH` no fluxo de jobs).

### 6. Fixture e testes

- Fixture versionada: `backend/fixtures/teste_1/Recorte_13.07.26_CORRIGIDO_SIMCAR.zip`
- Testes em `backend/processar-projeto.test.ts`:
  - topologia sintética na importação
  - `assertImportAllowsProcess` (bloqueio / liberação)
  - **paridade** no ZIP real: `ok=false`, ARL ≥ 4 bordas e ≥ 2 pontos, gate processar

```bash
npx vitest run --root . \
  backend/processar-projeto.test.ts \
  backend/geometry-errors.test.ts \
  backend/simcar-rules.test.ts
```

## Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `backend/processar-projeto.ts` | Import com topologia; gate processar; relatório SEMA |
| `backend/geometry-errors.ts` | Tolerâncias métricas SIMCAR (snap 0,05 m / dup 0,1 m) |
| `backend/simcar-rules.ts` | Códigos/aliases do inventário SEMA |
| `backend/local-storage.ts` | Whitelist `processar_projeto_jobs` |
| `backend/processar-projeto.test.ts` | Paridade teste_1 + gate |
| `backend/fixtures/teste_1/*.zip` | Fixture real |
| `client/src/components/ProcessarProjetoAnalysis.tsx` | UI: labels, canProcess, mensagens |
| `docs/PROCESSAR_PROJETO_SIMCAR.md` | Seção Importar |
| `docs/CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md` | Este documento |

## Como validar na UI

1. Reiniciar o backend local (PC + tunnel, se usar).
2. Abrir **Análise de Erros → Processar Projeto**.
3. Enviar `Recorte_13.07.26_CORRIGIDO_SIMCAR.zip`.
4. Clicar **Importar**.
5. Esperado:
   - Situação: **Reprovado**
   - ARL: 4 bordas + 2 pontos repetidos
   - Botão **Processar projeto** desabilitado

## Limites / honestidade

- Não gera o PDF oficial da SEMA nem croqui.
- Pode listar os **mesmos tipos** de erro em outras camadas além do ARL (pré-validação local).
- APP*/ProcessarGeo continua só após importação **OK**.
- Bases externas (TI, UC, embargo) fora do escopo.

## Documentação relacionada

- [`PROCESSAR_PROJETO_SIMCAR.md`](PROCESSAR_PROJETO_SIMCAR.md) — manual da feature  
- [`ERROS_GEOMETRIA_SIMCAR.md`](ERROS_GEOMETRIA_SIMCAR.md) — checks avulsos (aba irmã)  
- [`CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md`](CHANGELOG_2026-07-15_PROCESSAR_PROJETO_GEO.md) — ProcessarGeo / APP*  
