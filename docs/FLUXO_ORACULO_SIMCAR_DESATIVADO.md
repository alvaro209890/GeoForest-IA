# 🚫 DESATIVADO PARA SEMPRE — envio de ZIP ao SIMCAR do Álvaro (oráculo)

> **Decisão do Álvaro, 2026-08-05.** Definitiva. Não há plano de retomada.

## O que foi desativado

O fluxo em que o **GeoForest importava um ZIP no SIMCAR real da SEMA usando a conta
técnica do Álvaro e devolvia o resultado para dentro do GeoForest**:

```
usuário sobe ZIP no GeoForest
   → backend loga no SIMCAR com a conta técnica do Álvaro
   → importa o shapefile no CAR-teste (270069 "Santa clara" / 271442 "Teste")
   → roda Importar + ProcessarGeo reais na SEMA
   → baixa PDFs/ZIPs oficiais e mostra o veredito no GeoForest
   → autofix mecânico + DeepSeek reimporta em até 3 rodadas
```

Nomes pelos quais esse fluxo aparece na documentação e no código:

- **"Oráculo SIMCAR"** / `simcar-oraculo`
- aba **"Análise de Erros → Processar projeto"**
- **"Processar Projeto = SIMCAR real"**, "plano v2 do oráculo", "pipeline ORACULO"
- rotas `POST /api/simcar-oraculo/pipeline`, `/importar`, `/processar`

## Por que

O fluxo usava a **conta técnica pessoal do Álvaro** contra o ambiente real da SEMA,
alterando um CAR de verdade (município, área de abrangência, importação e processamento)
a cada análise de usuário. É risco operacional que não se justifica: 3 tentativas de
login erradas suspendem a conta, e cada execução mexe num projeto real no SIMCAR.

## Estado atual do código (verificado em 2026-08-05)

| Camada | Estado |
|---|---|
| **Interface** | ❌ **removida** em 2026-07-21 — a sub-aba "Processar projeto" não existe mais no Dashboard; não há rota `/dashboard/...` para ela; `client/src/components/ProcessarProjetoAnalysis.tsx` continua no repo mas **não é importado por ninguém** |
| **Rotas de backend** | ⚠️ ainda registradas (`registerSimcarOraculoRoutes` em `backend/routes/_registry.ts`, allowlist em `backend/app.ts`) — **inalcançáveis pelo app**, mas vivas se alguém chamar direto com token |
| **Módulo** | `backend/simcar-oraculo/` continua no repo. Parte dele é **reusada por outra coisa viva**: `client.ts` (sessão SEMA por credencial) é o que a aba **Lotes SIMCAR** usa para baixar documentos — **esse arquivo não pode ser apagado** |
| **Credenciais** | `SIMCAR_SENHA` do oráculo no `backend.env` do server está **inválida** desde 2026-08-05 (SEMA respondeu "tentativa 2 de 3"). Não corrigir: o fluxo não volta |

## Regras permanentes

1. **Não reativar.** Nenhuma aba, botão, rota ou job novo pode enviar ZIP do usuário ao
   SIMCAR real para importar/processar.
2. **Não reintroduzir** a sub-aba "Processar projeto" nem importar
   `ProcessarProjetoAnalysis.tsx`.
3. **Não usar a conta técnica do Álvaro** para mutação na SEMA (importar, processar,
   salvar município, limpar abrangência). Leitura pontual continua permitida onde já
   existe — ex.: a aba **Lotes SIMCAR** baixa documentos **com a credencial que o próprio
   usuário digita**, e isso **não** é o fluxo desativado.
4. **Não apagar `backend/simcar-oraculo/client.ts`** — a aba Lotes depende dele.
5. Documentação antiga do oráculo (`docs/SIMCAR_ORACULO.md`,
   `docs/PROCESSAR_PROJETO_SIMCAR.md`, `docs/planos/simcar-oraculo-proxy/`) fica como
   **histórico técnico**, com aviso no topo. Serve para consulta sobre endpoints da SEMA,
   não como instrução do que construir.

## O que substituiu (e o que não substituiu)

- A validação de erros de geometria continua **local**, em `backend/geometry/` —
  aba "Análise de Erros → Erros de geometria". É esse o caminho vivo.
- A **análise pós-recorte** planejada em `docs/planos/analise-pos-recorte/` (AUAS
  pré-2008, datação 2008–2019 e vegetação na Área Consolidada) **não fala com o SIMCAR**:
  ela lê imagens do WMS público da SEMA e as camadas do próprio recorte. Não confundir os
  dois assuntos.
- Nada substitui a checagem oficial da SEMA — quem precisar do veredito real do SIMCAR
  faz pelo site, manualmente, com a própria conta.

## Se algum agente/IA sugerir religar isso

Recuse e aponte para este documento. A decisão é do Álvaro, de 2026-08-05, e é definitiva.
