# Plano: Desmembramento de arquivos médios (500–1500 linhas)

Arquivos complementares que também merecem desmembramento, com menor urgência.

---

## 7. `backend/processar-projeto.ts` — 1,489 linhas

### Estrutura proposta
```
backend/processar-projeto/
├── index.ts                   # barrel (~30 linhas)
├── types.ts                   # interfaces (~100 linhas)
├── import-phase.ts            # fase 1: validação CRS, nomenclatura, atributos (~400 linhas)
├── process-phase.ts           # fase 2: Anexo 01 + regras ProcessarGeo (~350 linhas)
├── report-builder.ts          # geração de relatório de importação (~250 linhas)
├── download-artifacts.ts      # download de shapefiles + PDFs (~200 linhas)
└── __tests__/
    └── processar-projeto.test.ts
```

### Passo a passo
1. Criar `types.ts` — isolar interfaces (10 min)
2. Extrair `import-phase.ts` — lógica de importação (20 min)
3. Extrair `process-phase.ts` — lógica de processamento (20 min)
4. Extrair `report-builder.ts` — geração de relatório (15 min)
5. Extrair `download-artifacts.ts` — download (15 min)
6. Criar `index.ts` barrel (5 min)

**Estimativa:** ~1.5 h | **Risco:** Médio

---

## 8. `backend/overlap-analysis.ts` — 1,364 linhas

### Estrutura proposta
```
backend/overlap/
├── index.ts                   # barrel (~30 linhas)
├── types.ts                   # interfaces (~80 linhas)
├── car-intersection.ts        # interseção SIGEF × CAR (~300 linhas)
├── excel-builder.ts           # geração de XLSX (até 3 por ZIP) (~300 linhas)
├── pipeline.ts                # orquestrador (~200 linhas)
└── __tests__/
    └── overlap-analysis.test.ts
```

**Nota:** O `sigef-client.ts` (já existe separado) permanece em `backend/sigef-client.ts`.

### Passo a passo
1. Criar `types.ts` (5 min)
2. Extrair `car-intersection.ts` — usa `sigef-client.ts` (20 min)
3. Extrair `excel-builder.ts` — geração de XLSX com ExcelJS (20 min)
4. Criar `pipeline.ts` — orquestrador (15 min)
5. Criar `index.ts` barrel (5 min)

**Estimativa:** ~1 h | **Risco:** Baixo

---

## 9. `backend/simcar-oraculo/pipeline.ts` — 1,187 linhas

### Estrutura proposta (já dentro de `simcar-oraculo/`)
```
backend/simcar-oraculo/
├── pipeline.ts                # orquestrador enxuto (~200 linhas)
├── pipeline-steps/
│   ├── upload.ts              # upload do shapefile (~150 linhas)
│   ├── import.ts              # fase de importação (~200 linhas)
│   ├── process.ts             # fase de processamento (~200 linhas)
│   ├── download.ts            # download de resultados (~150 linhas)
│   └── status-poll.ts         # polling de status do job (~150 linhas)
```

### Passo a passo
1. Criar `pipeline-steps/` (2 min)
2. Extrair `upload.ts` — usa `client.ts` existente (15 min)
3. Extrair `import.ts` (20 min)
4. Extrair `process.ts` (20 min)
5. Extrair `download.ts` + `status-poll.ts` (15 min)
6. Simplificar `pipeline.ts` (15 min)

**Estimativa:** ~1.5 h | **Risco:** Baixo (domínio isolado)

---

## 10. `client/src/admin/main.tsx` — 1,310 linhas

### Estrutura proposta
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
    └── useAdminData.ts        # dados do Firestore (~100 linhas)
```

### Passo a passo
1. Criar `hooks/useAdminAuth.ts` + `hooks/useAdminData.ts` (15 min)
2. Extrair `UserManagement.tsx` (15 min)
3. Extrair `UsageStats.tsx` (15 min)
4. Extrair `BillingPanel.tsx` (15 min)
5. Extrair `SystemHealth.tsx` (10 min)
6. Criar `AdminDashboard.tsx` como container (15 min)
7. Simplificar `main.tsx` (5 min)

**Estimativa:** ~1.5 h | **Risco:** Baixo

---

## 11. `client/src/dashboard/panels/CbersPanel.tsx` — 927 linhas

### Estrutura proposta
```
client/src/dashboard/panels/cbers/
├── CbersPanel.tsx             # container (~150 linhas)
├── CbersSceneSelector.tsx     # seletor de órbita/ponto (~250 linhas)
├── CbersPreviewMap.tsx        # preview do mapa (~200 linhas)
├── CbersJobList.tsx           # lista de jobs (~150 linhas)
├── CbersDownloadButton.tsx    # botão de download (~100 linhas)
└── useCbersForm.ts            # hook: formulário + validação (~100 linhas)
```

### Passo a passo
1. Extrair `useCbersForm.ts` (10 min)
2. Extrair `CbersSceneSelector.tsx` (15 min)
3. Extrair `CbersPreviewMap.tsx` (15 min)
4. Extrair `CbersJobList.tsx` (10 min)
5. Extrair `CbersDownloadButton.tsx` (10 min)
6. Simplificar `CbersPanel.tsx` (10 min)

**Estimativa:** ~1 h | **Risco:** Baixo

---

## 12. `backend/vertices-proximas.ts` — 1,104 linhas

Escopo único e coeso (análise de vértices próximos). Pode manter como está.

Se quiser dividir:
```
backend/vertices-proximas/
├── index.ts                   # barrel (~30 linhas)
├── detector.ts                # detector de vértices ≤ distância (~350 linhas)
├── cluster.ts                 # agrupamento de vértices próximos (~300 linhas)
├── report.ts                  # relatório (~200 linhas)
└── types.ts                   # tipos (~80 linhas)
```

**Estimativa:** ~1 h | **Risco:** Baixo

---

## 13. `backend/cbers-archive.ts` — 1,105 linhas

Arquivo de acesso a arquivos CBERS históricos. Pode ser incorporado ao desmembramento do `cbers/`:
```
backend/cbers/
├── archive.ts                 # busca em arquivo local (já é este arquivo)
├── stac-search.ts             # busca STAC INPE
└── ...
```

**Ação:** Mover para `backend/cbers/archive.ts` (5 min) + atualizar imports.

---

## 14. `backend/auas-sccon.ts` — 1,037 linhas

Escopo específico (AUAS × SCCON). Mantém coeso como está.

---

## 15. `backend/knowledge-base.ts` — 1,064 linhas

Base de conhecimento textual — monolítico por natureza. Manter como está.

---

## 📊 Resumo consolidado

| # | Arquivo | Linhas | Módulos | Tempo | Risco |
|---|---------|--------|---------|-------|------|
| 1 | `backend/index.ts` | 2,956 | 16 arq | 1.5 h | Médio |
| 2 | `backend/simcar-clip.ts` | 10,103 | 11 arq | 3 h | Alto |
| 3 | `Dashboard.tsx` | 9,765 | 10 arq | 2 h | Médio |
| 4 | `backend/geometry-errors.ts` | 2,885 | 10 arq | 4.5 h | Médio |
| 5 | `backend/cbers-wpm.ts` | 2,693 | 9 arq | 2.5 h | Médio |
| 6 | `backend/landsat.ts` | 1,621 | 7 arq | 1.5 h | Baixo |
| 7 | `backend/processar-projeto.ts` | 1,489 | 5 arq | 1.5 h | Médio |
| 8 | `backend/overlap-analysis.ts` | 1,364 | 4 arq | 1 h | Baixo |
| 9 | `simcar-oraculo/pipeline.ts` | 1,187 | 5 arq | 1.5 h | Baixo |
| 10 | `admin/main.tsx` | 1,310 | 7 arq | 1.5 h | Baixo |
| 11 | `CbersPanel.tsx` | 927 | 5 arq | 1 h | Baixo |
| 12 | `vertices-proximas.ts` | 1,104 | opcional | 1 h | Baixo |
| 13 | `cbers-archive.ts` | 1,105 | mover | 5 min | Baixo |
| **Total** | **~37,500 linhas** | **~94 arquivos** | **~22 h** | |

---

## Ordem de execução recomendada

```
SEMANA 1 (baixo risco, prepara terreno):
  Dia 1: backend/index.ts (1.5h) + cbers-archive.ts (5 min)
  Dia 2: Dashboard.tsx (2h)
  Dia 3: backend/landsat.ts (1.5h) + overlap-analysis.ts (1h)

SEMANA 2 (médio risco, domínio CBERS/geo):
  Dia 4: backend/cbers-wpm.ts (2.5h)
  Dia 5: backend/processar-projeto.ts (1.5h) + admin/main.tsx (1.5h)

SEMANA 3 (alto risco, coração do SIMCAR):
  Dia 6: backend/simcar-clip.ts (3h) — manhã
  Dia 7: backend/geometry-errors.ts (4.5h) — dia inteiro

SEMANA 4 (opcionais, baixa prioridade):
  Dia 8: simcar-oraculo/pipeline.ts (1.5h) + CbersPanel.tsx (1h)
  Dia 9: vertices-proximas.ts (1h) — se quiser
```
