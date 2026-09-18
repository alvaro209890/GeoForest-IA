# Recorte SIMCAR por snapshot oficial — 18/09/2026

## Problema confirmado

O WMS da SEMA apenas renderiza a geometria oficial. O recorte antigo, porém,
consultava o WFS remoto por job e depois executava operações adicionais entre
as classes: `difference`, união de máscaras hidrográficas, prioridade
AC → AUAS → AVN, snap na divisa e, em uma versão intermediária, preenchimento
de vazios. Essas reconstruções podiam produzir sobreposição, deslocamento ou
um polígono muito estreito que não existia no WMS.

O shapefile mensal baixado do SIMCAR Digital não apresentava esse defeito. A
divergência era introduzida depois da leitura da fonte, dentro do pipeline do
GeoForest.

## Correção definitiva

- O recorte usa o snapshot mensal oficial já baixado e validado em
  `/media/server/HD Backup/VETOR/CAR_Digital/current`.
- As camadas são consultadas no GeoServer local `cbers` somente para seleção
  espacial; a origem do dado continua sendo o Shape-ZIP oficial da SEMA.
- A única operação sobre polígonos é `GEOSIntersection(feição_oficial, ATP)`.
- Não há snap, buffer corretivo, simplificação, prioridade entre classes,
  subtração de rios, preenchimento de vazio ou criação de filete.
- A validação de cobertura é somente leitura. Se houver vazio ou sobreposição
  acima de `0,01 m²`, o job é cancelado e nenhum ZIP é gerado.
- O manifest do snapshot é obrigatório, deve ter no máximo 45 dias e precisa
  conter as camadas críticas `AREA_CONSOLIDADA`, `AUAS`, `AVN` e
  `RIO_ATE_10` publicadas no GeoServer local.
- Resposta parcial, manifest inválido, base desatualizada ou GeoServer local
  fora do ar resultam em aviso ao usuário e cancelamento do recorte; não existe
  fallback silencioso.

## Atualização mensal

O servidor já mantém o download oficial com:

- unit: `~/.config/systemd/user/car-digital-sync.service`;
- timer: `~/.config/systemd/user/car-digital-sync.timer`;
- execução principal: dia 1 às 02:00, fuso `America/Sao_Paulo`;
- novas tentativas diárias às 02:00 somente enquanto o mês ainda não tiver um
  snapshot validado;
- promoção atômica para `current` somente depois do download, validação e
  publicação bem-sucedidos.

Na auditoria de 18/09/2026, o snapshot ativo era
`20260901T050002Z`, gerado em 01/09/2026, com 30 camadas e estado mensal
registrado como concluído.

## Regressões automatizadas

- interseção exata preserva área e atributos de feição inteiramente contida;
- uma fresta existente na fonte continua sendo fresta (nunca é preenchida);
- vazio estreito ou largo reprova sem alterar as camadas;
- sobreposição reprova sem apagar parte de nenhuma classe;
- resposta parcial do snapshot reprova;
- anéis minúsculos em coordenadas geográficas mantêm orientação correta na
  serialização Shapefile, evitando transformar shell em buraco;
- componentes poligonais degenerados de área zero da base oficial são descartados sem alterar nenhuma feição válida;
- GeoServer local cbers configurado com numDecimals=8 para preservar precisão sub-métrica em coordenadas SIRGAS 2000;
- divergências topológicas da base oficial da SEMA são medidas e registradas como aviso sem criar filetes artificiais.

## Validação executada

- `pnpm check`;
- `pnpm build`;
- `pnpm test`: 1.030 testes aprovados e 8 testes live ignorados;
- consulta real do imóvel de teste: 38.037,2953 ha, nove polígonos;
- disponibilidade no snapshot local confirmada na BBOX do imóvel para AC,
  AUAS, AVN, rios, lagoas, reservatórios, área úmida e ARL.

