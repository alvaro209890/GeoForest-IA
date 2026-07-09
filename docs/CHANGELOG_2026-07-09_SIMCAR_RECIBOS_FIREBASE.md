# GeoForest IA - Recibos SIMCAR e Firebase Hosting

**Data:** 2026-07-09
**Branch:** `main`
**Repositorio:** https://github.com/alvaro209890/GeoForest-IA
**Hosting publicado:** `https://ia-florestal.web.app` e `https://geoforest-admin.web.app`

---

## Resumo

Este release adiciona uma aba de recibos SIMCAR no dashboard, permitindo consultar CARs por CPF e/ou numero do CAR e baixar o PDF do recibo correto. Tambem ajusta o cache do Firebase Hosting para que usuarios recebam a versao nova do app sem precisar usar Ctrl+F5.

---

## Atualizacao do repositorio

- O checkout local foi atualizado com `git pull --ff-only` antes das mudancas.
- Base sincronizada de `origin/main`.
- As mudancas foram preparadas para envio direto ao branch `main`, conforme solicitado.

---

## Backend - Recibos SIMCAR

Arquivo principal: `backend/simcar-receipts.ts`

Novas rotas:

| Metodo | Rota | Funcao |
|---|---|---|
| `POST` | `/api/simcar/receipts/search` | Consulta requerimentos/recibos no SIMCAR publico da SEMA-MT |
| `GET` | `/api/simcar/receipts/download/:id` | Baixa o PDF oficial do recibo pelo Id do requerimento |

Detalhes implementados:

- A busca aceita `cpf` e `carNumber`.
- O CPF e normalizado para 11 digitos.
- O numero do CAR aceita formato estadual, por exemplo `MT274719/2025`.
- O recibo federal tambem e aceito quando vier no formato `MT-...`.
- Quando o portal usa o campo oficial com erro de grafia (`NUMERO_CAR_FERERAL`), o backend preserva esse nome porque e o que a API publica espera.
- O download usa `DownloadReciboCar/{Id}` com o `Id` do requerimento, nao o `RId`.
- O arquivo baixado e validado pelo cabecalho `%PDF-` antes de ser enviado ao navegador.
- As rotas foram registradas em `backend/index.ts` e protegidas pelo mesmo `requireAuth` das ferramentas autenticadas.

Fonte consultada pelo backend:

```text
https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api/Publico
```

---

## Frontend - Aba Recibos

Arquivos:

- `client/src/components/SimcarReceiptDownloader.tsx`
- `client/src/pages/Dashboard.tsx`

Mudancas:

- Nova aba `Recibos` no seletor lateral do dashboard.
- Formulario com CPF e numero do CAR.
- Busca autenticada via `apiFetch`.
- Listagem de todos os CARs encontrados.
- Se um CPF retornar mais de um CAR, o usuario escolhe qual recibo baixar.
- Botao para baixar o recibo selecionado.
- Botao por item para baixar diretamente um recibo especifico.
- Nome de arquivo PDF gerado com Id do requerimento, numero do CAR e nome do imovel.

---

## Build no Windows

Arquivos:

- `scripts/build-admin.mjs`
- `scripts/dev-server.mjs`
- `package.json`

Motivo:

- Os scripts antigos usavam atribuicao de variavel de ambiente no formato POSIX, por exemplo `GEOFOREST_BUILD_TARGET=admin`, que quebra no PowerShell/cmd do Windows.

Mudancas:

- `npm run build:admin` agora chama `node scripts/build-admin.mjs`.
- `npm run dev:server` agora chama `node scripts/dev-server.mjs`.
- O build completo continua gerando:
  - `dist/public`
  - `dist/admin`
  - `dist/index.js`

---

## Firebase Hosting - Cache sem Ctrl+F5

Arquivo: `firebase.json`

Problema encontrado:

- A configuracao anterior aplicava `no-cache` apenas em `*.html`.
- Como o Firebase aplica headers usando a URL requisitada antes do rewrite, uma rota SPA como `/dashboard` nao necessariamente recebia o header de HTML.
- Isso podia deixar usuarios presos em uma versao antiga do app ate forcar Ctrl+F5.

Politica atual:

| URL/arquivo | Cache-Control |
|---|---|
| Rotas sem extensao, ex. `/`, `/dashboard` | `no-cache, no-store, max-age=0, must-revalidate` |
| `*.html` | `no-cache, no-store, max-age=0, must-revalidate` |
| `*.js` e `*.css` com hash do Vite | `public, max-age=31536000, immutable` |
| Imagens/fontes | `public, max-age=604800` |
| Manifest/XML/TXT | `public, max-age=3600` |

Sites cobertos:

- `ia-florestal`
- `geoforest-admin`

Validacao em producao apos deploy:

```text
https://ia-florestal.web.app/dashboard
Cache-Control: no-cache, no-store, max-age=0, must-revalidate

https://ia-florestal.web.app/index.html
Cache-Control: no-cache, no-store, max-age=0, must-revalidate

https://ia-florestal.web.app/assets/Dashboard-BWTzkRxS.js
Cache-Control: public, max-age=31536000, immutable

https://geoforest-admin.web.app/
Cache-Control: no-cache, no-store, max-age=0, must-revalidate

https://geoforest-admin.web.app/assets/admin-D-Z_VzpB.js
Cache-Control: public, max-age=31536000, immutable
```

---

## Deploy executado

Comando:

```bash
firebase deploy --only hosting
```

Resultado:

- `ia-florestal`: 38 arquivos publicados em `dist/public`.
- `geoforest-admin`: 31 arquivos publicados em `dist/admin`.
- Deploy finalizado com sucesso.
- URLs publicadas:
  - https://ia-florestal.web.app
  - https://geoforest-admin.web.app

---

## Validacoes executadas

```bash
npm run check
npm run build
firebase deploy --only hosting
curl.exe -sI https://ia-florestal.web.app/dashboard
curl.exe -sI https://ia-florestal.web.app/index.html
curl.exe -sI https://ia-florestal.web.app/assets/Dashboard-BWTzkRxS.js
curl.exe -sI https://geoforest-admin.web.app/
curl.exe -sI https://geoforest-admin.web.app/assets/admin-D-Z_VzpB.js
```

Resultados:

- TypeScript: sem erros.
- Build publico: sucesso.
- Build admin: sucesso.
- Bundle backend: sucesso.
- Firebase Hosting: deploy concluido.
- Headers de cache em producao: confirmados.

Teste funcional local feito antes do deploy:

- A rota de busca retornou um requerimento SIMCAR valido para filtros reais.
- A rota de download retornou PDF valido com cabecalho `%PDF-`.

---

## Observacao sobre o backend publico

O frontend publicado no Firebase redireciona `/api/*` para:

```text
https://geoforest-api.cursar.space/api/*
```

Nesta execucao, a checagem sem token em:

```bash
curl.exe -X POST https://geoforest-api.cursar.space/api/simcar/receipts/search
```

retornou:

```text
404 Cannot POST /api/simcar/receipts/search
```

Isso indica que o servidor publico da API ainda nao estava rodando o backend novo no momento da verificacao. Para ativar a aba em producao ponta a ponta, o servidor Linux que hospeda `geoforest-backend.service` precisa puxar `main` e reiniciar o backend:

```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git pull --ff-only origin main
npm run build
systemctl --user restart geoforest-backend.service
```

O projeto ja possui o script operacional:

```bash
scripts/deploy-firebase-restart-backend.sh
```

que faz pull, build, deploy Firebase, restart do backend e push quando executado no ambiente Linux do servidor.
