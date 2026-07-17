# Ops — GeoForest no PC servidor

**Última atualização:** 2026-07-17  
**Repo:** `alvaro209890/GeoForest-IA`  
**Path produção:** `/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA`

---

## URLs

| Serviço | URL |
|---------|-----|
| Front (Firebase Hosting) | https://ia-florestal.web.app |
| API (Cloudflare Tunnel) | https://geoforest-api.cursar.space |
| API local | http://127.0.0.1:3001 |

Tunnel Cloudflare (`~/.cloudflared/config.yml`):

```yaml
- hostname: geoforest-api.cursar.space
  service: http://127.0.0.1:3001
```

---

## Backend

| Item | Valor |
|------|--------|
| Unit systemd (user) | `geoforest-backend.service` |
| WorkingDirectory | repo no HD (path acima) |
| Entrypoint | `node dist/index.js` via `~/.config/geoforest/run-backend.sh` |
| EnvironmentFile | `~/.config/geoforest/backend.env` (**não versionado**) |
| Dados locais | `LOCAL_DATA_ROOT` → `.../Banco_de_dados/GeoForest` |

### Comandos

```bash
systemctl --user status geoforest-backend.service
systemctl --user restart geoforest-backend.service

# rebuild backend após mudança de código
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
npx esbuild backend/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist
systemctl --user restart geoforest-backend.service

curl -sS http://127.0.0.1:3001/api/health
curl -sS https://geoforest-api.cursar.space/api/health
```

### Env relevante (sem valores secretos)

```
PORT=3001
LOCAL_DATA_ROOT=.../Banco_de_dados/GeoForest
SIMCAR_CPF=...
SIMCAR_SENHA=...
SIMCAR_TEST_CAR_ID=271442
DEEPSEEK_API_KEY=...
SIMCAR_IMPORT_TIMEOUT_MS=900000   # 15 min (default no código se omitido)
SIMCAR_PROCESS_TIMEOUT_MS=1800000 # 30 min
```

---

## Oráculo SIMCAR

### CAR-teste operacional

| Campo | Valor |
|-------|--------|
| **Id** | **271442** |
| **Nome** | **Teste** |
| **Criado** | 2025-04-04 |
| **Município** | Querência |

Histórico: 270069 “Santa clara” foi o CAR das baterias de calibração (D1).  
**Produção no PC servidor usa 271442 Teste.** Todos os shapes do oráculo/Processar projeto
mutam **só** este CAR (`assertTestCarId`).

### Health (Bearer Firebase)

```
GET /api/simcar-oraculo/health
→ simcarConfigured, deepseekConfigured, testCarId, queueLength

GET /api/simcar-oraculo/test-project
→ Id, Nome, Situacao do CAR-teste
```

### Fila multi-usuário

- `enqueueSimcar` serializa mutações SEMA (1 sessão técnica).
- Segundo job recebe `queuePosition > 1` e timeline “Na fila…”.

### Robustez (2026-07-17)

1. **Timeout HTTP** de `ImportarArquivoShape` / `ProcessarGeo` = teto de poll (não 60s).
2. **Residual** AGUARDANDO/EXECUTANDO → cancel antes de reenviar.
3. **Login SIGA** instável → até 4 retries com backoff.
4. Abort vira mensagem `Timeout SIMCAR (Nms) em …`.

---

## Front

- Padrão **clássico**: `Dashboard` com sidebar (abas + cards de histórico).
- Layout Pencil (`DashboardLayout` / `Sidebar` de navegação) **removido**.
- Auto-update: `version.json` + `setupAutoUpdate` (sem Ctrl+F5 obrigatório).
- Deploy: `firebase deploy --only hosting:ia-florestal --project ia-florestal`

```bash
npm run build
firebase deploy --only hosting:ia-florestal --project ia-florestal --non-interactive
```

---

## Documentação relacionada

| Arquivo | Conteúdo |
|---------|----------|
| `docs/CHANGELOG_2026-07-17_SESSAO_GEOFORREST_ORACULO_LAYOUT.md` | Sessão completa (cards, layout, CAR Teste, falha oráculo) |
| `docs/CHANGELOG_2026-07-17_RESTAURA_LAYOUT_CLASSICO.md` | Restauração sidebar clássica |
| `docs/planos/simcar-oraculo-proxy/*` | Plano técnico oráculo (P0–P7) |
| `docs/OPS_SERVIDOR_GEOFORREST.md` | Este arquivo |

---

## Segurança

- Repo **público**: nunca commitar CPF/senha/chaves.
- Segredos só em `~/.config/geoforest/backend.env`.
- Mutação SEMA apenas no `SIMCAR_TEST_CAR_ID`.
