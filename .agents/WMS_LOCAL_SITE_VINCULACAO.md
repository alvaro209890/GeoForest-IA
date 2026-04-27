# Vinculacao WMS local com o site GeoForest

Este documento registra como o WMS que roda neste PC fica disponivel para o site e para o backend do repositorio.

## Fluxo publico

```text
https://ia-florestal.web.app
  -> Firebase Hosting
  -> redirect /api/* para https://geoforest-api.cursar.space/api/*
  -> geoforest-backend.service em http://127.0.0.1:3001
  -> GeoServer REST local em http://127.0.0.1:8081/geoserver/rest
  -> publica GeoTIFF no workspace cbers
  -> WMS publico em https://wms.cursar.space/geoserver/cbers/wms
```

```text
https://wms.cursar.space
  -> Cloudflare Tunnel geoserver-wms
  -> http://127.0.0.1:8082
  -> /home/server/.local/bin/geoserver_wms_public_proxy.py
  -> http://127.0.0.1:8081/geoserver
  -> GeoServer local
```

## Servicos locais

```text
geoforest-backend.service             backend do site em 127.0.0.1:3001
geoserver-wms.service                 GeoServer local em 127.0.0.1:8081
geoserver-wms-public-proxy.service    proxy publico em 127.0.0.1:8082
geoserver-wms-tunnel.service          Cloudflare Tunnel do WMS publico
```

Configuracao do tunnel:

```text
/home/server/.cloudflared/config.yml
```

## Hostnames

```text
https://ia-florestal.web.app          front principal
https://geoforest-admin.web.app       painel admin CBERS
https://geoforest-api.cursar.space    API publica do backend
https://wms.cursar.space              proxy publico do GeoServer/WMS
```

O `firebase.json` publica dois hostings. Ambos redirecionam `/api/**` para:

```text
https://geoforest-api.cursar.space/api/:path
```

## GeoServer e acervo

Workspace padrao:

```text
cbers
```

GeoServer REST local usado pelo backend:

```text
GEOSERVER_BASE_URL=http://127.0.0.1:8081/geoserver
GEOSERVER_WORKSPACE=cbers
GEOSERVER_PUBLIC_WMS_BASE=https://wms.cursar.space/geoserver/cbers/wms
GEOSERVER_DATA_DIR=/home/server/geoserver_data
```

Acervo permanente CBERS no HD:

```text
/media/server/HD Backup/RASTER/CBERS_4A/<orbita_ponto>/<ano>/
```

Indice local das publicacoes:

```text
/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest/cbers_archive/images/
```

Arquivos da conta do usuario:

```text
/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest/users/<uid>/cbers/
```

## Publicacao CBERS

A aba CBERS gera a imagem a partir do STAC do INPE, nao a partir do WMS. Depois de processar a cena, o backend publica o GeoTIFF final no GeoServer.

Fluxo de uma cena:

```text
1. Front busca cenas por ZIP/SHP ou por orbita, ponto e data.
2. Backend consulta o STAC CBERS-4A/WPM do INPE.
3. Backend baixa BAND3, BAND4, BAND2 e BAND0 da folha completa.
4. GDAL executa pansharpen 3-4-2 + PAN na folha completa da orbita/ponto.
5. Backend gera GeoTIFF final para ArcMap e salva no usuario.
6. Backend copia o GeoTIFF para o acervo permanente.
7. Backend cria/atualiza coverage store e layer no GeoServer.
8. Backend encaixa a layer nos grupos RASTER/CBERS-4A-Apos_2019/orbita/ano.
9. Site passa a exibir o `wmsPublicUrl` salvo no indice e no historico.
```

O processamento CBERS publicado no WMS e baixado pelo usuario deve ser a folha completa da orbita/ponto baixada do INPE, nao um recorte do limite da propriedade.

## Grupos WMS

```text
RASTER
  CBERS-4A-Apos_2019
    orbit_<orbita>_<ponto>
      orbit_<orbita>_<ponto>_y<ano>
        cbers:<layer>
```

Exemplo:

```text
cbers:213_129_2026_cbers_4a_wpm_20260115_213_129_l4_c342_pan_j82dd5af9
```

## Exclusao

Exclusao do usuario:

```text
remove historico e arquivo da conta
mantem arquivo permanente no HD Backup
mantem layer no GeoServer/WMS
marca userDeletedAt no indice global
```

Exclusao admin:

```text
remove coverage store/layer no GeoServer com recurse=true
remove a layer dos grupos de orbita/ano
remove GeoTIFF permanente do HD Backup
marca adminDeletedAt no indice global
```

APIs admin:

```text
GET    /api/admin/cbers-storage/summary
GET    /api/admin/cbers-storage/users/:uid/images
DELETE /api/admin/cbers-storage/images/:imageId
```

