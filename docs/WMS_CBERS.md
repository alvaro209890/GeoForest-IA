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
1. Usuario busca cenas por ZIP/SHP ou por orbita, ponto e data.
2. Backend busca cenas CBERS-4A/WPM no STAC do INPE.
3. Backend baixa bandas BAND3, BAND4, BAND2 e BAND0 da folha completa.
4. gdal_pansharpen.py fusiona PAN (BAND0) com 3-4-2 -> raster 16 bits.
5. gdal_translate converte para GeoTIFF 8 bits RGB aplicando realce de
   contraste por banda (ver "Realce de contraste" abaixo).
6. Backend valida o georreferenciamento nativo contra a footprint STAC da
   propria cena (sem comparar com outra aquisicao).
7. GeoTIFF e salvo no banco local da conta.
8. GeoTIFF tambem e copiado para o acervo permanente do HD Backup, com
   overviews (.ovr) reamostrados por media para zoom-out suave.
9. Backend publica automaticamente o GeoTIFF no GeoServer/WMS (com retry).
10. Para lote, o ZIP da conta e criado com todos os TIF nomeados no padrao.
```

Regra operacional: a imagem CBERS baixada pelo usuario e publicada no WMS representa a folha completa da orbita/ponto baixada do INPE. O SHP, quando enviado, serve para busca e validacao de cobertura; ele nao recorta o GeoTIFF final.

## Realce de contraste (qualidade da imagem)

A cena pansharpened sai do INPE em 16 bits com valores concentrados numa
faixa estreita. Um `gdal_translate -scale` simples estica cada banda do
minimo absoluto ao maximo absoluto, entao alguns pixels de nuvem/saturacao
achatam o histograma e a imagem fica escura e lavada (numa cena tipica a
media das bandas cai para DN ~20-70 de 255).

A partir desta versao o passo de conversao para 8 bits corta a cauda clara em
`media + N*desvio` (N = `CBERS_STRETCH_SIGMA`, padrao 2.5), controlado por
`CBERS_STRETCH_MODE`:

```text
global  (padrao)  um unico [lo, hi] para as 3 bandas -> clareia e contrasta
                  SEM mudar o balanco de cor (preserva o 342 verde de sempre)
perband           [lo, hi] independente por banda -> contraste maximo, mas
                  MUDA a cor (falsa-cor magenta/verde). Use so se quiser.
minmax            comportamento antigo (min..max absoluto, escuro)
```

Por que dois modos: o realce `perband` faz um balanco de branco automatico que
deixa a imagem no padrao falsa-cor (solo magenta, vegetacao verde) — otimo
tecnicamente, mas troca o aspecto. O `global` aplica a MESMA transformacao nas
3 bandas, entao a razao entre elas (o tom) nao muda: a cena fica com o mesmo
verde de hoje, so que mais clara e com bem mais contraste/detalhe. Por isso o
padrao e `global`.

Em ambos o piso de saida e 0 e o corte inferior e limitado a >= 0, entao os
pixels de borda (valor 0) continuam transparentes via `-a_nodata 0`. As
estatisticas usam `-approx_stats` (`CBERS_STRETCH_APPROX=1`, subamostragem
rapida) e, se falharem, o pipeline cai no `-scale` antigo — nunca quebra a
geracao. As imagens Int16 antigas ja publicadas no acervo nao sao afetadas; o
realce vale para novas geracoes.

## Publicacao automatica robusta

A publicacao usa a REST do GeoServer e agora tolera o GeoServer reiniciando
(ex.: logo apos um deploy):

```text
GEOSERVER_READY_TIMEOUT_MS     espera o GeoServer responder antes de publicar
GEOSERVER_PUBLISH_RETRIES      re-tentativas em erro de rede / HTTP 5xx
GEOSERVER_PUBLISH_RETRY_DELAY_MS  intervalo entre tentativas
```

Antes era possivel uma cena terminar o processamento, encontrar o GeoServer
fora do ar por alguns segundos e nao ser publicada. Agora ela aguarda e
re-tenta.

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

No acervo permanente HD/WMS, a folha publicada recebe sufixo curto do job para evitar sobrescrita operacional:

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

## Puxar no servidor do WMS (deploy)

O backend que gera e publica CBERS roda **no proprio PC do WMS**, pelo
servico `geoforest-backend.service`, a partir do checkout:

```text
/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA
```

Fluxo recomendado apos um `git pull` nesse checkout:

```bash
cd "/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
git pull --rebase --autostash origin main
scripts/cbers-doctor.sh        # preflight: GDAL, GeoServer, acervo (HD 2 TB)
npm run build                  # regenera dist/index.js
systemctl --user restart geoforest-backend.service
```

O script `scripts/deploy-firebase-restart-backend.sh` ja faz tudo isso
(incluindo o preflight `cbers-doctor` de forma nao-bloqueante) e ainda publica
o Firebase Hosting e da push no GitHub.

### Preflight: cbers-doctor

`scripts/cbers-doctor.sh` confirma que o ambiente esta pronto para gerar e
publicar:

```text
- ferramentas GDAL no PATH (inclui gdal_pansharpen.py e gdal_edit.py)
- acervo CBERS_ARCHIVE_ROOT existe e e gravavel (HD de 2 TB montado)
- GeoServer REST respondendo e workspace 'cbers' presente
- raiz de symlinks externos gravavel
- WMS publico respondendo (aviso, nao bloqueia)
```

Ele carrega o mesmo `~/.config/geoforest/backend.env` do backend e usa os
defaults do codigo quando uma variavel nao esta definida. Sai com codigo != 0
se uma verificacao critica falhar.

### Variaveis de ambiente CBERS/WMS

Todas tem default embutido (ver `config/geoforest-backend.env.example`); so
defina para sobrescrever:

```text
CBERS_ARCHIVE_ROOT                 acervo dos GeoTIFFs (HD 2 TB)
GEOSERVER_BASE_URL                 REST local do GeoServer
GEOSERVER_USER / GEOSERVER_PASSWORD
GEOSERVER_WORKSPACE                workspace (cbers)
GEOSERVER_DATA_DIR                 data dir do GeoServer
GEOSERVER_EXTERNAL_CBRS_ROOT       raiz dos symlinks externos
GEOSERVER_PUBLIC_WMS_BASE          WMS publico (cloudflare)
CBERS_STRETCH_MODE                 global | perband | minmax
CBERS_STRETCH_SIGMA                N desvios (padrao 2.5)
CBERS_STRETCH_APPROX               1 = stats aproximadas (rapido)
CBERS_OVERVIEW_RESAMPLING          reamostragem das overviews (average)
GEOSERVER_PUBLISH_RETRIES          re-tentativas de publicacao
GEOSERVER_PUBLISH_RETRY_DELAY_MS   intervalo entre tentativas
GEOSERVER_READY_TIMEOUT_MS         espera o GeoServer subir antes de publicar
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
backend/cbers-wpm.ts        processamento CBERS, pansharpen, realce, validacao
backend/cbers-archive.ts    acervo permanente, GeoServer REST e APIs admin
backend/index.ts            CORS, registro de rotas e servico HTTP
scripts/cbers-doctor.sh     preflight CBERS/WMS no servidor
scripts/deploy-firebase-restart-backend.sh  deploy completo (pull+build+restart)
config/geoforest-backend.env.example  referencia das variaveis de ambiente
.agents/WMS_LOCAL_SITE_VINCULACAO.md  vinculo WMS local, API e site
client/src/admin/main.tsx   painel admin publico
firebase.json               Firebase Hosting multi-site
vite.config.ts              build separado app/admin
```
