# Oráculo SIMCAR — backend no PC servidor

Implementação parcial (rodada 2026-07-16): módulo `backend/simcar-oraculo/`.

## O que já está pronto

| Peça | Status |
|------|--------|
| Config `PROCESSAR_MODE` / `SIMCAR_*` | ✅ default **LOCAL** (seguro CI); ORACULO só com credenciais |
| Scramble + login + get/post/download/upload | ✅ |
| Fila serial | ✅ |
| Import + Process no projeto-teste (API) | ✅ |
| `extractShapeContext` (bbox/centroid) | ✅ |
| Rotas autenticadas | ✅ |
| Preview no upload de processar-projeto | ✅ `mode`, `testCarId`, `shapePreview` |
| Município / abrangência (prepare) | ❌ P2 |
| Front timeline completa | ❌ P4 |
| Auto-fix | ❌ P5/P6 |
| Branch importar/processar LOCAL→ORACULO automático | ❌ (use rotas `/api/simcar-oraculo/*`) |

## Variáveis de ambiente (PC servidor)

```bash
# Opcional — default LOCAL se omitido
PROCESSAR_MODE=ORACULO          # LOCAL | ORACULO | HYBRID

SIMCAR_CPF=00000000000
SIMCAR_SENHA=********
SIMCAR_TEST_CAR_ID=270069       # só este CAR recebe mutações
# SIMCAR_ROOT=https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api
# SIMCAR_POLL_MS=5000
```

**Nunca** commitar CPF/senha.

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
