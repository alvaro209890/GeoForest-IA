# WMS local, CBERS e acervo permanente

Este documento descreve o WMS que roda neste PC, publicado por Cloudflare Tunnel, e a integracao da aba CBERS com o acervo permanente em HD Backup.

## Arquitetura

Fluxo publico:

```text
https://wms.cursar.space
  -> Cloudflare Tunnel geoserver-wms
  -> http://127.0.0.1:8082
  -> /home/server/.local/bin/geoserver_wms_public_proxy.py
  -> http://127.0.0.1:8081/geoserver
  -> GeoServer local
```

Servicos systemd do usuario:

```text
geoserver-wms.service                 GeoServer local em 8081
geoserver-wms-public-proxy.service    proxy publico em 8082
geoserver-wms-tunnel.service          Cloudflare Tunnel
geoforest-backend.service             backend GeoForest em 3001
```

Configuracao do tunnel:

```text
/home/server/.cloudflared/config.yml
```

Hostnames relevantes:

```text
https://wms.cursar.space              WMS publico
https://geoforest-api.cursar.space    API GeoForest
https://ia-florestal.web.app          app principal Firebase Hosting
https://geoforest-admin.web.app       painel publico de administracao CBERS
```

## Estrutura do acervo CBERS

O GeoServer usa o workspace `cbers`. Os GeoTIFFs reais do acervo CBERS ficam no HD Backup:

```text
/media/server/HD Backup/RASTER/CBERS_4A/<orbita_ponto>/<ano>/
```

Exemplo:

```text
/media/server/HD Backup/RASTER/CBERS_4A/212_129/2025/CBERS_4A_WPM_20250818_212_129_L4_C342_PAN.TIF
```

O `GEOSERVER_DATA_DIR` fica em:

```text
/home/server/geoserver_data
```

O GeoServer aponta para os GeoTIFFs por `coveragestore.xml`, mas a publicacao automatica nova usa a REST API local do GeoServer:

```text
http://127.0.0.1:8081/geoserver/rest
```

Credenciais padrao locais, com override por variaveis de ambiente:

```text
GEOSERVER_USER=admin
GEOSERVER_PASSWORD=geoserver
GEOSERVER_WORKSPACE=cbers
GEOSERVER_BASE_URL=http://127.0.0.1:8081/geoserver
```

## Organizacao no WMS

A arvore de grupos mantida para CBERS e:

```text
RASTER
  CBERS-4A-Apos_2019
    orbit_<orbita>_<ponto>
      orbit_<orbita>_<ponto>_y<ano>
        cbers:<layer>
```

Exemplo:

```text
RASTER
  CBERS-4A-Apos_2019
    orbit_214_128
      orbit_214_128_y2026
        cbers:214_128_2026_cbers_4a_wpm_20260110_214_128_l4_c342_pan_j47fa5471
```

O proxy publico filtra o GeoServer e expoe apenas os endpoints WMS/WFS/WMTS permitidos. Para `GetCapabilities` do workspace `cbers`, ele tambem reorganiza a resposta publica para exibir os grupos principais esperados.

## Fluxo da aba CBERS

A aba CBERS nao usa o WMS para gerar as imagens. Ela usa o STAC do INPE:

```text
CBERS_STAC_ROOT=https://data.inpe.br/bdc/stac/v1
CBERS collection=CB4A-WPM-L4-DN-1
```

Fluxo de processamento:

```text
1. Usuario envia ZIP da area.
2. Backend busca cenas CBERS-4A/WPM no STAC do INPE.
3. Backend baixa bandas BAND3, BAND4, BAND2 e BAND0.
4. GDAL recorta, fusiona PAN e gera GeoTIFF final C342_PAN.
5. GeoTIFF e salvo no banco local da conta.
6. GeoTIFF tambem e copiado para o acervo permanente do HD Backup.
7. Backend publica automaticamente o GeoTIFF no GeoServer/WMS.
8. Para lote, o ZIP da conta e criado com todos os TIF nomeados no padrao.
```

Arquivo da conta:

```text
/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest/users/<uid>/cbers/output/
```

Arquivo permanente:

```text
/media/server/HD Backup/RASTER/CBERS_4A/<orbita_ponto>/<ano>/
```

## Padrao de nomes

Downloads da conta mantem o padrao limpo:

```text
CBERS_4A_WPM_20250818_212_129_L4_C342_PAN.TIF
```

No acervo permanente HD/WMS, recortes diferentes da mesma cena recebem sufixo curto do job para evitar sobrescrita:

```text
CBERS_4A_WPM_20260110_214_128_L4_C342_PAN_J47FA5471.TIF
```

O nome da layer WMS e normalizado em minusculo:

```text
cbers:214_128_2026_cbers_4a_wpm_20260110_214_128_l4_c342_pan_j47fa5471
```

## Regras de exclusao

Exclusao feita pelo usuario na aba CBERS:

```text
remove historico/arquivo da conta
mantem arquivo no HD Backup
mantem layer no GeoServer/WMS
marca userDeletedAt no indice global
```

Exclusao feita no painel admin:

```text
remove coverage store/layer do GeoServer com recurse=true
remove a layer dos grupos orbit/ano quando necessario
remove o GeoTIFF permanente do HD Backup
marca adminDeletedAt no indice global
```

## Indice global do acervo

O backend mantem um indice local das imagens CBERS publicadas:

```text
/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest/cbers_archive/images/
```

Cada JSON registra:

```text
imageId
uid
jobId
itemId
orbit
year
archiveFilename
hdPath
bytes
wmsLayerName
wmsPublicUrl
createdAt
userDeletedAt
adminDeletedAt
```

## Painel admin CBERS

Site publico, sem autenticacao:

```text
https://geoforest-admin.web.app
```

APIs publicas do backend:

```text
GET    /api/admin/cbers-storage/summary
GET    /api/admin/cbers-storage/users/:uid/images
DELETE /api/admin/cbers-storage/images/:imageId
```

O painel mostra:

```text
uso total por conta
quantidade de imagens ativas
lista de imagens por usuario
status: ativa, removida da conta, excluida do HD/WMS
botao de exclusao definitiva do HD/WMS
```

## Build e deploy

Build completo:

```bash
npm run build
```

Esse comando gera:

```text
dist/public    app principal
dist/admin     painel admin
dist/index.js  backend
```

Deploy Firebase Hosting:

```bash
firebase deploy --only hosting --project ia-florestal
```

Reiniciar backend local:

```bash
systemctl --user restart geoforest-backend.service
```

Validacoes rapidas:

```bash
curl -sS https://geoforest-api.cursar.space/api/admin/cbers-storage/summary
curl -fsSI https://geoforest-admin.web.app
curl -sS "https://wms.cursar.space/geoserver/cbers/wms?service=WMS&version=1.3.0&request=GetCapabilities"
```

## Arquivos principais no codigo

```text
backend/cbers-wpm.ts       processamento CBERS da conta
backend/cbers-archive.ts   acervo permanente, GeoServer REST e APIs admin
backend/index.ts           CORS, registro de rotas e servico HTTP
client/src/admin/main.tsx  painel admin publico
firebase.json              Firebase Hosting multi-site
vite.config.ts             build separado app/admin
```
