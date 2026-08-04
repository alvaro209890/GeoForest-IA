# Plano de Melhoria de Código — GeoForest-IA

**Criado:** 2026-07-31
**Status:** ✅ Planos 01–07 **CONCLUÍDOS** (04–07 em 03/08/2026)

---

## 📂 Documentos do plano

| # | Arquivo | Assunto | Linhas atuais | Módulos propostos | Status |
|---|---------|---------|---------------|-------------------|--------|
| 01 | [01_backend_index.md](01_backend_index.md) | `backend/index.ts` — servidor Express | 2,956 → 1,536 | 16 arquivos | ✅ Concluído 31/07 |
| 02 | [02_simcar_clip.md](02_simcar_clip.md) | `backend/simcar-clip.ts` — recorte SIMCAR | 10,026 → **87** | 13 arquivos | ✅ **Concluído 02/08** (monólito eliminado, −99,1%) |
| 03 | [03_dashboard.md](03_dashboard.md) | `client/.../Dashboard.tsx` — dashboard | 9,776 → 7,331 | 10 arquivos | ✅ **Concluído 01/08** (passos 1–12: hooks, lib, HistoryCard, useSimcarAnalysisFlow) |
| 04 | [04_geometry_errors.md](04_geometry_errors.md) | `backend/geometry-errors.ts` — detectores | 2,885 → **46** (barrel) | 19 arquivos | ✅ **Concluído 03/08** |
| 05 | [05_cbers_wpm.md](05_cbers_wpm.md) | `backend/cbers-wpm.ts` — pipeline CBERS | 2,693 → **14** (barrel) | 19 arquivos | ✅ **Concluído 03/08** |
| 06 | [06_landsat.md](06_landsat.md) | `backend/landsat.ts` — pipeline Landsat | 1,621 → pasta `landsat/` | 13 arquivos | ✅ **Concluído 03/08** |
| 07 | [07_arquivos_medios.md](07_arquivos_medios.md) | arquivos médios (900–1500 linhas) | ~7,900 | 55 arquivos | ✅ **Concluído 03/08** (itens 7–13; ver ressalva do item 9) |

---

## 📊 Números gerais

| Métrica | Antes (31/07) | Depois (03/08) |
|---------|---------------|----------------|
| Monólitos alvo dos planos 01–07 | **16** | **0** |
| Módulos bem divididos | ~30 | **~215** |
| Arquivo mais longo (backend) | 10,103 linhas | 5,249 (`simcar/analysis.ts`) |
| Arquivo mais longo (client) | 9,776 linhas | 7,371 (`Dashboard.tsx`) |

**Redução do maior arquivo:** 10,103 → 87 linhas (barrel) (**-99%**)

### O que os planos 04–07 produziram (03/08/2026)

| Pacote novo | Módulos | Linhas | Origem |
|-------------|---------|--------|--------|
| `backend/geometry/` | 20 | 3.002 | `geometry-errors.ts` (2.885) |
| `backend/cbers/` | 20 | 3.967 | `cbers-wpm.ts` (2.693) + `cbers-archive.ts` (1.105) |
| `backend/landsat/` | 13 | 1.737 | `landsat.ts` (1.621) |
| `backend/processar-projeto/` | 9 | 1.516 | `processar-projeto.ts` (1.489) |
| `backend/overlap/` | 9 | 1.408 | `overlap-analysis.ts` (1.364) |
| `backend/vertices-proximas/` | 9 | 1.156 | `vertices-proximas.ts` (1.104) |
| ~~`client/src/admin/`~~ | — | — | desmembrado e depois **removido** no mesmo dia (painel admin saiu do projeto) |
| `client/src/dashboard/panels/cbers/` | 4 | 1.034 | `CbersPanel.tsx` (927) |

**Ainda >500 linhas (fora do escopo dos planos 01–07):** 31 arquivos — os maiores
são `Dashboard.tsx` (7.371), `simcar/analysis.ts` (5.249),
`ProcessarProjetoAnalysis.tsx` (2.178) e `simcar/routes.ts` (1.722).

### ⚠️ Ressalva do item 9 (`simcar-oraculo/pipeline.ts`)

O plano previa quebrar `executePipeline` em `pipeline-steps/`. Ela é **uma única
função de 780 linhas montada sobre closures** (`persist`, `emit`, `checkCancelled`,
`planAndApply`… capturam ~10 variáveis mutáveis). Separar exigiria trocar as
closures por um objeto de contexto — refatoração de comportamento, não recorte —
no núcleo mais sensível do sistema, cujos testes ao vivo estão `skip` (dependem de
login real no SIMCAR). Foi extraído o que dava sem risco (`pipeline-support.ts`:
tipos públicos, dependências injetáveis e helpers puros), levando o arquivo de
1.187 → 991 linhas. A quebra de `executePipeline` fica registrada como trabalho
futuro, a fazer junto com cobertura de teste do orquestrador.

---

## 🗓️ Cronograma sugerido (4 semanas)

```
SEMANA 1 — Fundação (baixo risco):
  backend/index.ts + cbers-archive + Dashboard.tsx + landsat + overlap

SEMANA 2 — Pipelines (médio risco):
  cbers-wpm + processar-projeto + admin/main.tsx

SEMANA 3 — Núcleo SIMCAR (alto risco):
  simcar-clip.ts + geometry-errors.ts

SEMANA 4 — Opcionais:
  simcar-oraculo/pipeline + CbersPanel + vertices-proximas
```

---

## ⚠️ Princípios

1. **Nenhuma mudança funcional** — o comportamento externo continua idêntico
2. **Testes passam a cada passo** — `npx vitest run` depois de cada extração
3. **TypeScript compila** — `npx tsc --noEmit` não pode quebrar
4. **Commits atômicos** — 1 commit por módulo extraído
5. **Barrel exports** — cada nova pasta tem `index.ts` que re-exporta a API pública

---

## 🚫 O que NÃO fazer

- ❌ Alterar lógica de negócio durante o desmembramento
- ❌ Renomear funções públicas (quebraria imports externos)
- ❌ Remover código "só por enquanto" — se não usa, remove de vez
- ❌ Criar abstrações prematuras — extrair é diferente de refatorar
- ❌ Fazer tudo de uma vez — risco de merge hell e bugs difíceis de rastrear
