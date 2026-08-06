# Oráculo SIMCAR — backend no PC servidor

> # 🚫 FLUXO DESATIVADO PARA SEMPRE (decisão do Álvaro, 2026-08-05)
>
> **Este documento é histórico técnico.** O fluxo que ele descreve — GeoForest importa o
> ZIP do usuário no SIMCAR real com a **conta técnica do Álvaro** e devolve o resultado —
> está **desativado e não será reativado**. A interface saiu em 2026-07-21; as rotas
> `/api/simcar-oraculo/*` seguem registradas mas **não devem ser usadas nem religadas**.
>
> Motivo, estado do código e regras permanentes:
> [`FLUXO_ORACULO_SIMCAR_DESATIVADO.md`](FLUXO_ORACULO_SIMCAR_DESATIVADO.md).
>
> ⚠️ **Não apagar `backend/simcar-oraculo/client.ts`** — a aba **Lotes SIMCAR** (viva, e
> que usa a credencial do próprio usuário) depende dele. Leia como referência de
> endpoints da SEMA, não como instrução do que construir.

Módulo `backend/simcar-oraculo/`. O produto é **100% oráculo** (D2 — validação local removida):
o ZIP do usuário vai ao SIMCAR real (CAR-teste), importa/processa e devolve os artefatos
oficiais; reprova → autofix mecânico + DeepSeek em até 3 rodadas. **Não há mais modo LOCAL/HYBRID**
— o gate é só a presença das credenciais.

## O que já está pronto

| Peça | Status |
|------|--------|
| Config `SIMCAR_*` (gate por credenciais) | ✅ sem credencial, rotas de mutação respondem erro explícito |
| Scramble + login + get/post/download/upload | ✅ |
| Fila serial | ✅ |
| Import + Process no projeto-teste (API) | ✅ |
| `extractShapeContext` (bbox/centroid) + município/abrangência (prepare) | ✅ P2 |
| Rotas autenticadas + pipeline único + SSE | ✅ P3.5 |
| Preview no upload de processar-projeto | ✅ `testCarId`, `simcarConfigured`, `deepseekConfigured`, `shapePreview` |
| Front timeline completa (ORACULO-only) | ✅ P4 |
| Auto-fix import (5 ações + DeepSeek + loop) | ✅ P5 (V23 aprovado live) |
| Auto-fix process (clip úmida best-effort) | ✅ P6 — gate fechado via D7; contenção residual → `naoCorrigivel` (GIS) |

## Variáveis de ambiente (PC servidor)

```bash
SIMCAR_CPF=00000000000          # conta técnica (só dígitos)
SIMCAR_SENHA=********
DEEPSEEK_API_KEY=sk-...          # planner do autofix (fallback determinístico se ausente)
SIMCAR_TEST_CAR_ID=270069       # só este CAR recebe mutações
# SIMCAR_ROOT=https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api
# SIMCAR_POLL_MS=5000
```

Sem `SIMCAR_CPF`/`SIMCAR_SENHA` o backend não muta nada e o front mostra aviso de
"não configurado". **Nunca** commitar CPF/senha/chave (repo público).

## API

Todas exigem Bearer Firebase (mesmo `requireAuth` do resto).

| Método | Path | Descrição |
|--------|------|-----------|
| GET | `/api/simcar-oraculo/health` | mode, testCarId, configured, queue |
| GET | `/api/simcar-oraculo/test-project` | Buscar projeto-teste |
| POST | `/api/simcar-oraculo/importar` | `{ uploadId }` → job 202 |
| POST | `/api/simcar-oraculo/processar` | ProcessarGeo no CAR teste → job 202 |
| GET | `/api/simcar-oraculo/jobs/:jobId` | status do job |
| GET | `/api/simcar-oraculo/jobs/:jobId/pdf-import` | PDF SEMA |
| GET | `/api/simcar-oraculo/jobs/:jobId/pdf-process` | PDF process |
| GET | `/api/simcar-oraculo/jobs/:jobId/erros-zip` | ZIP erros (se houver) |
| POST | `/api/simcar-oraculo/shape-preview` | `{ uploadId \| zipBase64 }` |

Upload existente também devolve:

```json
{
  "uploadId": "...",
  "mode": "LOCAL",
  "testCarId": "270069",
  "simcarConfigured": false,
  "shapePreview": { "bbox": [...], "centroid": [...], "layers": [...] }
}
```

## Fluxo mínimo (API)

1. `POST /api/processar-projeto/upload` com `zipBase64`
2. `POST /api/simcar-oraculo/importar` com `{ uploadId }`
3. Poll `GET /api/simcar-oraculo/jobs/:jobId` até `status=completed|failed`
4. Baixar PDF se `pdfUrl`
5. Se import ok: `POST /api/simcar-oraculo/processar` + poll

## Smoke manual

```bash
export SIMCAR_CPF=... SIMCAR_SENHA=...
npx tsx backend/simcar-oraculo/scripts/smoke-buscar.ts 270069
```

## Testes

```bash
npx vitest run --root . backend/simcar-oraculo
# + regressão local
npx vitest run --root . backend/processar-projeto.test.ts
```

## Plano completo

`docs/planos/simcar-oraculo-proxy/` — ver `STATUS.md` para progresso.
