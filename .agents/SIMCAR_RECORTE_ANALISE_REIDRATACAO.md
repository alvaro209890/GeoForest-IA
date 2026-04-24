# SIMCAR / Recorte da Base - Download e Reidratação da Análise IA

## Problema corrigido

O recorte SIMCAR gera um `jobId` e mantém o contexto do processamento em cache de memória no backend. Quando o backend reinicia, esse cache desaparece. Antes da correção, a análise IA podia falhar com:

`Job nao encontrado no cache do servidor. Envie contextUrl salvo no Firebase/Cloudinary para reidratar ou gere o recorte novamente.`

Também havia risco de URLs relativas como `/api/storage/...` serem abertas pelo domínio do Firebase Hosting (`ia-florestal.web.app`) em vez da API (`geoforest-api.cursar.space`), causando página 404.

## Comportamento esperado

1. Todo arquivo salvo no banco local deve ficar em:
   `/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest/users/<uid>/...`

2. Novos arquivos retornam `publicUrl` absoluto:
   `https://geoforest-api.cursar.space/api/storage/users/<uid>/...`

3. O backend não deve depender só do `jobCache` em memória para rodar análise IA.

4. Ao receber `/api/simcar/clip/analyze` ou `/api/simcar/clip/analyze-auas`, o backend tenta reidratar o job nesta ordem:
   - `jobCache`
   - `contextUrl` enviado pelo frontend
   - `outputZipUrl` enviado pelo frontend
   - documento persistido em `users/*/simcar_clips/<jobId>.json`
   - `contextUrl` ou `outputZipUrl` encontrados nesse documento

5. URLs relativas antigas (`/api/storage/...`) devem ser convertidas para a API pública antes de `fetch()`.

## Arquivos relevantes

- `backend/simcar-clip.ts`
  - `hydrateCachedJob`
  - `getPersistedHydrationUrls`
  - `hydrateJobFromPersistedContext`
  - `hydrateJobFromOutputZipUrl`
  - endpoints `/api/simcar/clip/analyze` e `/api/simcar/clip/analyze-auas`

- `backend/local-storage.ts`
  - `saveUserBuffer`
  - `storageUrlToRelativePath`
  - URLs públicas absolutas para `/api/storage/...`

- `client/src/pages/Dashboard.tsx`
  - normalização de URLs de download/contexto
  - botões de download do recorte

- `firebase.json`
  - redirect de `/api/:path*` para `https://geoforest-api.cursar.space/api/:path`
  - cache desativado para evitar bundle antigo no navegador

## Validação mínima

Depois de alterar esse fluxo:

```bash
npm run check
npm run build
```

Reiniciar backend e validar:

```bash
curl -s https://geoforest-api.cursar.space/api/health
curl -s https://geoforest-api.cursar.space/api/wfs/health
```

Validar download antigo via Firebase:

```bash
curl -sS -L -I 'https://ia-florestal.web.app/api/simcar/clip/download/<jobId>'
```

O resultado final deve terminar com:

`HTTP/2 200`

e:

`content-type: application/zip`

## Regra de manutenção

Não reintroduzir dependência exclusiva do `jobCache` para análise IA. Qualquer nova etapa que use `jobId` precisa aceitar reidratação por contexto/ZIP persistido no banco local.
