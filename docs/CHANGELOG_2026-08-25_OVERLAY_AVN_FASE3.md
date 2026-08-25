# 2026-08-25 — Overlay AVN na análise de vegetação na AC

A Fase 3 mantém as análises pós-recorte independentes. A cena Sentinel-2 do
estado atual agora usa **zoom to layer combinado AC + AVN** e inclui as geometrias
`AVN` do recorte que encostam na AC:

- AC analisada: contorno/preenchimento vermelho;
- AVN declarada: contorno/preenchimento amarelo;
- NIR e SPOT permanecem sem esse overlay para não poluir a leitura espectral.

A IA recebe a mesma quantidade de imagens de antes: a primeira cena enquadra a extensão
combinada AC + AVN; NIR e SPOT continuam focadas na AC. Não existe quarta imagem nem
segunda rodada de visão. O prompt explica as cores para a comparação entre o declarado
e o visível.

O loop mostrado no cabeçalho da aba vetorizada também foi removido. A importação do ZIP
agora é persistida diretamente como `completed/done`; o recuperador legado que relançava
AC/AVN e depois AUAS foi eliminado; e o polling do cabeçalho ignora endpoints das análises
dos cards. Concluir uma análise não reabre a importação nem dispara outra análise.

Arquivos principais:

- `backend/analise-pos-recorte/wms-scenes.ts`
- `backend/analise-pos-recorte/ac-vegetacao/scenes.ts`
- `backend/analise-pos-recorte/ac-vegetacao/orchestrator.ts`
- `backend/analise-pos-recorte/ac-vegetacao/groq-vision-client.ts`
- `client/src/dashboard/hooks/useSimcarAnalysisFlow.ts`
- `client/src/pages/Dashboard.tsx`
- `client/src/dashboard/lib/normalizers-simcar.ts`

Validação local: `tsc --noEmit`, testes do orquestrador AC_VEG, regressão dos endpoints
vetorizados e build de produção.
