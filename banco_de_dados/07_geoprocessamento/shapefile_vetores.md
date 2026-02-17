# Shapefiles e Dados Vetoriais

tags: `shapefile` `.shp` `.dbf` `pontos` `linhas` `polígonos` `topologia`

## Estrutura do Shapefile

O formato Shapefile (ESRI) é o padrão de fato para dados vetoriais em SIG. Na verdade, é um conjunto de arquivos que **DEVEM permanecer juntos**:

1. **.shp** (Obrigatório): Contém a geometria (coordenadas).
2. **.shx** (Obrigatório): Índice da geometria.
3. **.dbf** (Obrigatório): Tabela de atributos (dados alfanuméricos).
4. **.prj** (Essencial): Sistema de referência de coordenadas/projeção.
5. **.cpg** (Opcional): Codificação de caracteres (UTF-8, ISO-8859-1).

## Limitações Importantes

- **Tamanho Máximo**: 2 GB (para .shp e .dbf individualmente).
- **Nomes de Atributos**: Máximo de 10 caracteres no cabeçalho do DBF.
- **Tipos de Geometria**: Não mistura geometrias (ou é só ponto, ou só linha, ou só polígono).

## Regras de Topologia para CAR e Licenciamento

Para evitar erros no SIMCAR/SIGEF:

1. **Sobreposição (Overlap)**: Polígonos de mesma categoria não devem se sobrepor.
2. **Vazios (Gaps)**: Não deve haver buracos não intencionais entre polígonos adjacentes.
3. **Autointerseção**: Um polígono não pode "cruzar" a si mesmo (ex: laço).
4. **Multipartes**: Evitar polígonos multipartes se o sistema exigir polígonos simples.
5. **Vértices Duplicados**: Devem ser removidos (ferramenta Clean/Repair Geometry).

## Alternativas Modernas

- **GeoPackage (.gpkg)**: Arquivo único (SQLite), sem limite de 2GB, nomes longos de colunas.
- **GeoJSON**: Formato texto (JSON), ideal para web mapping.
- **KML/KMZ**: Padrão Google Earth, útil para visualização rápida mas ruim para análise precisa.
