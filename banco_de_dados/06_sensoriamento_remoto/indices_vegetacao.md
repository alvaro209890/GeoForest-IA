# Índices de Vegetação e Análise Espectral

tags: `NDVI` `EVI` `SAVI` `NDRE` `infravermelho` `fitossanidade`

## O que são Índices de Vegetação?

São combinações matemáticas de diferentes bandas espectrais (geralmente Vermelho e Infravermelho Próximo - NIR) para realçar propriedades da vegetação e minimizar efeitos de solo e atmosfera.

## Principais Índices

### NDVI (Normalized Difference Vegetation Index)
- **Fórmula**: $(NIR - Red) / (NIR + Red)$
- **Interpretação**:
  - Valores próximos a 1: Vegetação densa e saudável (floresta).
  - 0.2 a 0.5: Vegetação esparsa ou degradada.
  - < 0: Água.
- **Uso**: Padrão ouro para monitoramento de vigor vegetativo, mas satura em florestas muito densas.

### EVI (Enhanced Vegetation Index)
- **Melhoria**: Adiciona a banda Azul para corrigir influências atmosféricas (aerossóis) e parâmetros de ajuste de solo.
- **Vantagem**: Não satura tão facilmente quanto o NDVI em biomassa alta (Amazônia).
- **Uso**: Preferível para estudos na Amazônia e áreas de floresta densa.

### SAVI (Soil Adjusted Vegetation Index)
- **Foco**: Corrigir a influência do brilho do solo.
- **Uso**: Ideal para áreas com vegetação aberta ou em estágios iniciais de regeneração (Cerrado ralo, áreas de PRAD recente), onde o solo é visível entre as plantas.

### NDRE (Normalized Difference Red Edge)
- **Fórmula**: Usa a banda **Red Edge** (borda do vermelho) em vez do Vermelho visível.
- **Uso**: Detecta estresse hídrico ou nutricional *antes* que seja visível a olho nu ou pelo NDVI (requer sensor com banda Red Edge, como Sentinel-2 ou Planet).

## Aplicações Práticas (Licenciamento e Perícia)
- **Datação de desmatamento**: Séries temporais de NDVI mostram a queda abrupta da vegetação.
- **Monitoramento de PRAD**: Curva ascendente de EVI/SAVI comprova a regeneração da área ao longo dos anos.
- **Validação de CAR**: Diferenciação entre floresta nativa, pastagem (ciclo sazonal forte) e agricultura.
