# 05 — Frontend / UX (painel Lotes SIMCAR)

Arquivo: `client/src/components/SimcarLotesPanel.tsx` (+ tipos em `client/src/dashboard/types.ts` se necessário — **não** é: a aba já existe).

## 1. Badge de status do monitor (novo)

- Poll `GET /api/simcar-lotes/monitor-status` a cada 15 s (mesmo ritmo da espera do job) enquanto a aba estiver aberta; para ao desmontar.
- Visual (mesma linguagem do monitor-car):
  - **LIVRE** — bolinha verde + "SIMCAR: LIVRE"
  - **EM USO** — bolinha vermelha pulsante + "SIMCAR: EM USO por <por>"
  - **indisponível** (campo `erro`) — cinza + "Monitor indisponível" (sem alarme)
- Posição: topo do painel (card 3 / header), visível sempre.

## 2. Novas fases no progresso

`FASE_LABEL` +=

```ts
aguardando_simcar:    'Aguardando SIMCAR ficar livre',
sessao_interrompida:  'Sessão interrompida — aguardando SIMCAR',
```

Render (linha do job, perto do `job.message` já existente):

- Fase `aguardando_simcar` ou `sessao_interrompida` → **banner âmbar/vermelho** (distinto do azul de processamento):
  - Ícone de ampulheta/relógio + texto do `job.message` (já vem montado no backend com `<por>`)
  - `por` visível: "SIMCAR em uso por <por>"
  - Nota fixa: "O download continua em segundo plano mesmo se você fechar esta página."
- Barra de progresso: `percent` fica congelado (backend não avança) + **spinner pulsante** no lugar do progresso linear — informa "esperando", não "travado por bug".
- Botão **Cancelar** continua habilitado (espera ilimitada é cancelável — D2).

## 3. Aviso ao iniciar com SIMCAR ocupado

- Ao clicar "Baixar documentos do lote": se `monitor-status` (cache 5s) disser `ocupado`:
  - Confirmação suave (não bloqueante): "O SIMCAR está em uso por <por>. O download vai aguardar ficar livre e começar sozinho."
  - O job é criado mesmo assim (fica em `aguardando_simcar` no servidor).
- Não desabilitar o botão por causa do monitor (R1 pede espera, não bloqueio).

## 4. Re-anexação ao abrir/reabrir (R4)

- Já existe histórico no servidor (`users/<uid>/simcar_lotes_jobs`, cards de histórico no front).
- Garantir: se houver job em `processing`/`aguardando_simcar`/`sessao_interrompida`, o painel reconecta:
  1. Ao montar, `GET /api/simcar-lotes/jobs/:id/status` do job mais recente ativo (ou lista de históricos)
  2. Reabre `GET /jobs/:id/events` (SSE) para continuar recebendo progresso
- Se o job terminou com o site fechado → o card de histórico já mostra o link do ZIP (comportamento atual).

## 5. Estados de erro

- `monitor-status` com 401 → fluxo de login do app (padrão existente).
- Job que ficou em `aguardando_simcar` por muito tempo → nada de timeout no front; o backend é quem decide (espera ilimitada). UX mostra o "desde <horário>" se o backend mandar (`desde`), senão só a mensagem.
