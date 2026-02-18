# Termos de Referência: Geoprocessamento e Padrões de Mapas

tags: `mapas` `geoprocessamento` `layout` `SEMA-MT` `hidrografia` `shapefile`

## Padrões Gerais de Geoprocessamento (SEMA-MT)

A SEMA-MT exige rigor técnico na apresentação de dados geoespaciais para evitar sobreposições e erros de análise.

### Sistemas de Referência e Formatos
- **Datum Oficial**: SIRGAS 2000 (EPSG: 4674 para geográficas).
- **Formatos Aceitos**: Shapefile (.shp, .shx, .dbf, .prj).
- **Precisão de Coordenadas**: Mínimo de 3 (três) casas decimais nas frações de segundos.

## TR 002/CCRA/SRMA - Laudo de Hidrografia
Utilizado quando há indícios de hidrografias não vetorizadas na análise do CAR/SIMCAR.

### Requisitos Técnicos
- **Época de Coleta**: Obrigatoriamente no período das águas (dezembro a maio).
- **Dúvida de Regime**: Se houver dúvida entre intermitente e perene, realizar amostragem em duas épocas (águas e estiagem).
- **Relatório Fotográfico**:
    - Imagens de alta resolução (Drone/Ortomosaico) e nível de solo.
    - Coordenadas geográficas em todas as fotos.
    - No ponto inicial (nascente), registrar 4 imagens (N, S, L, O).
- **Análise Temporal**: Dinâmica de imagens de satélite dos últimos 5 anos, cobrindo períodos secos e chuvosos.

## Layout e Elementos Obrigatórios nos Mapas
Todo mapa submetido à SEMA deve conter:
1. **Grade de Coordenadas**: Geográficas ou UTM (conforme o fuso).
2. **Legenda Completa**: Identificação de talhões, APPs, RL, áreas abertas e remanescentes.
3. **Selo/Carimbo**: Com nome do imóvel, proprietário, responsável técnico, escala, data e sistema de coordenadas.
4. **Croqui de Acesso**: Partindo da sede do município, com pontos de referência e coordenadas de interseções.

## Causas de Indeferimento Cartográfico
- **Datum Incorreto**: Uso de SAD 69 ou Córrego Alegre em projetos novos (conversão obrigatória para SIRGAS 2000).
- **Erros Topológicos**: Sobreposições de polígonos ou lacunas (gaps) entre áreas adjacentes.
- **Inconsistência**: Área declarada no memorial descritivo diferente da área calculada no shapefile.
- **Vértices Duplicados**: Falta de limpeza topológica nos arquivos vetoriais.
