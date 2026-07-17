# Changelog — 2026-07-17: restaura layout clássico do Dashboard

## Por que

O redesign Pencil (v2.14) introduziu `DashboardLayout` + `Sidebar` de navegação e
passava `hideSidebar` no `DashboardRouter`. Efeito colateral:

- a **sidebar clássica** do `Dashboard` (abas + cards de histórico) deixava de
  renderizar;
- recortes SIMCAR, CBERS, Landsat, erros, processar projeto e recibos sumiam da UI
  mesmo com os dados intactos no storage local.

## O que foi feito

1. **`DashboardRouter`** volta a montar **somente** o `Dashboard` clássico
   (mapeia path → `initialView`; sem `DashboardLayout`).
2. **Removidos** `client/src/components/layout/DashboardLayout.tsx` e
   `client/src/components/layout/Sidebar.tsx` (layout novo).
3. **Botões “Novo …”** da sidebar: um único `<Plus>` + texto em botão de camada
   única (fim do anel `p-[1px]` + `group-hover:bg-transparent` que gerava “++”).
4. Cards de histórico permanecem no padrão de sempre (lista por aba na sidebar
   do `Dashboard`).
5. Auto-update do front via `version.json` (sem Ctrl+F5 obrigatório).

## O que NÃO mudou

- Backend / oráculo SIMCAR / CAR-teste **270069** (nome SEMA: “Santa clara”) —
  continua o projeto compartilhado de teste (decisão D1 do plano oráculo).
- Dados de histórico no `LOCAL_DATA_ROOT` (ex.: `simcar_clips`, `cbers_wpm_jobs`).

## Deploy

- Front: Firebase Hosting `ia-florestal.web.app`
- API: `geoforest-api.cursar.space` → backend local :3001
