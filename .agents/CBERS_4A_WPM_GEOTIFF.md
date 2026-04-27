# CBERS-4A/WPM GeoTIFF - Aba de geração 3-4-2 + PAN

## Objetivo

A aba `CBERS 4A WPM` gera um GeoTIFF visual georreferenciado para ArcMap a partir da coleção pública do INPE:

`https://data.inpe.br/bdc/stac/v1/collections/CB4A-WPM-L4-DN-1`

O produto usa:

- `BAND3` como canal vermelho
- `BAND4` como canal verde
- `BAND2` como canal azul
- `BAND0` pancromática para fusão/pansharpen

## Fluxo

1. Frontend envia ZIP da área para `POST /api/cbers-wpm/search`.
2. Backend lê o shapefile, calcula bbox em EPSG:4326 e consulta itens STAC da coleção `CB4A-WPM-L4-DN-1`.
3. Backend retorna geometria do imóvel, footprint/bbox da cena, cobertura percentual e bloqueio se a cena não cobrir 100%.
4. Usuário filtra por data, ordena as cenas, abre o card de pré-visualização com mapa e seleciona uma ou mais cenas.
5. Frontend consulta `POST /api/cbers-wpm/estimate` para estimar download, GeoTIFF final e tempo por cena.
6. Frontend inicia `POST /api/cbers-wpm/jobs` com ZIP + `itemIds`.
7. Backend inicia job assíncrono persistido em:
   `users/<uid>/cbers_wpm_jobs/<jobId>.json`
8. Frontend acompanha:
   - live: `GET /api/cbers-wpm/jobs/<jobId>/events`
   - fallback/reload: `GET /api/cbers-wpm/jobs/<jobId>/status`
9. Backend salva somente os GeoTIFFs finais em:
   `users/<uid>/cbers/output/<jobId-or-scene>.tif`
10. Bandas temporárias e recortes intermediários são apagados de `/tmp/geoforest-cbers-wpm/<jobId>` no `finally`.

## Dependências

O servidor precisa ter GDAL no PATH:

```bash
gdalinfo --version
which gdalwarp
which gdal_translate
which gdal_pansharpen.py
```

No servidor atual foi validado:

`GDAL 3.8.4`

## Progresso

A barra do frontend deve refletir etapas reais:

- leitura da geometria
- consulta da cena no STAC
- downloads por bytes quando o INPE retorna `Content-Length`
- execução de `gdalwarp` por banda
- execução de `gdal_pansharpen.py`
- execução de `gdal_translate`
- cópia do GeoTIFF final para o armazenamento do usuário
- limpeza dos temporários

Não substituir por progresso puramente simulado. Em etapas GDAL sem percentual contínuo, avançar somente pelo progresso reportado pelo comando ou pela conclusão real da etapa.

## Endpoints

- `POST /api/cbers-wpm/search`
  - body: `{ propertyZip: string, filename?: string, dateStart?: "YYYY-MM-DD", dateEnd?: "YYYY-MM-DD" }`
  - retorna: `{ areaHa, bbox, propertyGeometry, collection, scenes[] }`
  - cada cena deve incluir `geometry`, `coveragePercent`, `coversArea` e assets disponíveis.

- `POST /api/cbers-wpm/estimate`
  - body: `{ propertyZip: string, itemIds: string[] }`
  - retorna estimativa por cena com bytes reais via `HEAD` quando o INPE retorna `Content-Length`.

- `POST /api/cbers-wpm/jobs`
  - body: `{ propertyZip: string, filename?: string, itemId?: string, itemIds?: string[] }`
  - retorna: `{ jobId }`
  - `itemId` único continua aceito para compatibilidade.
  - `itemIds` gera um batch com um GeoTIFF separado por cena e concorrência máxima 2.

- `GET /api/cbers-wpm/jobs/:jobId/status`
  - retorna o documento persistido do job.

- `GET /api/cbers-wpm/jobs/:jobId/events`
  - stream SSE autenticado por `fetch`, não por `EventSource`, porque o app usa Bearer token.

- `DELETE /api/cbers-wpm/jobs/:jobId`
  - cancela se ainda estiver rodando, remove GeoTIFF final e remove o documento do histórico.

## Regra de manutenção

- Não salvar bandas brutas no armazenamento do usuário.
- Não depender apenas do stream aberto para representar estado; o documento em `cbers_wpm_jobs` precisa ser suficiente para reidratar a UI após reload.
- Não trocar para scraping do catálogo `dgi.inpe.br/catalogo/explore`; usar STAC público do `data.inpe.br`.
- Se mover para Render ou outro deploy, documentar instalação de GDAL antes de habilitar a aba em produção.
- O clique em uma cena deve abrir o card/modal de pré-visualização; a geração só deve acontecer após seleção explícita.
- Cenas com `coversArea === false` devem ficar bloqueadas para geração.
- Multi-cena gera arquivos separados, não mosaico único.
