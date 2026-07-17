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

## Atualização — CAR-teste do oráculo = projeto "Teste" (271442)

Confirmado na conta técnica SIMCAR (CPF configurado no env do servidor):

| Campo | Valor |
|-------|--------|
| Id | **271442** |
| PropriedadeNome | **Teste** |
| DataCriacao | **2025-04-04T13:25:33** |
| Município | Querência |
| Situação | `[EM_CADASTRAMENTO]` |

O backend do PC servidor passou a usar `SIMCAR_TEST_CAR_ID=271442` (antes 270069 / Santa clara).
Imports e ProcessarGeo do oráculo agora sobrescrevem **só** o projeto **Teste**.

Listagem obtida via `POST /Requerimento/ListarRasc` com body completo do app
(`Filtros.PROPRIEDADE_NOME` + `ItensPorPagina` + `Pagina` + `ColunaOrdenar` + `Colunas`).
