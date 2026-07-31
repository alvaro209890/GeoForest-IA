# Plano: Desmembramento de `backend/index.ts`

**Arquivo atual:** `backend/index.ts` — 2,956 linhas
**Objetivo:** Separar rotas, middlewares e configuração em arquivos independentes

---

## Estrutura proposta

```
backend/
├── index.ts                   # bootstrap (~80 linhas)
├── app.ts                     # factory: cria Express app com middlewares (~50 linhas)
├── config.ts                  # constantes: porta, CORS origins, firebase config (~40 linhas)
├── routes/
│   ├── _registry.ts           # função registerAllRoutes(app) — importa e registra tudo (~30 linhas)
│   ├── cbers.ts               # GET/POST /api/cbers/* (~250 linhas)
│   ├── simcar.ts              # POST /api/simcar/* (~200 linhas)
│   ├── croqui.ts              # POST /api/croqui/* (~150 linhas)
│   ├── receipts.ts            # /api/simcar/receipts/* + /api/apf/* (~150 linhas)
│   ├── oraculo.ts             # /api/simcar-oraculo/* (~150 linhas)
│   ├── admin.ts               # /api/admin/* (~150 linhas)
│   ├── billing.ts             # /api/billing/* (~100 linhas)
│   ├── overlap.ts             # /api/overlap/* (~80 linhas)
│   ├── auas.ts                # /api/auas-sccon/* (~80 linhas)
│   ├── knowledge.ts           # /api/knowledge/* (~80 linhas)
│   ├── processar-projeto.ts   # /api/processar-projeto/* (~100 linhas)
│   ├── vertices.ts            # /api/vertices-proximas/* (~60 linhas)
│   └── health.ts              # GET /api/health, /api/ping (~30 linhas)
├── middleware/
│   ├── auth.ts                # requireAuth + populateAuth (~80 linhas)
│   ├── admin-auth.ts          # requireAdmin (~40 linhas)
│   ├── cors.ts                # CORS config (~30 linhas)
│   ├── error-handler.ts       # global error handler (~60 linhas)
│   ├── ssrf-guard.ts          # SSRF whitelist (~60 linhas)
│   └── request-logger.ts      # Morgan/logging (~40 linhas)
└── __tests__/
    └── routes.test.ts         # testes de integração das rotas (~300 linhas)
```

---

## Mapeamento: o que vai pra onde

### `config.ts`
- `PORT`, `HOST`
- `CORS_ORIGINS` (array)
- Firebase config (projectId, etc.)
- `SIMCAR_BASE_URL`
- `isProduction` flag

### `app.ts`
- `createApp()` — factory que retorna Express app
- Aplica `cors()`, `express.json()`, `morgan()`
- Aplica middlewares globais (ssrf-guard, request-logger)
- **NÃO** registra rotas (isso fica no `index.ts` ou `_registry.ts`)

### `middleware/auth.ts`
- `requireAuth` middleware atual (verify Firebase token → `req.authUid`)
- `optionalAuth` (não bloqueia se não tiver token)

### `middleware/ssrf-guard.ts`
- Bloco atual de whitelist de paths
- Função `isWhitelisted(path)` 
- Middleware que bloqueia requests não-whitelistados para URLs internas

### `middleware/error-handler.ts`
- Handler global de erros (atual `app.use((err, req, res, next) => ...)`)
- Mapeamento de erros conhecidos → HTTP status codes

### `routes/_registry.ts`
```typescript
import { Express } from 'express';
import { registerCbersRoutes } from './cbers';
import { registerSimcarRoutes } from './simcar';
// ... todos os outros

export function registerAllRoutes(app: Express) {
  registerCbersRoutes(app);
  registerSimcarRoutes(app);
  // ...
}
```

### `index.ts` (novo, enxuto)
```typescript
import { createApp } from './app';
import { registerAllRoutes } from './routes/_registry';
import { PORT } from './config';

const app = createApp();
registerAllRoutes(app);

app.listen(PORT, () => {
  console.log(`GeoForest API rodando na porta ${PORT}`);
});
```

---

## Passo a passo da migração

### Passo 1: Criar estrutura de pastas
- Criar `backend/routes/`, `backend/middleware/`
- Criar `backend/config.ts`, `backend/app.ts`

### Passo 2: Extrair middlewares (sem quebrar nada)
- Copiar `requireAuth` → `middleware/auth.ts`
- Copiar SSRF whitelist → `middleware/ssrf-guard.ts`
- Copiar error handler → `middleware/error-handler.ts`
- No `index.ts` original, trocar implementações inline por imports
- **Testar:** `npm run dev:server` + bater em algumas rotas

### Passo 3: Extrair rotas (uma por vez)
- Começar pela menor: `health.ts`
- Depois `auas.ts`, `knowledge.ts`, `overlap.ts`
- Depois `billing.ts`, `receipts.ts`
- Depois `cbers.ts`, `simcar.ts`, `croqui.ts`
- Depois `oraculo.ts`, `admin.ts`
- A cada extração: **testar a rota** com curl

### Passo 4: Criar `_registry.ts`
- Consolidar todos os `register*Routes` num arquivo só
- Simplificar `index.ts` pra versão enxuta

### Passo 5: Limpeza
- Remover código comentado do `index.ts` original
- Garantir que `git blame` não se perdeu (usar `git mv` ou commits separados)

---

## ⚠️ Cuidados

### SSRF whitelist e auth whitelist
O `index.ts` tem DOIS blocos críticos:
1. **SSRF whitelist** — paths que podem receber upload/processamento
2. **Auth middleware** — paths que precisam de `requireAuth`

Rotas NOVAS precisam ser adicionadas nos DOIS. Ao extrair, manter comentário bem visível:
```typescript
// ⚠️ ATUALIZAR SSRF_WHITELIST e AUTH_WHITELIST ao adicionar rotas novas
```

### Ordem dos middlewares
A ordem atual é:
1. CORS
2. JSON body parser
3. SSRF guard
4. Request logger
5. Auth middleware (com whitelist)
6. Rotas
7. Error handler

**NÃO alterar essa ordem** ao extrair.

### Importações circulares
Rotas importam funções de `../simcar-clip`, `../geometry-errors`, etc.
Esses imports **não mudam** — só o arquivo de origem muda. Nenhum risco de circular.

---

## Como validar após cada passo

```bash
# 1. TypeScript compila?
npx tsc --noEmit

# 2. Servidor sobe?
npx tsx backend/index.ts &
sleep 3
curl http://localhost:3001/api/health

# 3. Rotas críticas funcionam?
curl -X POST http://localhost:3001/api/cbers/search -H 'Content-Type: application/json' -d '{"lat":-12,"lng":-55}'
curl -X POST http://localhost:3001/api/croqui/upload ...

# 4. Auth funciona?
curl http://localhost:3001/api/admin/stats  # deve dar 401
```

---

## Estimativa de esforço

| Passo | Tempo | Risco |
|-------|-------|-------|
| Criar estrutura + config.ts + app.ts | 10 min | Baixo |
| Extrair middlewares | 15 min | Baixo |
| Extrair rotas (1 por vez, ~13 rotas) | 45 min | Médio |
| Criar `_registry.ts` + simplificar `index.ts` | 10 min | Baixo |
| Limpeza + teste final | 15 min | Baixo |
| **Total** | **~1.5 h** | |
