# Precisão Cartográfica e Escala

tags: `PEC` `escala` `acurácia` `erro` `topografia`

## Conceitos Fundamentais

### Escala
Relação entre a medida no mapa e a medida real no terreno.
- **Escala Grande (Detalhe)**: 1:1.000, 1:5.000 (Plantas urbanas, projetos de engenharia).
- **Escala Média**: 1:25.000, 1:50.000 (Planejamento regional, CAR).
- **Escala Pequena (Generalização)**: 1:250.000, 1:1.000.000 (Mapas estaduais, continentais).

**Regra Prática**: Um erro de 0,5mm no mapa equivale a:
- 0,5m na escala 1:1.000
- 12,5m na escala 1:25.000
- 50m na escala 1:100.000

### PEC (Padrão de Exatidão Cartográfica)

Definido pelo Decreto 89.817/1984, classifica a qualidade dos produtos cartográficos em classes A, B e C.

**Para Cartas Topográficas (Classe A):**
- 90% dos pontos devem ter erro inferior a 0,5mm na escala do mapa.

| Escala | Erro Máximo Aceitável (PEC A) | Aplicação Comum |
|--------|-------------------------------|-----------------|
| 1:5.000 | 2,5 m | Georreferenciamento Urbano |
| 1:10.000 | 5 m | Projetos de Irrigação/Drenagem |
| **1:25.000** | **12,5 m** | **CAR / Licenciamento Ambiental** |
| 1:50.000 | 25 m | Zoneamento Ecológico |
| 1:100.000 | 50 m | Bases Estaduais Gerais |

## Implicações no Licenciamento (SEMA-MT)
- **Garantia de Não Sobreposição**: Se o vizinho usou uma base ruim (ex: imagem Google Earth antiga com deslocamento), e você usar uma base de alta precisão (GNSS RTK), haverá sobreposição "falsa".
- **Ajuste de Imagens**: Nunca ajuste o levantamento topográfico preciso (GPS) para "caber" na imagem de satélite. A imagem deve ser ortorretificada usando o levantamento como controle.
- **Erro GNSS Navegação (Garmin)**: Erro de 5 a 15 metros. Aceitável para vistorias preliminares, proibido para georreferenciamento de vértices de imóvel (Lei 10.267 exige precisão < 50cm).
