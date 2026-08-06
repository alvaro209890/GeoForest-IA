# 10 — Deploy, rollout e operação

## 1. Onde isso roda

| Peça | Onde |
|---|---|
| Backend | PC `server-desktop` (Tailscale), checkout `/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA` |
| Serviço | `systemctl --user restart geoforest-backend.service` (`WorkingDirectory` = checkout acima) |
| Env | `~/.config/geoforest/backend.env` |
| Túnel | `https://geoforest-api.cursar.space` |
| Frontend | Firebase Hosting → `https://ia-florestal.web.app` |

Push no `main` dispara o auto-sync (build + restart + deploy em até ~2 min) — ver
[`docs/AUTO_SYNC.md`](../../AUTO_SYNC.md). Deploy manual, quando necessário:

```bash
ssh server-desktop
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git pull
set -a && source ~/.config/geoforest/backend.env && set +a && pnpm run build
systemctl --user restart geoforest-backend.service
```

Frontend: `npx firebase deploy --only hosting` (site `ia-florestal`).

## 2. Variáveis a criar no servidor

Hoje o `backend.env` tem `GROQ_API_KEY`, `DEEPSEEK_API_KEY`, `SEMA_WMS_BASE_URL` e
`SEMA_WMS_AUTHKEY` — **nenhuma** variável `SIMCAR_AUAS_*` existe lá (conferido em
2026-08-05). Acrescentar, na ordem do rollout, as do doc [08 §6](08-contratos-e-persistencia.md).

Todas começam **desligadas**. Cada `true` é uma decisão consciente, não um efeito
colateral de deploy.

## 3. Rollout por fase

```
Fase 1 → SIMCAR_AUAS_V2_ENABLED=true
   pré-requisito: conjunto dourado da Fase 1 aprovado + live do DeepSeek
   rollback: voltar a false → o botão volta ao fluxo V1 (2008–2024)

Fase 2 → SIMCAR_AUAS_POS2008_ENABLED=true
   pré-requisito: Fase 1 estável em produção por ≥1 semana + dourado da Fase 2
   rollback: voltar a false → botão 2 some do painel; resultados já gravados
             continuam legíveis

Fase 3 → SIMCAR_AC_VEG_ENABLED=true
   pré-requisito: Fase 2 estável + conferência no GIS de ≥3 imóveis reais
   rollback: idem
```

Uma flag desligada **esconde o botão**, não quebra o histórico: blocos já persistidos
continuam sendo renderizados.

## 4. Observabilidade

Logar (sem payload sensível, sem `authkey`, sem base64 de imagem):

- por job: fase, `jobId`, nº de polígonos, `catalogVersion`, duração total;
- por janela: polígono, janela, modelo, `requestId`, tokens de entrada/saída,
  `x-ratelimit-remaining-tokens`, retries;
- por cena: layer, ano, `imageSha256`, score de qualidade, usabilidade;
- resultados agregados por status (para acompanhar taxa de `INCONCLUSIVO` — se subir,
  é sinal de catálogo ou resolução ruins, não de propriedade limpa).

Alarme informal útil: **taxa de inconclusivo > 30%** numa execução → investigar antes de
mostrar o laudo como definitivo.

## 5. Custos e limites operacionais

| Fase | Janelas/polígono | Tokens estimados/polígono | Tempo estimado/polígono |
|---|---|---|---|
| 1 | 3 | ~16k | ~2–3 min |
| 2 | 5 (+1 ponte eventual) | ~27–33k | ~4–6 min |
| 3 | 1 | ~5,5k | ~1 min |

Com 8k TPM, um imóvel de 17 AUAS + 9 AC custa aproximadamente **45 min (F1) + 1h20 (F2)
+ 9 min (F3)**. Daí a exigência de prévia, ETA honesto, cancelamento e retomada — sem
isso o usuário acha que travou.

`SIMCAR_AUAS_MAX_POLYGONS_PER_JOB` continua em `0` (sem corte). Se um teto for adotado,
a rota **recusa antes de processar** e informa o usuário; jamais analisa "os primeiros N".

## 6. Armazenamento

- Checkpoints: `<STORAGE_ROOT>/analise-pos-recorte/checkpoints/<jobId>.json`.
- Cenas: **não** persistir a imagem bruta por padrão — só proveniência + hash. Se for
  necessário exibir a cena no laudo, seguir o caminho que a Fase 1 já usa
  (`storedImageUrl` sob `users/<uid>/`), respeitando o modelo de capability-URL do
  `/api/storage`.
- Limpeza: checkpoints de jobs concluídos há mais de 30 dias podem ser removidos por
  rotina; o resultado persistido no histórico é o que importa.

## 7. Documentação a produzir junto com o código

| Documento | Quando |
|---|---|
| `docs/ANALISE_POS_RECORTE.md` | ao concluir a Fase 2 — doc de referência do fluxo das 3 fases |
| `docs/CHANGELOG_<data>_ANALISE_POS_RECORTE_F1.md` | ao ligar a Fase 1 |
| `docs/CHANGELOG_<data>_ANALISE_POS_RECORTE_F2.md` | ao entregar a Fase 2 |
| `docs/CHANGELOG_<data>_ANALISE_POS_RECORTE_F3.md` | ao entregar a Fase 3 |
| `STATUS.md` deste plano | atualizado a cada fase concluída |
| `.claude/CLAUDE.md` (tabela Key Files) | ao criar `pos2008/` e `ac-vegetacao/` |
