# 2026-08-25 — Aba NDVI dedicada no dashboard

## Entrega

O NDVI ganhou **aba própria** no grid do dashboard (`/dashboard/ndvi`), além do card
existente na análise pós-recorte (que continua funcionando). A aba lista os recortes
SIMCAR do usuário e permite calcular o NDVI de cada um sem sair dela.

### O que a aba faz

- **Lista de recortes**: mostra os recortes SIMCAR do usuário (histórico já carregado
  pelo dashboard, `users/<uid>/simcar_clips`), com nome, data, área (ha) e status.
- **Cálculo por recorte**: ao selecionar um recorte, carrega o estado NDVI
  (`GET /api/simcar/clip/ndvi/:jobId`) e permite rodar (`POST /api/simcar/clip/analyze-ndvi`
  com `{ jobId, ano }`), acompanhar o progresso em tempo real (SSE), cancelar
  (`DELETE /api/simcar/clip/ndvi/:ndviJobId`) e recalcular.
- **Resultado**: NDVI médio + pixels válidos + classe, data da cena, botão
  "Baixar laudo NDVI (Word)" e botão "Abrir WMS" (camada publicada no GeoServer).
- **Seletor de ano**: de 1984 até o ano corrente (safra out–set, mesmo default do card
  da análise pós-recorte).
- **Estados**: sem recortes → empty state com CTA "Ir para Recorte SIMCAR";
  flag desligada → aviso "NDVI ainda não está habilitado neste ambiente".

### Arquivos

- `client/src/dashboard/panels/ndvi/NdviPanel.tsx` (novo) — painel da aba.
- `client/src/dashboard/types.ts` — view/tab `ndvi` + label.
- `client/src/dashboard/routes.ts` — rota `/dashboard/ndvi`.
- `client/src/dashboard/components/DashboardSidebarTabs.tsx` — aba NDVI (ícone `Sprout`,
  gradiente lime→emerald).
- `client/src/pages/Dashboard.tsx` — renderização da view, estado `ndviSelectedJobId`,
  histórico lateral (recortes clicáveis) e import lazy do painel.

### Notas

- Nenhuma mudança no backend: rotas, gate e persistência já existiam (commits
  `c3719079`, `cf93e14f`, `d926def7`).
- O flag `SIMCAR_NDVI_ENABLED` já está `true` no `backend.env` do servidor.
- A deleção de recortes continua na aba SIMCAR (o card NDVI do histórico lateral não
  duplica o fluxo de exclusão com cancelamento de jobs/Cloudinary).

## Validação

- `pnpm check`: sem erros TypeScript.
- `pnpm test`: **973 testes passando** (0 falhas; 8 skipped por configuração).
- `pnpm build`: frontend Vite + backend esbuild concluídos; chunk `NdviPanel` gerado.
- Validação online: aba visível em `https://ia-florestal.web.app/dashboard/ndvi`,
  painel conversando com `https://geoforest-api.cursar.space` (auto-sync no servidor).
