<?xml version="1.0" encoding="UTF-8"?>
<!--
  Estilo NDFI do GeoServer (workspace cbers), aplicado a camada Float32 do NDFI
  de cena completa (backend/ndvi-scene/).

  NDFI = (rho_nir08 - rho_swir16) / (rho_nir08 + rho_swir16):
  area convertida / solo exposto (SWIR alto, NIR baixo) -> negativo -> BRANCO;
  vegetacao densa (NIR alto, SWIR baixo) -> positivo alto -> VERDE.

  As cores DEVEM bater com config/geoserver-styles/ndfi_ramp.clr, que alimenta o
  gdaldem color-relief usado na geracao do GeoTIFF RGB 8 bits.
-->
<StyledLayerDescriptor version="1.0.0"
    xmlns="http://www.opengis.net/sld"
    xmlns:ogc="http://www.opengis.net/ogc"
    xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
    xsi:schemaLocation="http://www.opengis.net/sld http://schemas.opengis.net/sld/1.0.0/StyledLayerDescriptor.xsd">
  <NamedLayer>
    <Name>ndfi_ramp</Name>
    <UserStyle>
      <Name>ndfi_ramp</Name>
      <Title>NDFI (-1 a 1)</Title>
      <Abstract>Rampa NDFI: branco (convertido/solo exposto) - amarelo - verde (vegetacao densa)</Abstract>
      <FeatureTypeStyle>
        <Rule>
          <RasterSymbolizer>
            <Opacity>1.0</Opacity>
            <ColorMap type="ramp">
              <ColorMapEntry color="#000000" quantity="-9999" opacity="0.0"/>
              <ColorMapEntry color="#FFFFFF" quantity="-1.00" opacity="1.0" label="-1,0 convertido / solo exposto (branco)"/>
              <ColorMapEntry color="#FFFFFF" quantity="-0.20" opacity="1.0"/>
              <ColorMapEntry color="#FFFAC8" quantity="0.00" opacity="1.0" label="0,0"/>
              <ColorMapEntry color="#FAE678" quantity="0.20" opacity="1.0"/>
              <ColorMapEntry color="#AAD25A" quantity="0.40" opacity="1.0" label="0,4 vegetacao"/>
              <ColorMapEntry color="#5AAA3C" quantity="0.60" opacity="1.0"/>
              <ColorMapEntry color="#287828" quantity="0.80" opacity="1.0" label="0,8 vegetacao densa"/>
              <ColorMapEntry color="#14501E" quantity="1.00" opacity="1.0" label="1,0"/>
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>
