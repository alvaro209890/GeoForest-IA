# Vértices Próximas

Data: 2026-05-26

Este documento registra o módulo **Vértices Próximas**, criado para identificar pares de vértices muito próximos em shapefiles poligonais do SIMCAR sem comparar polígonos, feições, partes ou anéis diferentes.

## Objetivo

O módulo recebe um arquivo `.zip` contendo um ou mais shapefiles, lista as camadas poligonais encontradas e gera pontos para conferência técnica:

- `pontos_vertices_proximas.shp`: ponto médio de cada par encontrado.
- `vertices_pares.shp`: pontos originais A/B de cada par, quando habilitado.
- `resumo_vertices.csv`: resumo tabular, quando habilitado.
- `relatorio_vertices.txt`: relatório técnico, quando habilitado.

## Regra principal

A comparação é feita somente dentro do mesmo grupo:

```text
camada + feição + parte + anel
```

O módulo nunca compara:

- vértices de feições diferentes;
- vértices de partes/polígonos diferentes;
- vértices de anéis diferentes;
- polígonos que apenas se encostam.

Antes da comparação, o último ponto do anel é removido quando ele repete o primeiro ponto, pois isso é apenas o fechamento natural do polígono.

## Interface

A aba **Vértices Próximas** fica no menu principal ao lado de **CBERS**.

Fluxo da tela:

1. Upload do ZIP.
2. Listagem das camadas encontradas.
3. Configuração por camada:
   - selecionar/anular análise;
   - quantidade de pontos desejada;
   - tolerância específica em mm;
   - CRS manual quando o `.prj` estiver ausente.
4. Configurações globais:
   - tolerância padrão em mm;
   - gerar vértices A/B;
   - gerar relatório TXT;
   - gerar CSV;
   - manter CRS original;
   - usar CRS métrico temporário.
5. Processamento com barra de progresso.
6. Resultado em tabela e download do ZIP.


## Histórico e cards laterais

A aba **Vértices Próximas** mantém o mesmo padrão de navegação do **Recorte SIMCAR**:

- cada processamento iniciado aparece como card no canto esquerdo da tela;
- jobs em andamento podem ser reabertos pelo card e continuam recebendo progresso por SSE;
- jobs concluídos mostram percentual, status, total de pares encontrados e quantidade de camadas analisadas;
- ao concluir, o frontend cria uma conversa vinculada em `users/<uid>/conversations` com `kind: vertices_proximas` e `verticesJobId`;
- o documento do job em `users/<uid>/vertices_jobs/<jobId>` recebe `conversationId`, evitando duplicidade de conversa;
- conversas de workflow (`simcar_recorte` e `vertices_proximas`) ficam fora da lista geral de chat e aparecem na sidebar da respectiva aba;
- excluir o card remove o job de `vertices_jobs` e também a conversa vinculada.

Esse vínculo permite recuperar o resultado depois de trocar de aba, recarregar o frontend ou reiniciar o backend.

## Backend

Arquivo principal:

```text
backend/vertices-proximas.ts
```

Rotas:

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/vertices/upload` | Recebe ZIP em base64, salva entrada e lista camadas |
| POST | `/api/vertices/process` | Inicia processamento assíncrono |
| GET | `/api/vertices/jobs/:jobId/events` | Eventos SSE de progresso |
| GET | `/api/vertices/jobs/:jobId/status` | Snapshot do job |
| GET | `/api/vertices/download/:jobId` | Download do ZIP final |
| DELETE | `/api/vertices/jobs/:jobId` | Cancela/remove job |

O backend usa o storage local do projeto:

```text
users/<uid>/vertices/input
users/<uid>/vertices/output
users/<uid>/vertices_jobs
```

## CRS e distância

Se o shapefile estiver em CRS geográfico, como `EPSG:4674` ou `EPSG:4326`, a distância não é calculada em graus. O backend estima um UTM temporário pelo centro da camada, reprojeta os vértices somente para calcular distância em metros e mantém as coordenadas originais nos shapefiles de saída.

Se o `.prj` estiver ausente, a interface exige CRS manual. O padrão sugerido é `EPSG:4674`.

## Tolerância

A tolerância é filtro máximo. Para cada camada, o sistema retorna até `N` pares com distância menor ou igual à tolerância efetiva:

- tolerância da camada, se informada;
- tolerância padrão global, caso contrário.

Se houver menos pares que o solicitado, o sistema retorna os disponíveis e registra aviso no resultado/relatório.

## Campos de saída

`pontos_vertices_proximas.shp`:

```text
camada, ranking, feicao, parte, anel, vertice_a, vertice_b,
dist_m, dist_cm, dist_mm, x_a, y_a, x_b, y_b, x_medio, y_medio
```

`vertices_pares.shp`:

```text
camada, ranking, ponto_tipo, feicao, parte, anel, vertice, dist_m, dist_mm
```

## Testes

Arquivo:

```text
backend/vertices-proximas.test.ts
```

Cenários cobertos:

- tolerância como filtro máximo;
- fechamento natural do anel ignorado;
- ausência de comparação entre feições diferentes;
- ausência de comparação entre anel exterior e anel interior.

Comando:

```bash
npx vitest run --root . backend/vertices-proximas.test.ts backend/shapefile-writer.test.ts
```
