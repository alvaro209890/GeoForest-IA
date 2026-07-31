# CHANGELOG — Aba Solicitação de Prioridade SEMA

**Data:** 2026-07-31
**Commit:** (pendente)

## Resumo

Nova aba no GeoForest-IA para auto-preenchimento dos documentos de Solicitação de Prioridade SEMA (Requerimento Padrão + Ofício de Justificativa).

## Funcionalidade

1. Usuário compacta os PDFs do processo (CAR, Matrícula, Procuração, CNH, Comprovante, AI/TE) em um ZIP
2. Faz upload na nova aba "Solicitação" do Dashboard
3. Backend extrai dados automaticamente dos PDFs via Python/pymupdf
4. Preenche os 2 templates .docx preservando 100% da formatação SEMA
5. Retorna ZIP com os documentos preenchidos para download

## Arquivos novos

| Arquivo | Descrição |
|---|---|
| `backend/solicitacao-prioridade.ts` | Rotas Express (upload SSE + download) |
| `backend/solicitacao/fill_templates.py` | Script Python: extração PDF + preenchimento XML |
| `backend/templates/Requerimento_padrao_SEMA_TEMPLATE.docx` | Template do Requerimento Padrão SEMA |
| `backend/templates/Oficio_Justificativa_PRIORIDADE_TEMPLATE.docx` | Template do Ofício de Justificativa |
| `client/src/components/SolicitacaoPrioridadePanel.tsx` | Painel React da nova aba |

## Arquivos modificados

| Arquivo | Mudança |
|---|---|
| `backend/routes/_registry.ts` | +import + register |
| `backend/app.ts` | +2 paths no AUTH_REQUIRED |
| `client/src/dashboard/types.ts` | +'solicitacao-prioridade' no DashboardView/TabId |
| `client/src/dashboard/routes.ts` | +rota /dashboard/solicitacao |
| `client/src/dashboard/components/DashboardSidebarTabs.tsx` | +botão "Solicitação" |
| `client/src/pages/Dashboard.tsx` | +import + render condicional |

## Como usar

1. No GeoForest, vá para a aba **Solicitação** no sidebar
2. Arraste ou selecione um arquivo `.zip` contendo os PDFs:
   - CAR — Recibo de Inscrição
   - Matrícula do imóvel
   - Procuração vigente
   - CNH ou RG
   - Comprovante de endereço
   - AI e TE (Auto de Infração e Termo de Embargo)
3. Aguarde o processamento (extração + preenchimento)
4. Clique em **Baixar documentos**

## Dependências

- **Python 3.12** com `pymupdf` (fitz) instalado
- Caminho do Python configurado em `backend/solicitacao-prioridade.ts` → `PYTHON_EXE`
- Templates armazenados em `backend/templates/`

## Testado com

- Lote Rural 81 — Juliana Durel (Querência-MT)
- SIMCAR MT10005/2019
- 6 PDFs extraídos com sucesso
