# 2026-08-25 — Overlay AVN na análise de vegetação na AC

A Fase 3 mantém as três análises pós-recorte independentes. A cena Sentinel-2 do
estado atual agora inclui as geometrias `AVN` do recorte que encostam na AC:

- AC analisada: contorno/preenchimento vermelho;
- AVN declarada: contorno/preenchimento amarelo;
- NIR e SPOT permanecem sem esse overlay para não poluir a leitura espectral.

A IA recebe a mesma quantidade de imagens de antes. Não foi criado um novo ciclo de
download: o overlay é composto sobre a imagem já obtida, evitando o comportamento de
"fazer a imagem" novamente. O prompt explica as cores para a comparação entre o
declarado e o visível.

Arquivos principais:

- `backend/analise-pos-recorte/wms-scenes.ts`
- `backend/analise-pos-recorte/ac-vegetacao/scenes.ts`
- `backend/analise-pos-recorte/ac-vegetacao/orchestrator.ts`
- `backend/analise-pos-recorte/ac-vegetacao/groq-vision-client.ts`

Validação: `tsc --noEmit`, testes do orquestrador AC_VEG e build de produção.
