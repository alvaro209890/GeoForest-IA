<?xml version="1.0" encoding="UTF-8"?>
<!--
  Estilo SAVI do GeoServer (workspace cbers), aplicado a camada Float32 do SAVI.

  As cores DEVEM bater com config/geoserver-styles/savi_ramp.clr, que alimenta o
  gdaldem color-relief usado no raster da composição. Se divergirem, o mapa e a
  camada do WMS mostram cores diferentes para o mesmo valor.
-->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>savi_ramp</Name>
    <UserStyle>
      <Name>savi_ramp</Name>
      <Title>SAVI (-1 a 1)</Title>
      <Abstract>Rampa SAVI: marrom (solo exposto/agua) - amarelo - verde (vegetacao arborea densa)</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>1.0</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#000000" quantity="-9999" opacity="0.0"/>
              <ColorMapEntry color="#78461E" quantity="-1.00" opacity="1.0" label="-1,0 agua / solo exposto"/>
              <ColorMapEntry color="#AA783C" quantity="-0.20" opacity="1.0"/>
              <ColorMapEntry color="#DCBE78" quantity="0.00" opacity="1.0" label="0,0"/>
              <ColorMapEntry color="#F0E1AA" quantity="0.10" opacity="1.0"/>
              <ColorMapEntry color="#FFFAC8" quantity="0.20" opacity="1.0" label="0,2 solo exposto / rala"/>
              <ColorMapEntry color="#E6F0A0" quantity="0.30" opacity="1.0"/>
              <ColorMapEntry color="#BEE182" quantity="0.40" opacity="1.0" label="0,4 vegetacao rala"/>
              <ColorMapEntry color="#8CCD69" quantity="0.50" opacity="1.0"/>
              <ColorMapEntry color="#55B455" quantity="0.60" opacity="1.0" label="0,6 vegetacao arborea"/>
              <ColorMapEntry color="#2D8C3C" quantity="0.70" opacity="1.0"/>
              <ColorMapEntry color="#0F6E2D" quantity="0.80" opacity="1.0" label="0,8 arborea densa"/>
              <ColorMapEntry color="#004B23" quantity="1.00" opacity="1.0" label="1,0"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
