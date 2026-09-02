# Relatórios de recorte com imagens do acervo local

## Correção do resumo e do anexo

- O anexo pós-recorte não atribui automaticamente à SEMA imagens que podem ser do WMS local. A fonte concreta continua identificada nas camadas e nos metadados das cenas.
- Resultado pré-2008 inconclusivo não pode ser descrito como evidência de supressão posterior. Ausência de evidência não comprova a data da conversão.
- Vegetação na AC com resultado inconclusivo não recebe indicação verde de ausência de vegetação apenas porque nenhuma detecção foi confirmada.
- PDF e DOCX consomem o mesmo modelo em `backend/simcar/report-theme.ts`.
- A origem dos vetores não presume consulta direta ao WFS estadual: também admite a cópia SIMCAR local, identificada no registro da execução.

Verificação: 78 testes de `report-annex`, `report-theme` e `report-docx` passaram no Windows.

## Execução operacional por ZIP no servidor

Entrada pelo `processClip`: buffer do ZIP, `carNumber=null`, `sigefParcelCode=null`. A identificação do CAR é apenas atributo de saída; não substitui o polígono enviado. Preservar o ZIP original e conferir SHA-256 entre Windows e servidor.

O recorte usa `local-wfs-client.ts`, sobre a base SIMCAR publicada no GeoServer local. Ausência de camada publicada deve permanecer explícita; não significa ausência ambiental da feição.

Na execução direta das três fases, selecionar cenas do catálogo curado, validar GetCapabilities/GetMap e cobertura na extensão do imóvel, injetar o catálogo pós-2008 e bloquear fonte externa. Passar o UID real para persistir as mesmas imagens utilizadas pela análise. Registrar fontes, limitações e checkpoints junto aos artefatos privados, nunca no Git.

Limitação operacional: as três fases ainda possuem padrões históricos de fonte SEMA no módulo `wms-scenes.ts` e no catálogo pós-2008. Configurar a execução direta apenas não altera esses padrões globais. Não apresentar uma execução configurada como prova de migração de todas as rotas online.

Se Sentinel-2 RGB/NIR não existe no acervo local, declarar a indisponibilidade na fase AC_VEG. Não usar Landsat com rótulo de Sentinel. O relatório é apoio à revisão técnica, não declaração de regularidade.
