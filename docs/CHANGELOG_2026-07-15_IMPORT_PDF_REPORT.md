# Changelog — PDF de Relatório de Importação (GeoForest)

**Data:** 2026-07-15  
**Branch:** `main`

## Resumo

Após a **Importar** do Processar Projeto, o sistema gera um **PDF bonito** no
espírito do *Relatório de importação* da SEMA, com identidade visual GeoForest
(header escuro, accent emerald, cards de métricas, tabelas).

## Conteúdo do PDF (estilo SEMA + GeoForest)

1. **Cabeçalho** com logo GeoForest, título “Relatório de Importação”, nome do ZIP e data/hora (America/Cuiaba).
2. **Banner de situação**
   - Aprovado (verde) ou **Reprovado** (vermelho) com a frase SEMA:
     *Corrija os erros encontrados e envie novamente!*
3. **Métricas:** camadas no ZIP, total de erros, tipos de erro.
4. **Erros encontrados** agrupados por feição (camada), com rótulos oficiais:
   - *Borda do polígono se cruza*
   - *A geometria contém pontos repetidos*
   - demais tipos de conformidade
5. **Detalhamento** (tabela: camada, tipo, feição, detalhe).
6. **Geometrias encontradas** — inventário de camadas (código SIMCAR, quantidade, CRS).
7. Rodapé com paginação e nota de pré-validação local.

## API

| Método | Rota | Descrição |
|--------|------|-----------|
| `POST` | `/api/processar-projeto/importar` | Gera o PDF e devolve `pdfUrl` |
| `GET`  | `/api/processar-projeto/import/:importId/pdf` | Download do PDF (regenera se necessário) |

## UI

Em **Análise de Erros → Processar projeto**, após Importar:

- Botão **Baixar PDF (estilo SEMA)** no banner de situação.

## Arquivos

| Arquivo | Função |
|---------|--------|
| `backend/import-report-pdf.ts` | Layout PDFKit |
| `backend/import-report-pdf.test.ts` | Testes |
| `backend/processar-projeto.ts` | Geração no import + rota download |
| `backend/local-storage.ts` | Área `processar-projeto/import-pdf` |
| `client/src/components/ProcessarProjetoAnalysis.tsx` | Botão de download |

## Testes

```bash
npx vitest run --root . backend/import-report-pdf.test.ts backend/processar-projeto.test.ts
```

## Deploy frontend (sem Ctrl+F5)

O app já tem:

- `version.json` + `client/src/lib/autoUpdate.ts` (reload quando o build muda)
- `firebase.json`: HTML e `version.json` com `no-cache`

Após publicar o hosting, quem **loga de novo** ou mantém a aba aberta recebe a
versão nova sem precisar de Ctrl+F5 (auto-update a cada 5 min / foco da aba).

```bash
npm run build:app
# e admin se necessário: npm run build:admin
firebase deploy --only hosting --project ia-florestal
```

## Documentação relacionada

- [`CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md`](CHANGELOG_2026-07-15_IMPORT_PARITY_SIMCAR.md)
- [`PROCESSAR_PROJETO_SIMCAR.md`](PROCESSAR_PROJETO_SIMCAR.md)
- [`CHANGELOG_2026-07-10_AREAS_NAO_CONTIDAS.md`](CHANGELOG_2026-07-10_AREAS_NAO_CONTIDAS.md) — auto-update
