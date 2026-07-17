# Changelog — 2026-07-17 — Sessão GeoForest (oráculo, layout, cards, CAR Teste)

Documento consolidado de tudo que foi feito nesta sessão no repositório
`GeoForest-IA` (path de produção: `/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA`).

---

## 1. Objetivo da sessão

- Sincronizar repo com GitHub e manter backend local + tunnel Cloudflare
  (`geoforest-api.cursar.space` → `127.0.0.1:3001`) a serviço do front Firebase
  (`ia-florestal.web.app`).
- Fechar ops do oráculo SIMCAR (credenciais só em env do servidor, fila serial,
  health `simcarConfigured` / `deepseekConfigured`).
- Restaurar **cards de histórico** (recortes, CBERS, Landsat, erros, processar,
  recibos) que tinham sumido no front.
- Usar o projeto SIMCAR correto de teste (nome **Teste**, não Santa clara).
- Documentar e publicar no `main`.

---

## 2. Backend e ops

| Item | Resultado |
|------|-----------|
| Repo | `main` alinhado com `origin` (`alvaro209890/GeoForest-IA`) |
| Serviço | `geoforest-backend.service` (user systemd) → `dist/index.js` |
| Env | `~/.config/geoforest/backend.env` (nunca commitado) |
| Credenciais SIMCAR | `SIMCAR_CPF` / `SIMCAR_SENHA` no env do servidor |
| DeepSeek | `DEEPSEEK_API_KEY` carregada do Hermes para o env do backend |
| Tunnel | Cloudflare: `geoforest-api.cursar.space` → porta 3001 |
| Health | `GET /api/health` → `{"ok":true}` local e via tunnel |
| Oráculo health | `simcarConfigured: true`, `deepseekConfigured: true` |
| Fila exclusividade | `enqueueSimcar` serial; segundo job recebe `queuePosition` > 1 |

### CAR-teste do oráculo (atualizado nesta sessão)

| Campo | Valor |
|-------|--------|
| **Id** | **271442** |
| **Nome** | **Teste** |
| **Criado** | 2025-04-04 13:25:33 |
| **Município** | Querência |
| **Situação** | `[EM_CADASTRAMENTO]` |

- Env: `SIMCAR_TEST_CAR_ID=271442`
- Default em `backend/simcar-oraculo/config.ts` e `config/geoforest-backend.env.example`
- **Antes:** 270069 / Santa clara (decisão D1 das baterias de calibração; permanece
  na conta, mas **não** é mais o destino dos imports do produto)

Listagem confirmada via `POST /Requerimento/ListarRasc` com body completo do app
SEMA (`Filtros` + `ItensPorPagina` + `Pagina` + `ColunaOrdenar` + `Colunas`).

Todos os shapes importados pela funcionalidade oráculo / Processar projeto no
backend vão para o CAR **271442 (Teste)**.

---

## 3. Front — cards de histórico e layout clássico

### Problema
O redesign Pencil (v2.14) introduziu `DashboardLayout` + `Sidebar` de navegação e
o `DashboardRouter` montava:

```tsx
<Dashboard hideSidebar />  // hideSidebar === true
```

Isso **escondia a sidebar clássica** do `Dashboard`, onde vivem as abas e os
**cards salvos** (SIMCAR, CBERS, Landsat, erros, processar, recibos). Os dados
continuavam no storage local (`LOCAL_DATA_ROOT/.../users/<uid>/simcar_clips` etc.).

### Correção
1. `DashboardRouter` volta a montar **somente** o `Dashboard` clássico
   (path → `initialView`).
2. Removidos `client/src/components/layout/DashboardLayout.tsx` e
   `client/src/components/layout/Sidebar.tsx`.
3. Botões “Novo Recorte / Nova Imagem / …” com **um único ícone Plus**
   (removido botão em anel `p-[1px]` que gerava aparência de “++”).
4. Auto-update: `version.json` + `setupAutoUpdate` (primeira checagem ~8s;
   HTML/`version.json` com `Cache-Control: no-cache` no Firebase).

### Deploy front
- Firebase Hosting site **ia-florestal**
- URL: https://ia-florestal.web.app

---

## 4. Oráculo / plano (contexto já no main)

Fases P0–P6 do plano `docs/planos/simcar-oraculo-proxy/*` já estavam no código;
nesta sessão o foco foi **ops + front + CAR-teste correto** (P7/T19 operacional):

- Pipeline upload → prepare → import → process no CAR configurado
- Fila serial multi-usuário
- E2E anterior usou fixture Santa Clara no 270069; **daqui em diante** mutações
  de produto usam **271442 Teste**

---

## 5. Arquivos / commits relevantes (main)

Exemplos (histórico da sessão; ver `git log`):

- `fix(dashboard): restaura cards de histórico visíveis na sidebar`
- `fix(front): restaura sidebar com cards…` / remove Pencil layout
- `ops(simcar-oraculo): CAR-teste passa a ser projeto Teste (271442)`
- Docs: este arquivo + `CHANGELOG_2026-07-17_RESTAURA_LAYOUT_CLASSICO.md`

---

## 6. Como operar no PC servidor

```bash
# reiniciar backend
systemctl --user restart geoforest-backend.service

# health
curl -sS http://127.0.0.1:3001/api/health
curl -sS https://geoforest-api.cursar.space/api/health

# oráculo (com Bearer Firebase)
# GET /api/simcar-oraculo/health  → testCarId 271442, simcarConfigured true
# GET /api/simcar-oraculo/test-project → Nome "Teste"
```

Env (não versionado): `~/.config/geoforest/backend.env`

```
SIMCAR_CPF=…
SIMCAR_SENHA=…
SIMCAR_TEST_CAR_ID=271442
DEEPSEEK_API_KEY=…
LOCAL_DATA_ROOT=/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest
PORT=3001
```

---

## 7. Segurança

- Repo **público**: CPF/senha/chaves **nunca** no git.
- Mutações SEMA só no `SIMCAR_TEST_CAR_ID` (`assertTestCarId`).
