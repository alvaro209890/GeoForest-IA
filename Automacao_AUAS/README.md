# Automação AUAS × Alertas SCCON (SEMA-MT)

Documentação para **reimplementar em outro sistema** a atualização automática da data de abertura (`ABERTURA`) dos polígonos **AUAS** (Área de Uso Alternativo do Solo / SIMCAR) com base nos **alertas de desmate** da plataforma pública:

- Dashboard: https://alertas.sccon.com.br/matogrosso/#/dashboard/view-map  
- Organização: SEMA/MT — `597953b9-ee78-4113-80f9-803dbbaa60a0`

## O que o fluxo faz

1. Obtém **token JWT público** (sem login de usuário final).
2. Consulta **WFS/GeoServer** dos alertas no **bbox** da propriedade/AUAS.
3. Para cada `idt_local_alert`, busca **data de detecção** + geometria na API REST.
4. Faz **spatial join** (intersects) com o shapefile `AUAS.shp`.
5. Grava em `ABERTURA` a **data mais antiga** dos alertas que tocam o polígono (primeira detecção de conversão).
6. (Opcional) Gera **shape de pontos** das AUAS sem alerta.

## Conteúdo desta pasta

| Arquivo | Descrição |
|---------|-----------|
| [ENDPOINTS.md](./ENDPOINTS.md) | Catálogo de APIs, WMS/WFS, payloads, headers, erros |
| [FLUXO.md](./FLUXO.md) | Pipeline passo a passo + diagramas + regras de negócio |
| [SCHEMA.md](./SCHEMA.md) | Campos AUAS, alertas, relatórios, classes |
| [IMPLEMENTACAO.md](./IMPLEMENTACAO.md) | Guia para portar (Node, Python, backend GIS) |
| [atualizar_datas_auas_sccon.py](./atualizar_datas_auas_sccon.py) | Script de referência (Python + GeoPandas) |
| [requirements.txt](./requirements.txt) | Dependências Python |
| [exemplos/](./exemplos/) | cURL e trechos JSON de exemplo |

## Dependências (referência Python)

```text
geopandas
pandas
shapely
pyogrio   # ou fiona
```

```bash
pip install -r requirements.txt
python atualizar_datas_auas_sccon.py --auas "../Arquivo_Enviado_AUAS/AUAS.shp"
```

## Pré-requisitos de entrada

- Shapefile **AUAS** com pelo menos:
  - `geometry` (Polygon/MultiPolygon), CRS preferencial **EPSG:4674** (SIRGAS 2000)
  - `ABERTURA` (texto brasileiro **DD/MM/YYYY**, ex.: `02/07/2023`)
  - `ID` (identificador opcional do polígono)
- Rede com acesso a `*.sccon.com.br` (Cloudflare: use `User-Agent` de browser).

## Saídas típicas

| Artefato | Uso |
|----------|-----|
| `AUAS.shp` atualizado | Pacote SIMCAR / Arquivo Enviado |
| `sccon_alertas_*.geojson` | Cache dos alertas baixados |
| `AUAS_SEM_ALERTA_SCCON_PONTOS.shp` | Pontos das AUAS sem interseção |
| `RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json` | Auditoria por polígono |

## Avisos importantes

- Os alertas SCCON-MT começam em **2019-07-22**. Conversões anteriores **não** terão data SCCON.
- O endpoint de busca por geometria `POST .../api/alerts/search?oldGeomCompatibility=true` costuma **timeout/504** em períodos longos; o caminho estável é **WFS + localAlerts**.
- Token público expira (campo `exp` em ms). Renove a cada job.
- Dashboard público tem role `DOWNLOAD_ALERTS` / `VIEW`; não depende de senha de usuário final.
- Serviço de terceiros: trate indisponibilidade, rate limit e mudança de URL/camada.

## Origem / validação (Fazenda Macare 1–7)

Execução de referência (2026-07-17):

- 194 alertas no bbox
- 9/32 polígonos AUAS atualizados (~98,8% da área AUAS)
- 23 polígonos sem alerta (~41,6 ha) → shape de pontos

Ver projeto pai: `../Arquivo_Enviado_AUAS/`, `../RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json`.
