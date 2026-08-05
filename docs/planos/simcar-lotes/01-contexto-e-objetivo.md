# 01 — Contexto e Objetivo

## O problema (demonstrado no vídeo de 2026-08-05)

Para cada lote/propriedade, a IMAP precisa arquivar os **documentos do projeto no SIMCAR** (SEMA-MT):

1. Logar no SIMCAR técnico (`monitoramento.sema.mt.gov.br/simcar/tecnico.app/autenticar`) com a conta técnica ("Pamera Cristina")
2. Abrir o CAR (ex.: `MT10005/2019` — Lote Rural 81, Juliana Durel, Querência) na página `car/editar/caracterizacao/10005`
3. Baixar **na mão** os arquivos da seção "Documentos":
   - `Arquivo Enviado.zip`, `Arquivo Processado.zip`, `Relatório de Importação.pdf`, `Relatório de Processamento.pdf`, mais croquis e demais artefatos
4. Salvar tudo na pasta do lote (ex.: `.../Lote 81 - PA Pingos Dagua - Juliana Durel/`)

Isso é **manual, repetitivo e propenso a erro** quando são vários lotes.

## O que o vídeo mostra (fluxo alvo, em ordem)

| Tempo | Tela | Ação |
|---|---|---|
| 0–2s | Login SIMCAR técnico | CPF + senha → "Autenticar" |
| 4–6s | Home "Principal" (pós-login) | Menus CAR/CAR Digital/Regularização… |
| 10–28s | OneCommander + Adobe | Pasta do lote com `Arquivo Processado/`, `Arquivo Enviado/`, recibo PDF; recibo aberto (nº CAR, proprietário, município) |
| 32–44s | Página do CAR (`caracterizacao/10005`) | Seção "Documentos" (7 arquivos) + 3 croquis + downloads do Chrome (`Arquivo Enviado.zip`, `Arquivo Processado.zip`, `BuscarPdfSolicitacao_solicitacao.pdf`) |

**Conclusão:** a nova funcionalidade automatiza exatamente os passos 1–3 acima, a partir do recibo.

## O que já existe (não reinventar)

### No GeoForest-IA

| Peça | Onde | Papel |
|---|---|---|
| Cliente HTTP SIMCAR técnico | `backend/simcar-oraculo/client.ts` | Login com `scramble`, cache de token, retry em 401, `simcarDownload` (POST com `authorization`), `simcarUploadZip`, `simcarBuscar` |
| Endpoints SEMA descobertos | `docs/planos/simcar-oraculo-proxy/11-endpoints-sema-descobertos.md` | **Todos os downloads de documentos do CAR validados ao vivo** (importação, processamento, enviado, processado, conferência, pendências, abrangência, modelo) |
| Aba "Recibos SIMCAR" | `backend/simcar-receipts.ts` + `ReceiptsHub.tsx` | API **pública** (`Publico/ListarRequerimento`, `Publico/DownloadReciboCar/{id}`) — busca recibo por CPF/CAR e baixa o PDF. **Complementa, não duplica** a nova aba |
| Extração de texto PDF | `pdf-parse` (já em `package.json`, usado em `sema-report-parse.ts`) | Para extrair o nº do CAR do recibo |
| Zip | `archiver` (já em `package.json`, usado em `croqui.ts`, `auas-sccon.ts`) | Para montar o ZIP final |
| Padrão de job SSE | `backend/processing-jobs.ts` + `backend/croqui.ts` | `startJob`/`finishJob`, status por job, eventos SSE, download do artefato |

### No acompanhamento-de-processos (referência de lógica)

`frontend/services/simcar-fetch.ts` — busca de pareceres direto da API do SIMCAR:

- **Login:** `POST /Autenticacao/Autenticar` com `{v: scramble(JSON.stringify({Login, Senha, NovaSenha:""}))}` → token `TECNICO …`
- **Listar:** `POST /Requerimento/ListarRasc` com `{Filtros:{NUMERO}, ItensPorPagina, Pagina, IsOrdenarCrescente, ColunaOrdenar:"NumeroCompleto", Colunas:[]}` → re-filtra pelo `NumeroCompleto` exato
- **Baixar:** `POST /…/BuscarPdfParecer/{id}` com header `authorization: <token>` → valida magic `%PDF`
- **Sessão:** SEMA permite **1 sessão por conta** — token em cache por aba, login single-flight, 401 = sessão derrubada → re-login (até 5×) preservando PDFs já baixados
- **Credenciais:** localStorage, nunca no backend

> A mesma lógica de login/listagem/sessão já existe **server-side** no `simcar-oraculo/client.ts` do GeoForest — vamos reusar o cliente e só adicionar os downloads de documentos (que já estão documentados no doc 11).

## Escopo

### Dentro
- Nova aba "Lotes SIMCAR" (frontend) + módulo `backend/simcar-lotes/`
- Entrada: 1+ recibos PDF (arquivo único ou ZIP)
- Extração do nº do CAR do recibo (estadual `MT10005/2019` ou federal `MT-5107065-AEC…`)
- Login SIMCAR com credenciais do usuário (localStorage, chave própria do GeoForest) — via backend (PC servidor)
- Por CAR: download de **`Arquivo Enviado.zip` + `Arquivo Processado.zip` + `Recibo de Inscrição.pdf`** (recibo via API pública; fallback = cópia do recibo enviado)
- Montagem do ZIP final com pasta por lote
- Relatório por lote (o que baixou / o que faltou)

### Fora (YAGNI por ora)
- Demais artefatos do CAR: relatórios de importação/processamento, conferência, pendências, erros, abrangência, modelo, croquis, solicitação (decisão A1 — pode entrar em fase 2)
- Upload de shapefile / processamento / oráculo (já existe em `simcar-oraculo`)
- Análise de pareceres com IA (é do acompanhamento-de-processos)
- Agendamento/automação periódica (pode virar fase 2)
- Salvar os arquivos direto no OneDrive/pasta do lote (o usuário baixa o ZIP e arquiva como hoje)
