# GeoForest IA — Refatoração Frontend v2.1

**Data:** 04/07/2026  
**Commit:** `9245ff6f`  
**Branch:** `main`  
**Repositório:** https://github.com/alvaro209890/GeoForest-IA  
**Deploy:** Firebase Hosting (ia-florestal + geoforest-admin)

---

## 1. Resumo Executivo

Remoção completa do módulo de chat/assistente IA do Dashboard GeoForest e redesign total da barra lateral com visual moderno, interativo e responsivo. O sistema agora é focado exclusivamente nas ferramentas de geoprocessamento: SIMCAR, CBERS, Landsat e Vértices Próximas.

---

## 2. Mudanças Detalhadas

### 2.1 Chat Removido (Assistente IA)

**Arquivo:** `client/src/pages/Dashboard.tsx`

| O que foi removido | Linhas afetadas (~) |
|---|---|
| Conteúdo JSX do chat (chatScrollRef, chatTimeline, textarea, input, anexos, modelo selector, botão enviar) | ~195 linhas |
| Lista de conversas na sidebar (filteredConversations.map) | ~40 linhas |
| Campo de busca de conversas | ~15 linhas |
| Botão "Novo Chat" contextual | ~12 linhas |
| Badge "Online" no header | ~5 linhas |
| Aba "Assistente" do grid de tabs | ~12 linhas |
| Effects de scroll do chat + animação de digitação | ~20 linhas |

**Alterações de estado:**
- `activeView`: tipo alterado de `'chat' | 'settings' | 'simcar-clip' | 'features' | 'cbers-wpm' | 'landsat' | 'vertices-proximas'` para `'simcar-clip' | 'cbers-wpm' | 'landsat' | 'vertices-proximas' | 'features' | 'settings'`
- Valor default: `'simcar-clip'` (antes `'chat'`)
- 5 referências a `setActiveView('chat')` redirecionadas para `setActiveView('simcar-clip')`
- 2 useEffects neutralizados (hooks mantidos para não quebrar a cadeia de hooks do React)

**O que NÃO foi removido (mantido para integridade do código):**
- Estados `messages`, `conversations`, `input`, `chatError` — podem ser usados por integrações futuras
- Funções `handleSend`, `createConversation`, `loadConversation` — mantidas, apenas redirecionam para SIMCAR
- `ChatMessage`, `Conversation` e tipos relacionados — compatibilidade com Firestore

### 2.2 Sidebar Moderna (Redesign Completo)

**Container principal (`<aside>`):**
```css
bg-gradient-to-b from-[#0a120e]/98 via-[#0a120e]/95 to-[#0a120e]/98
backdrop-blur-2xl
border-r border-emerald-500/10
shadow-2xl shadow-black/30
transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
```
- Colapso responsivo: `lg:w-[72px]` (ícones) → `xl:w-80` (expandido)

**Logo:**
- Glow animado com `animate-pulse` no blur do ícone
- Hover: opacidade do glow 60% → 100%, sombra ampliada
- Ícone: gradiente emerald-400 → green-600, padding p-2, borda rounded-xl
- Texto: "GeoForest IA" + subtítulo "Forestry Intelligence" com tracking-[0.15em]

**Segmented Control (abas):**
- Container: `rounded-2xl bg-white/[0.03] border border-white/[0.06] backdrop-blur-sm`
- Slider animado: `<div>` absoluto com `translateX()` calculado dinamicamente
  - SIMCAR ativo: translateX(0%) — gradiente purple→indigo
  - CBERS ativo: translateX(100%) — gradiente cyan→emerald
  - Landsat ativo: translateX(200%) — gradiente sky→emerald
  - Vértices ativo: translateX(300%) — gradiente violet→emerald
- Cada botão: `z-10 relative`, fonte `font-semibold`, ícone 16px
- Ícone ativo ganha `drop-shadow-[0_0_6px_rgba(...)]` com cor da respectiva tab
- Transição: `duration-400 ease-[cubic-bezier(0.4,0,0.2,1)]`

**Abas mantidas (4):**

| Tab | Cor ativa | Ícone | Rota/View |
|---|---|---|---|
| SIMCAR | purple-600 → indigo-600 | Scissors | simcar-clip |
| CBERS | cyan-600 → emerald-600 | Satellite | cbers-wpm |
| Landsat | sky-600 → emerald-600 | Layers | landsat |
| Vértices | violet-600 → emerald-600 | Network | vertices-proximas |

### 2.3 Cache Firebase (Cache-Busting)

**Antes:** `Cache-Control: no-cache, no-store, must-revalidate` em TODOS os arquivos  
→ Causava reload completo a cada acesso, degradando performance

**Depois:** Política granular por tipo de arquivo:

| Tipo | Cache-Control | Duração |
|---|---|---|
| JS/CSS (hashed) | `public, max-age=31536000, immutable` | 1 ano |
| HTML | `no-cache` | Revalida sempre (304 se igual) |
| Imagens/fontes | `public, max-age=604800` | 7 dias |
| Manifest/XML | `public, max-age=3600` | 1 hora |

**Por que funciona:** O Vite gera hashes nos nomes dos arquivos JS/CSS (ex: `Dashboard-CN3NJg61.js`). Quando o código muda, o hash muda, o nome do arquivo muda, e o browser baixa a versão nova automaticamente — sem precisar de Ctrl+F5.

---

## 3. Arquivos Modificados

```
M  client/src/pages/Dashboard.tsx    (+223 / -420 linhas)
M  firebase.json                      (cache headers otimizados)
A  docs/CHANGELOG_2026-07-04.md      (este documento)
```

---

## 4. Verificação de Qualidade

| Etapa | Resultado |
|---|---|
| `tsc --noEmit` | 0 erros |
| `vite build` (público) | 8.64s — Dashboard 363KB (79KB gzip) |
| `vite build` (admin) | 9.84s — Admin 453KB (121KB gzip) |
| `esbuild` (backend) | 701KB — 62ms |
| Firebase deploy | OK (ver abaixo) |

---

## 5. Deploy

```bash
firebase deploy --only hosting
```

- **Site público:** `ia-florestal` → `dist/public`
- **Site admin:** `geoforest-admin` → `dist/admin`

---

## 6. Rollback

Para reverter: `git revert 9245ff6f` e novo deploy Firebase.

---

## 7. Pendências / Próximos Passos

- [x] Correção de 4 layers CBERS com órbita errada no GeoServer (04/07/2026)
- [ ] Análise de consistência da seção SIMCAR (em andamento)
- [ ] Possível limpeza de estados chat não utilizados (~30 variáveis)
- [ ] Extrair views SIMCAR/CBERS/Landsat/Vertices para componentes separados

---

## 8. Hotfix: Correção de órbita em 4 layers CBERS (04/07/2026)

**Problema:** 4 coveragestores CBERS no GeoServer estavam na órbita errada — arquivos legados
de setembro/2025 e junho/2024 migrados em lote em 12/04/2026 com a órbita do diretório
diferente da órbita real do STAC item.

**Layers afetadas:**
| Store antiga (órbita errada) | Órbita correta |
|---|---|
| `211_132_2020_...211_133...C342` | 211_133 |
| `211_132_2020_...211_133...C342_PAN` | 211_133 |
| `212_129_2022_...211_129...C342` | 211_129 |
| `213_129_2021_...212_129...C342` | 212_129 |

**Correção:**
- 20 arquivos movidos para diretórios de órbita correta no HD Backup
- Nome do caso 3 corrigido (`211.129` → `211_129`)
- 4 coveragestores antigos removidos, 4 novos recriados no GeoServer
- Layer groups `orbit_211_133`, `orbit_211_133_y2020`, `orbit_211_129_y2022` criados
- Todos verificados com WMS GetMap (200 OK, image/png)
- Total permanece 734 coveragestores
- Código atual de publicação (`publishCbersPanToArchive`) validado: extrai órbita corretamente
  do STAC item ID — sem bugs nesse fluxo
