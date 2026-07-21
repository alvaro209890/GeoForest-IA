# CHANGELOG — 21/07/2026 — Remoção da Aba "Processar Projeto" + Cache Fix

## Remoção: Aba "Processar Projeto" (Erros → Processar projeto)

A aba "Processar projeto" dentro da seção "Análise de Erros" foi completamente removida:

### Frontend (Dashboard.tsx)
- **Import removido**: `ProcessarProjetoAnalysis` e type `ProcessarHistoryItem`
- **State removido**: `errorAnalysisTab` não aceita mais `'processar-projeto'`
- **States removidos**: `processarHistory`, `processarJobId`
- **Funções removidas**: `mapProcessarDocToHistoryItem`, `handleProcessarJobSnapshot`, `selectedProcessarHistoryEntry`
- **Sidebar**: Cards de histórico do processar-projeto removidos
- **Área principal**: Botão da sub-tab "Processar projeto" e renderização do componente removidos
- **Inicialização**: Bloco try/catch que carregava `simcar_oraculo_jobs` e `processar_projeto_jobs` do Firestore removido
- **Firestore refs**: `simcarOraculoRef` e `processarLegacyRef` (variáveis não utilizadas) removidos

### Arquivo preservado
- `client/src/components/ProcessarProjetoAnalysis.tsx` mantido no repositório (não importado)

## Cache Fix: Firebase Hosting Headers

Corrigido `firebase.json` para ambos os sites (`ia-florestal` e `geoforest-admin`):

- **Adicionada regra `"source": "/"` com `no-cache`**: Antes, a rota raiz `/` não tinha regra explícita, herdando o default `max-age=3600` do Firebase. Isso forçava o usuário a esperar até 1h ou usar Ctrl+F5 após deploy.
- **HTML, SPA routes, version.json**: Trocado de `no-cache, no-store, max-age=0, must-revalidate` para apenas `no-cache`. O `no-store` impedia o browser de usar `304 Not Modified`, forçando download completo em toda navegação. Com `no-cache`, o browser revalida com o servidor e aceita 304 quando o conteúdo não mudou.

### Estratégia de cache final

| Tipo | Cache-Control | Motivo |
|------|--------------|--------|
| JS/CSS | `public, max-age=31536000, immutable` | Hashes nos nomes (Vite) |
| HTML | `no-cache` | Sempre revalida (304 se igual) |
| SPA routes (regex) | `no-cache` | Rotas client-side |
| `/` (raiz) | `no-cache` | Entry point principal |
| Imagens/fontes | `public, max-age=604800` | 7 dias |
| Manifest/XML/JSON | `public, max-age=3600` | 1 hora |
