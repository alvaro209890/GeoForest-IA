# Sistemas de Coordenadas e Projeções

tags: `SIRGAS 2000` `SAD 69` `WGS 84` `UTM` `Geográficas` `EPSG`

## Sistemas de Referência (Datum)

O Datum define a forma e posição do elipsoide terrestre.

- **SIRGAS 2000 (Obrigatório)**:
  - Sistema de Referência Geocêntrico para as Américas.
  - Padrão oficial do Brasil desde 2015 (IBGE/Decreto 5.334/2005).
  - Praticamente idêntico ao WGS 84 (GPS) para fins práticos (< 1cm).

- **SAD 69 (Antigo)**:
  - Sul Americano 1969.
  - Ainda encontrado em bases antigas.
  - **ATENÇÃO**: Deslocamento de ~65m em relação ao SIRGAS 2000. **Conversão obrigatória** para projetos atuais.

- **Córrego Alegre**: Muito antigo, histórico.

## Coordenadas Geográficas vs Projetadas (UTM)

### Geográficas (Lat/Long)
- Unidade: Graus Decimais (ex: -12.4554, -55.1234) ou Graus, Minutos, Segundos.
- Baseada em coordenadas esféricas.
- Não serve para calcular área com precisão plana (requer projeção).

### Projetadas (UTM - Universal Transversa de Mercator)
- Unidade: Metros (Norte, Leste).
- Divide a Terra em 60 fusos.
- **Mato Grosso**: Abrange os fusos 20S, 21S e 22S.
- Ideal para cálculo de área e distâncias em escala local/regional.

## Códigos EPSG Comuns em MT

| Código EPSG | Datum | Tipo | Uso |
|-------------|-------|------|-----|
| **4674** | SIRGAS 2000 | Geográfico 2D | Padrão CAR/SIMCAR (Shapefile) |
| **31981** | SIRGAS 2000 | UTM Fuso 21S | Projetos na faixa central de MT |
| **31980** | SIRGAS 2000 | UTM Fuso 20S | Oeste de MT |
| **31982** | SIRGAS 2000 | UTM Fuso 22S | Leste de MT |
| **4326** | WGS 84 | Geográfico 2D | Padrão GPS/Google |

**Dica**: Sempre verifique o arquivo `.prj` para garantir que o código EPSG está correto antes de enviar ao órgão ambiental.
