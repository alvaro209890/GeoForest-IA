# Landsat — Monitoramento Histórico e Atual

tags: `Landsat` `TM` `OLI` `ETM+` `série histórica` `NASA` `USGS`

## Visão Geral

O programa Landsat é a série mais longa de aquisição contínua de imagens de satélite da Terra, operada pela NASA e USGS. É fundamental para análises temporais de mudança no uso do solo na engenharia florestal.

## Sensores Principais

### Landsat 5 (TM - Thematic Mapper)
- **Operação**: 1984–2013
- **Bandas**: 7 bandas espectrais
- **Resolução Espacial**: 30m (visível/IR), 120m (termal)
- **Relevância**: Base para análises de 1985–2011 (PRODES, MapBiomas)

### Landsat 7 (ETM+ - Enhanced Thematic Mapper Plus)
- **Operação**: 1999–Presente
- **Problema SLC-off**: Desde 2003, apresenta falhas (faixas sem dados) nas bordas das imagens.
- **Resolução**: 30m, com banda pancromática de 15m.

### Landsat 8 e 9 (OLI/TIRS)
- **Operação**: 2013–Presente (L8), 2021–Presente (L9)
- **Resolução Radiométrica**: 12 bits (4096 níveis de cinza), superior aos 8 bits do L5/L7
- **Bandas Adicionais**:
  - Banda 1 (Costeira/Aerossol)
  - Banda 9 (Cirrus) para detecção de nuvens

## Composição de Bandas (RGB)

| Aplicação | Landsat 5/7 | Landsat 8/9 |
|-----------|-------------|-------------|
| Cor Verdadeira | 3-2-1 | 4-3-2 |
| Falso Cor (Vegetação) | 4-3-2 | 5-4-3 |
| Agricultura/Solo | 5-4-3 | 6-5-2 |

## Aplicações na Engenharia Florestal
- Monitoramento de desmatamento (PRODES)
- Classificação de uso e cobertura do solo
- Análise de índices de vegetação (NDVI, EVI)
- Monitoramento de queimadas
