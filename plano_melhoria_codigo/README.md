# Plano de Melhoria de Código — GeoForest-IA

**Criado:** 2026-07-31
**Status:** 📋 Planejamento — nenhuma alteração no código

---

## 📂 Documentos do plano

| # | Arquivo | Assunto | Linhas atuais | Módulos propostos |
|---|---------|---------|---------------|-------------------|
| 01 | [01_backend_index.md](01_backend_index.md) | `backend/index.ts` — servidor Express | 2,956 | 16 arquivos |
| 02 | [02_simcar_clip.md](02_simcar_clip.md) | `backend/simcar-clip.ts` — recorte SIMCAR | 10,103 | 11 arquivos |
| 03 | [03_dashboard.md](03_dashboard.md) | `client/.../Dashboard.tsx` — dashboard | 9,765 | 10 arquivos |
| 04 | [04_geometry_errors.md](04_geometry_errors.md) | `backend/geometry-errors.ts` — detectores | 2,885 | 10 arquivos |
| 05 | [05_cbers_wpm.md](05_cbers_wpm.md) | `backend/cbers-wpm.ts` — pipeline CBERS | 2,693 | 9 arquivos |
| 06 | [06_landsat.md](06_landsat.md) | `backend/landsat.ts` — pipeline Landsat | 1,621 | 7 arquivos |
| 07 | [07_arquivos_medios.md](07_arquivos_medios.md) | 7 arquivos médios (500–1500 linhas) | ~8,500 | ~31 arquivos |

---

## 📊 Números gerais

| Métrica | Antes | Depois |
|---------|-------|--------|
| Arquivos monólito (>500 linhas) | **16** | **0** |
| Módulos bem divididos | ~30 | **~124** |
| Média de linhas por arquivo | ~400 | **~150** |
| Arquivo mais longo | 10,103 linhas | ~400 linhas |

**Redução do maior arquivo:** 10,103 → ~400 linhas (**-96%**)

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
