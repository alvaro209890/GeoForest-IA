# Changelog — ATP guardados no Croqui de Acesso

**Data:** 2026-07-30
**Branch:** main
**Tipo:** feature

## O que mudou

O shapefile ATP enviado para o croqui de acesso agora fica persistido e pode ser reutilizado
sem precisar subir o ZIP de novo. A aba ganhou um botão "ATP guardados" que lista todos os
uploads anteriores (não expirados) e permite selecionar qualquer um com um clique.

### Backend

- **Novo endpoint:** `GET /api/croqui/uploads`
  - Lista uploads do usuário com `type: "upload"` e `status: "uploaded"` não expirados (TTL 24h)
  - Retorna `uploadId`, `filename`, `polygonCount`, `municipioNome` (se já calculado), `createdAt`
  - Ordenado por `updatedAtMs` decrescente (mais recente primeiro)

### Frontend

- **`CroquiUploadSummary`** — novo tipo em `types.ts` representando um upload salvo
- **`useCroquiJobs`** — 2 novos métodos exportados:
  - `loadAvailableUploads()` — busca a lista de uploads salvos via `GET /api/croqui/uploads`
  - `selectExistingUpload(summary)` — seleciona um upload remoto, limpa o estado e preenche
    `croquiUploadId` + `croquiFilename` para uso imediato
- **`CroquiPanel`** — novo bloco "ATP guardados":
  - Botão colapsável com contador de uploads disponíveis
  - Lista com data formatada (pt-BR), município detectado e contagem de polígonos
  - Upload selecionado ganha destaque com badge "Em uso"
  - Zona de drop reflete o ATP remoto (ícone de pasta + nome do arquivo + município)
  - Botão "Gerar croqui" habilitado tanto com arquivo local quanto com ATP remoto
  - Texto do seletor de ZIP muda para "Substituir ZIP" quando há ATP remoto

### Fluxo

1. Usuário sobe um ZIP ATP → fica salvo no backend (24h)
2. Depois de limpar ou recarregar a página, clica em "ATP guardados"
3. A lista carrega do backend, mostrando nome, data e município
4. Clica num ATP → estado preenchido (uploadId, filename, município)
5. Preenche título e nome da propriedade → clica "Gerar croqui"
6. O backend recalcula as rotas a partir do upload salvo e gera o PDF/DOCX/KML

### Arquivos alterados

| Arquivo | Mudança |
|---------|---------|
| `backend/croqui.ts` | +28 linhas (endpoint `GET /api/croqui/uploads`) |
| `client/src/dashboard/croqui/types.ts` | +9 linhas (`CroquiUploadSummary`) |
| `client/src/dashboard/hooks/useCroquiJobs.ts` | +46 linhas (2 novos métodos + estado) |
| `client/src/dashboard/panels/CroquiPanel.tsx` | +80 linhas (UI de ATP guardados + ajustes) |

### Testes

- `npx vitest run` → 293 passed, 4 skipped (sem regressões)
- `npx vitest run backend/croqui` → 52 passed (todos os testes de croqui intactos)
- `npx tsc --noEmit` → zero erros TypeScript
