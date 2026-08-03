# CHANGELOG — Template fixo de abertura do croqui (03/08/2026)

## Mudança

Todo croqui agora inicia com o template fixo:

> O presente croqui se inicia na cidade **{município}** no ponto **{DMS}** seguindo pela **{via}** no sentido **{sentido}**.

Depois disso o roteiro continua como antes (trechos "Siga em frente por X km até o ponto Y", manobras, destino).

## O que mudou

- `backend/croqui/narrative.ts` — `introPhrase()` reescrita: abertura com cidade + ponto + via + sentido.
- `backend/croqui/coords.ts` — novas funções `bearingDegrees()` (rumo entre 2 pontos) e `sentidoCardeal()` (8 direções: norte, nordeste, leste, sudeste, sul, sudoeste, oeste, noroeste).
- O **sentido** é calculado do primeiro trecho da rota (bearing entre o waypoint inicial e o seguinte).
- Sem via nomeada no primeiro waypoint (OSRM sem nome/sigla): usa o landmark curado como referência ("seguindo na rotatória...") e o primeiro trecho repete a via, como antes.

## Exemplo

Antes:

```
Inicia-se o croqui na MT-243, no ponto (12°35'56.51"S, 52°13'10.50"O). Siga em frente...
```

Depois:

```
O presente croqui se inicia na cidade Querência no ponto (12°35'56.51"S, 52°13'10.50"O) seguindo pela MT-243 no sentido sul. Siga em frente...
```

## Arquivos

- `backend/croqui/narrative.ts`
- `backend/croqui/coords.ts`
- `backend/croqui/narrative.test.ts`
- `backend/croqui/coords.test.ts`
- `docs/CROQUI_ACESSO.md`

## Testes

- `pnpm exec vitest run backend/croqui/` → 54 testes passando
- `pnpm exec tsc --noEmit` → limpo

## Deploy

- Backend rebuildado (`esbuild backend/index.ts`) + `systemctl --user restart geoforest-backend.service`
- Frontend não mudou — sem `firebase deploy` necessário (o autosync cuida se houver push)
