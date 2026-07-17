# STATUS do plano — Oráculo SIMCAR

**Atualizado:** 2026-07-16 (rodada de implementação Hermes)  
**Commit esperado:** feat simcar-oraculo P0/P1 no `main`

## Resumo

| Fase | Nome | Status |
|------|------|--------|
| **P0** | Módulo cliente + health + Buscar | ✅ **feito e validado** |
| **P1** | Import shape no projeto-teste + PDF | ✅ **API pronta** (live smoke login/buscar OK; import live não re-executado nesta rodada para não sobrescrever CAR teste) |
| **P2** | Município + área de abrangência | ⏳ **falta** |
| **P3** | ProcessarGeo + artefatos | ✅ **API pronta** (mesmo guardrail: não reprocessar live nesta rodada) |
| **P4** | Front timeline + desligar LOCAL | ⏳ **falta** (upload já devolve mode/shapePreview) |
| **P5** | Auto-fix import | ⏳ **falta** |
| **P6** | Auto-fix process | ⏳ **falta** |

## Feito nesta rodada (arquivos)

### Código

- `backend/simcar-oraculo/config.ts` — mode LOCAL default; ORACULO só com credencial
- `backend/simcar-oraculo/scramble-impl.js` + `scramble.ts`
- `backend/simcar-oraculo/client.ts` — login, get, post, download, upload
- `backend/simcar-oraculo/queue.ts` — fila serial
- `backend/simcar-oraculo/import-shape.ts`
- `backend/simcar-oraculo/process-geo.ts`
- `backend/simcar-oraculo/shape-context.ts`
- `backend/simcar-oraculo/routes.ts` — rotas `/api/simcar-oraculo/*`
- `backend/simcar-oraculo/index.ts`
- `backend/simcar-oraculo/scripts/smoke-buscar.ts`
- `backend/simcar-oraculo/simcar-oraculo.test.ts` — **8 testes**
- Wire: `backend/index.ts` (register + requireAuth paths)
- Wire: `backend/processar-projeto.ts` upload → `mode`, `testCarId`, `shapePreview`

### Docs

- `docs/SIMCAR_ORACULO.md`
- `docs/planos/simcar-oraculo-proxy/STATUS.md` (este arquivo)
- Plano original permanece em `00`–`10` + `INDEX.md`

## Validado

| Teste | Resultado |
|-------|-----------|
| `vitest backend/simcar-oraculo` | 8/8 PASS |
| `vitest backend/processar-projeto.test.ts` | 11/11 PASS (sem regressão LOCAL) |
| Live `smoke-buscar.ts 270069` | login OK; Nome Santa clara; Município Querência; status import FINALIZADO / process COM_PENDENCIA |

## Falta (próximas rodadas)

1. **P2** — descobrir endpoints de município/abrangência no bundle; `prepare-project.ts`
2. **P4** — UI em `ProcessarProjetoAnalysis.tsx` (timeline + botões import/process oráculo + downloads SEMA)
3. **Branch automático** — quando `PROCESSAR_MODE=ORACULO`, `POST .../importar` e `.../processar` usam SIMCAR em vez de `runImportPhase` (hoje são rotas separadas `/api/simcar-oraculo/*`)
4. **P5/P6** — autofix (ver `06-autofix-roadmap.md`)
5. Parse PDF SEMA → `errosResumo` estruturado no job
6. HYBRID: mostrar local + SEMA lado a lado

## Como ativar no PC servidor

```bash
export PROCESSAR_MODE=ORACULO
export SIMCAR_CPF=...
export SIMCAR_SENHA=...
export SIMCAR_TEST_CAR_ID=270069
# reiniciar backend (pm2/systemd)
```

## Decisão de segurança desta rodada

- Mutações só em `SIMCAR_TEST_CAR_ID`
- Default LOCAL se sem credencial (CI)
- Credenciais nunca no git
