<?xml version="1.0" encoding="UTF-8"?>
<!--
  Estilo NDVI do GeoServer (workspace cbers), aplicado a camada Float32 do NDVI.

  As cores DEVEM bater com config/geoserver-styles/ndvi_ramp.clr, que alimenta o
  gdaldem color-relief usado nas figuras do laudo. Se divergirem, o mapa do Word e a
  camada do WMS mostram cores diferentes para o mesmo valor.
  Travado por backend/ndvi/ndvi-style.test.ts.
-->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>ndvi_ramp</Name>
    <UserStyle>
      <Name>ndvi_ramp</Name>
      <Title>NDVI (-1 a 1)</Title>
      <Abstract>Rampa NDVI: marrom (solo exposto) - amarelo - verde (vegetacao arborea densa)</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>1.0</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#000000" quantity="-9999" opacity="0.0"/>
              <ColorMapEntry color="#8C510A" quantity="-1.00" opacity="1.0" label="-1,0 solo exposto / agua"/>
              <ColorMapEntry color="#BF812D" quantity="-0.20" opacity="1.0"/>
              <ColorMapEntry color="#DFC27D" quantity="0.00" opacity="1.0" label="0,0"/>
              <ColorMapEntry color="#F6E8C3" quantity="0.10" opacity="1.0"/>
              <ColorMapEntry color="#FFFFBF" quantity="0.20" opacity="1.0" label="0,2 solo exposto"/>
              <ColorMapEntry color="#D9F0A3" quantity="0.30" opacity="1.0"/>
              <ColorMapEntry color="#ADDD8E" quantity="0.40" opacity="1.0" label="0,4 vegetacao rala"/>
              <ColorMapEntry color="#78C679" quantity="0.50" opacity="1.0"/>
              <ColorMapEntry color="#41AB5D" quantity="0.60" opacity="1.0" label="0,6 vegetacao arborea"/>
              <ColorMapEntry color="#238443" quantity="0.70" opacity="1.0"/>
              <ColorMapEntry color="#006837" quantity="0.80" opacity="1.0" label="0,8 arborea densa"/>
              <ColorMapEntry color="#004529" quantity="1.00" opacity="1.0" label="1,0"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
