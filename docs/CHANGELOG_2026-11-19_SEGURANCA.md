# Endurecimento de segurança do GeoForest — 2026-11-19

> Autor: OpenCode-windows | 19/11/2026. Auditoria feita no **checkout de produção**
> (`/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA`, `main` = `e62e0b7a` antes
> deste commit) com a API respondendo 200 em `https://geoforest-api.cursar.space/api/health`.

## Regra que vale para tudo aqui

Nada nesta mudança altera autenticação de usuário, sessão do Firebase, contrato de
nenhuma rota usada pelo app ou formato de arquivo salvo. O objetivo foi **fechar
exposição sem derrubar ninguém**: todas as rotas que o painel chama continuam
aceitando exatamente as mesmas requisições (o painel já mandava `Authorization`).

## O que foi encontrado

| # | Achado | Risco |
|---|---|---|
| 1 | `/api/storage` servia **qualquer** arquivo do storage, inclusive `users/<uid>/profile.json`, `settings/preferences.json`, `conversations/*.json` e `*_jobs/*.json` | Leitura de e-mail, CREA e metadados de job por quem tivesse a URL |
| 2 | `/api/upload-image` aceitava qualquer MIME e usava a extensão do MIME no nome do arquivo | `data:text/html` virava `.html` servido em `/api/storage` → XSS armazenado no domínio da API |
| 3 | `/api/upload-file` usava o nome de arquivo cru do cliente no path | Nome com `../` (mitigado hoje pelo `safeSegment`, mas sem validação de PDF) |
| 4 | `/api/apf/search` e `/api/apf/download` **sem auth** | Consulta de CPF/CNPJ e download de documento com a IP do server |
| 5 | Nenhum rate limit em `/api/*` | Qualquer um derrubava o server com `POST /api/simcar/clip` (25 MB de ZIP) ou enchia disco |
| 6 | Nenhum cabeçalho de segurança (`nosniff`, HSTS, frame-ancestors, referrer) | Clickjacking, sniffing de MIME, vazamento de URL de job via Referer |
| 7 | Rotas `/api/simcar-oraculo/*` continuavam registradas (fluxo desativado em 05/08/2026) | Uso da conta técnica da SEMA — **3 senhas erradas suspendem a conta** |
| 8 | Rota `/api/*` inexistente caía no catch-all do SPA e devolvia `index.html` com 200 | App tentava parsear HTML como JSON; sondagem da API ficava ambígua |
| 9 | `X-Powered-By: Express` exposto | Fingerprint |

## O que mudou

### Novos módulos

| Arquivo | O que faz |
|---|---|
| `backend/middleware/security-headers.ts` | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, HSTS quando `x-forwarded-proto: https`; CSP `script-src 'none'` nos arquivos servidos de `/api/storage` e `/api/raster*` |
| `backend/middleware/rate-limit.ts` | Rate limit em memória (sem dependência): balde geral em `/api` e balde `heavy` nas rotas caras. IP real vem de `CF-Connecting-IP` → `X-Forwarded-For` → `X-Real-IP` → socket. Chamada **direta local** (script no próprio server, sem headers de proxy) não é limitada |
| `backend/middleware/storage-guard.ts` | Bloqueia dotfiles e os JSON de `profile.json`, `settings/`, `conversations/`, `simcar_clips/`, `receipts/` e `*_jobs/` em `/api/storage`. Mantém `/simcar/context/*.json`, que as fases pós-recorte baixam |

### Rotas protegidas

- `AUTH_REQUIRED_PATHS` ganhou `/api/apf/search` e `/api/apf/download`.
  O painel (`client/src/components/ApfReceiptDownloader.tsx`) já chama as duas por
  `apiFetch`, então o usuário logado não percebe nada.

### Endurecimento de upload

- Imagem: só `image/png`, `image/jpeg`, `image/webp`, `image/gif` (extensão vem de uma
  tabela fixa, nunca do MIME cru). SVG/HTML são recusados com `400 UNSUPPORTED_IMAGE_TYPE`.
- PDF: assinatura `%PDF-` obrigatória, nome normalizado com `path.basename` e teto de 25 MB.
- Ambos: teto de 25 MB no buffer decodificado (`413`).

### Oráculo SIMCAR

`/api/simcar-oraculo/*` responde `410 ORACULO_DISABLED` antes de chegar ao registro de rotas.
`backend/simcar-oraculo/client.ts` **não foi tocado** — a aba **Lotes** continua usando a
sessão SEMA do usuário. Para religar (não recomendado): `SIMCAR_ORACULO_ROUTES_ENABLED=1`.

### API 404

`/api/*` sem rota agora responde JSON `404 {"code":"NOT_FOUND"}`, em vez de `index.html`.

## Configuração (tudo opcional, defaults seguros)

Coloque em `~/.config/geoforest/backend.env` só se precisar mudar:

| Variável | Default | Efeito |
|---|---|---|
| `RATE_LIMIT_ENABLED` | `1` | `0` desliga o rate limit |
| `RATE_LIMIT_GENERAL_PER_MIN` | `3000` | requisições/min por IP em `/api` |
| `RATE_LIMIT_HEAVY_PER_MIN` | `60` | requisições/min por IP nas rotas caras |
| `RATE_LIMIT_WINDOW_MS` | `60000` | janela |
| `SIMCAR_ORACULO_ROUTES_ENABLED` | `0` | `1` volta a registrar as rotas do oráculo |

Rotas classificadas como **caras** (balde de 60/min): `chat`/`chat-stream`, uploads,
`/api/simcar/clip*`, `simcar-lotes/process|parse-recibos`, busca/estimate/jobs de
Landsat/CBERS/NDVI, `*/wms-download`, `map/snapshot`, `map/intersection-hectares`,
`geometry/bbox`, `apf/search|download`, `upload|process|processar|importar` dos sete
grupos de job, `solicitacao-prioridade/process` e `auas-sccon/process`.

## O que **não** foi mudado (de propósito)

| Item | Por quê |
|---|---|
| Cadastro público (`createUserWithEmailAndPassword`) | Desligar agora bloquearia gente nova e é decisão do Álvaro. **Recomendação:** desabilitar signup no Firebase Console > Authentication > Settings, ou restringir por domínio de e-mail |
| `POST /api/simcar/clip` sem token | Documentado e usado pelos scripts do escritório (recorte em lote). Ficou com rate limit de 60/min. Para exigir token: ver seção "Próximo passo" |
| `/api/raster` e `/api/raster-ndvi` públicos | São tiles de satélite; não têm dado de usuário |
| `/api/runtime/version` público | O painel usa para detecção de recurso; não expõe segredo (só booleanos e nomes de modelo) |
| `/api/models` público | O painel chama com `{ auth: false }` de propósito |

## Verificação (rodar no server depois do deploy)

```bash
# cabeçalhos
curl -sI https://geoforest-api.cursar.space/api/health | grep -Ei 'x-content-type|x-frame|referrer|permissions|strict-transport'

# 404 JSON (não HTML)
curl -s https://geoforest-api.cursar.space/api/nao-existe

# perfil não é mais público
curl -s -o /dev/null -w '%{http_code}\n' https://geoforest-api.cursar.space/api/storage/users/qualquer/profile.json

# APF sem token = 401
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://geoforest-api.cursar.space/api/apf/search -H 'Content-Type: application/json' -d '{}'

# oráculo desligado = 410 (mesmo com token válido)
curl -s https://geoforest-api.cursar.space/api/simcar-oraculo/health

# rate limit se anuncia
curl -sI https://geoforest-api.cursar.space/api/health | grep -i ratelimit
```

## Testes

`backend/middleware/*.test.ts` — 16 casos cobrindo: IP real atrás do tunnel, baldes
separados por IP, rota cara vs. barata, HSTS só em HTTPS, CSP de arquivo de usuário e
a lista de paths privados do storage. Suíte completa do backend: 972 passando, 8 pulados.

## Deploy

Mudança **só de backend** — não precisa `firebase deploy`. No server:

```bash
cd '/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA'
git fetch origin && git reset --hard origin/main
export PATH="/home/server/.nvm/versions/node/v20.20.0/bin:$PATH"
pnpm build
systemctl --user restart geoforest-backend.service
```

O `geoforest-autosync.timer` continua **desabilitado** (decisão de 16/10/2026).
