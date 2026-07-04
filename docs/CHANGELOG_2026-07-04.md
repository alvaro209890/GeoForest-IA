# GeoForest IA — Refatoração do Frontend (v2.1)

**Data:** 04/07/2026

## Resumo

Remoção completa do módulo de chat/assistente IA e redesign da barra lateral com visual moderno e interativo.

## Mudanças

### 1. Chat Removido
- Removida a aba "Assistente" (chat com IA) completamente do Dashboard
- Eliminados ~200 linhas de JSX do conteúdo do chat (input, mensagens, seleção de modelo, upload de anexos)
- Removida a busca de conversas da sidebar
- Removida a lista de conversas do chat  
- Removido o badge "Online" do header
- Tipo `activeView` atualizado: removido `'chat'`, default agora é `'simcar-clip'`
- Todos os `setActiveView('chat')` redirecionados para `'simcar-clip'`
- Effects de scroll/typing do chat neutralizados (hooks mantidos para não quebrar a cadeia)

### 2. Sidebar Moderna (Redesign)
- **Logo:** Animação de pulse no glow do ícone, hover com transição de sombra, tipografia refinada ("Forestry Intelligence")
- **Tabs:** Segmented control com slider animado — indicador desliza entre as 4 abas (SIMCAR, CBERS, Landsat, Vértices) com gradiente próprio para cada uma
  - SIMCAR: purple → indigo
  - CBERS: cyan → emerald
  - Landsat: sky → emerald  
  - Vértices: violet → emerald
- **Glass morphism:** `backdrop-blur-2xl`, gradiente sutil no fundo, borda emerald-500/10
- **Colapso:** Transição `cubic-bezier` suave — sidebar colapsa para 72px em telas lg, expande em xl
- **Interatividade:** Ícones com `drop-shadow` glow quando ativos, hover states refinados, transições de 300-500ms

### 3. Abas Mantidas
- SIMCAR (Recorte/Analise)
- CBERS 4A WPM (Imagens de satélite)
- Landsat WMS (Imagens Landsat)
- Vértices Próximas
- Funcionalidades (manual)
- Configurações

## Arquivos Alterados
- `client/src/pages/Dashboard.tsx` — principal (redução de ~195 linhas, sidebar redesign)

## Build
- TypeScript: 0 erros (`tsc --noEmit` limpo)
- Vite build: público (363KB Dashboard) + admin (453KB) + backend (701KB)
- Total: ~8.6s build público + ~9.8s admin = sucesso
