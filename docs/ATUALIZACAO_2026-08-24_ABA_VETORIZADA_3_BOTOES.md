# Aba "Análise de vetorização" — desbloqueio + 3 botões individuais (2026-08-24)

(autor: Hermes-windows | 2026-08-24)

## Contexto

O Álvaro queria usar a aba **"Análise de vetorização"** do painel *Recorte Automático SIMCAR*
para analisar um ZIP já vetorizado do modelo SIMCAR (as camadas que ele vetorizou), rodando as
**mesmas 3 análises do pós-recorte** — mas sobre os **polígonos importados pelo usuário**, sem
recorte WFS. No uso, a aba parecia travada/inacessível.

## O que já existia

A feature vetorizada **já estava funcional** no código e no build de produção:

- `POST /api/simcar/clip/import-vectorized` (backend/simcar/routes.ts) — importa o ZIP vetorizado,
  reconstrói o imóvel pelo ATP/AIR do próprio ZIP (sem consulta WFS), persiste no mesmo documento
  do recorte (`users/<uid>/simcar_clips/<jobId>`) com merge incremental.
- `runVectorizedCompleteAnalysis` (client) encadeava import → AC/AVN → AUAS → laudo único.
- Painel `AnalisePosRecortePanel` já era renderizado nos **dois** modos (`auto-clip` e
  `vectorized-analysis`) quando existe `simcarClipJobId` — com os 3 botões de fase:
  **pré-2008 (AUAS)**, **pós-2008 (datação)**, **vegetação na AC**.
- Validação completa de 21/08/2026 contra o ZIP real da Santa Clara
  (`docs/VALIDACAO_2026-08-21_ABA_VETORIZADA.md`), 16+ testes verdes.

Dois problemas de UX impediam o Álvaro de chegar lá:

1. **Lock de modo:** qualquer recorte ativo no histórico (qualquer `sourceMode` persistido)
   desabilitava os dois botões de modo (`disabled={isSimcarModeLocked}`), e "Novo Recorte"
   forçava `auto-clip`. Não havia caminho óbvio para a aba vetorizada.
2. **Botão único:** no modo vetorizado, o botão principal era "Análise Completa por IA" —
   encadeava tudo de uma vez, em vez de deixar rodar as 3 análises separadas (como o Álvaro
   queria: igual ao pós-recorte).

## Correções (commits d0ffaf77 e 5ffbc391, deploy automático 24/08 08:32 e 08:46 BRT)

### 1. Desbloqueio da troca de modo (`d0ffaf77`)

Em `client/src/pages/Dashboard.tsx`, os botões de modo agora:

```tsx
onClick={() => {
  if (simcarClipMode === modeOption.key) return;
  if (isSimcarModeLocked && activeSimcarClip?.status === 'processing') {
    toast.info('O recorte ativo ainda está processando. Aguarde terminar para trocar de modo.');
    return;
  }
  resetSimcarDraft(modeOption.key);
  if (isSimcarModeLocked && activeSimcarClip) {
    toast.info(`Novo rascunho iniciado no modo ${modeOption.label} — o recorte anterior continua salvo no histórico.`);
  }
}}
disabled={isSimcarModeLocked && activeSimcarClip?.status === 'processing'}
```

- `disabled`/title/estilo cinza só valem enquanto o recorte ativo **processa**.
- Com recorte ativo **concluído**, o clique troca de modo e inicia um **novo rascunho** no modo
  escolhido (`resetSimcarDraft` limpa o draft; o histórico persiste — nada é apagado).
- Mensagem de status mudou de "Modo travado neste recorte: …" para
  "Recorte ativo em: … Trocar de modo inicia um novo rascunho."
- Deps de dev que faltavam no repo foram adicionadas a `package.json`: `@turf/area` e `jszip`
  (faziam `routes-phases.test.ts` e `zip-rewrite.ts` falharem no typecheck/teste).

### 2. Import separado das análises — os 3 botões (`5ffbc391`)

Em `client/src/dashboard/hooks/useSimcarAnalysisFlow.ts`:

- `runVectorizedCompleteAnalysis` → renomeado para **`runVectorizedImportOnly`**:
  importa o ZIP, cria o clip (`sourceMode: 'vectorized-analysis'`, `status: 'completed'`,
  `processingStage: 'done'`), persiste, registra na conversa e **termina**.
  O bloco inteiro de encadeamento AC/AVN → AUAS → laudo único foi **removido** (-149 linhas).
- Expoção no retorno do hook trocada para `runVectorizedImportOnly`.

Em `client/src/pages/Dashboard.tsx`:

- Botão principal no modo vetorizado: label "**Importar ZIP**" (antes "Análise Completa por IA"),
  spinner "Importando ZIP...".
- `onClick` vetorizado chama `runVectorizedImportOnly()`.
- Se o ZIP já está no servidor com `processingStage === 'done'`, o botão não relança nada:
  `toast.info('ZIP já importado. Use as análises abaixo para continuar.')`.
- Texto do cartão "Modo vetorizado ativo" atualizado: depois do import, escolha uma das análises
  abaixo (fluxo pós-recorte sobre os polígonos do ZIP).
- O `AnalisePosRecortePanel` (já renderizado quando `simcarClipJobId` existe) fornece os
  **3 botões individuais**: Fase 1 (AUAS pré-2008), Fase 2 (datação pós-2008), Fase 3
  (vegetação na AC), cada uma independente com seu laudo — mesma mecânica do pós-recorte.

## Validação

| Item | Resultado |
|---|---|
| Testes vetorizado (import + persistência + fases) | 21/21 verdes |
| `tsc --noEmit` (client) | 0 erros |
| `pnpm run build` | ✓ built |
| Deploy | auto-sync 08:32 (d0ffaf77) e 08:46 (5ffbc391) BRT; backend :3001 200, hosting 200 |
| Consumo | `runVectorizedImportOnly` para no `processingStage: 'done'` — nenhuma análise roda sem clique |

## Fluxo final do usuário

1. Aba *Recorte Automático SIMCAR* → botão "**Análise de vetorização**" (ativo, verde).
2. Arrasta o ZIP com as vetorizações do CAR (ex.: `SIMCAR_Recorte_*.zip`).
3. Clique em "**Importar ZIP**" → import no servidor (reconstrói o imóvel pelo ATP/AIR do ZIP,
   sem WFS), job persiste com `processingStage: 'done'`.
4. Logo abaixo aparece o painel "**Análise pós-recorte**" com os **3 botões**:
   - Fase 1 — AUAS pré-2008
   - Fase 2 — Datação 2009–2019 (supressão pós-2008)
   - Fase 3 — Vegetação na Área Consolidada
5. Roda cada uma quando quiser; independentes; cada uma com seu laudo (PDF/DOCX) baixável.

## Correção de regressão (2026-08-25)

O hook de importação tinha sido simplificado, mas o `Dashboard` ainda guardava dois
mecanismos do fluxo antigo:

1. o polling interpretava `/analyze` e `/analyze-auas` como etapas `2/3` e `3/3` do
   importador;
2. um `useEffect` de recuperação relançava AC/AVN e AUAS quando encontrava um clip sem
   o antigo laudo combinado.

Isso explica o comportamento observado: o ZIP ou um card parecia terminar, o cabeçalho
marcava 100% e, em seguida, outra imagem/análise começava. A correção removeu o efeito de
retomada, separou o polling do importador dos endpoints dos cards e eliminou o estado
intermediário `processing/importing` depois de uma resposta de importação já concluída.

Teste de regressão: no modo `vectorized-analysis`, apenas
`/api/simcar/clip/import-vectorized` pode atualizar o cabeçalho; `/analyze`,
`/analyze-auas` e `/analyze-ac-vegetacao` retornam estado vazio para esse fluxo.

## Notas

- Não há mais resume automático de fases analíticas no fluxo vetorizado. Se uma análise
  falhar ou for interrompida, o usuário a refaz pelo card correspondente.
- O modo vetorizado nunca consulta WFS: o dado vem 100% do ZIP do usuário.
