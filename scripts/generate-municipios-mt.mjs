#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL =
  "https://geoftp.ibge.gov.br/organizacao_do_territorio/malhas_territoriais/" +
  "malhas_municipais/municipio_2024/UFs/MT/MT_Municipios_2024.zip";
const SIMPLIFY_DEGREES = "0.001";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = path.join(projectRoot, "config", "municipios-mt.geojson");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-ibge-mt-"));

try {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`IBGE respondeu HTTP ${response.status} ao baixar a malha municipal.`);
  }

  const zipPath = path.join(tempDir, "MT_Municipios_2024.zip");
  fs.writeFileSync(zipPath, Buffer.from(await response.arrayBuffer()));
  const sourceDir = path.join(tempDir, "source");
  fs.mkdirSync(sourceDir);
  execFileSync("unzip", ["-q", zipPath, "-d", sourceDir], { stdio: "inherit" });

  const shpName = fs.readdirSync(sourceDir).find((name) => /\.shp$/i.test(name));
  if (!shpName) throw new Error("O ZIP do IBGE não contém arquivo .shp.");

  const rawGeoJsonPath = path.join(tempDir, "municipios.geojson");
  execFileSync(
    "ogr2ogr",
    [
      "-f",
      "GeoJSON",
      rawGeoJsonPath,
      path.join(sourceDir, shpName),
      "-t_srs",
      "EPSG:4326",
      "-simplify",
      SIMPLIFY_DEGREES,
      "-select",
      "CD_MUN,NM_MUN",
      "-lco",
      "COORDINATE_PRECISION=5",
    ],
    { stdio: "inherit" },
  );

  const raw = JSON.parse(fs.readFileSync(rawGeoJsonPath, "utf8"));
  const features = raw.features
    .map((feature) => ({
      type: "Feature",
      properties: {
        ibge: String(feature?.properties?.CD_MUN || "").trim(),
        nome: String(feature?.properties?.NM_MUN || "").trim(),
      },
      geometry: feature.geometry,
    }))
    .filter((feature) => /^51\d{5}$/.test(feature.properties.ibge) && feature.properties.nome)
    .sort((a, b) => a.properties.ibge.localeCompare(b.properties.ibge));

  if (features.length !== 142) {
    throw new Error(`Malha municipal inesperada: ${features.length} feições (esperado: 142).`);
  }

  const output = {
    type: "FeatureCollection",
    source: SOURCE_URL,
    edition: "IBGE Malha Municipal 2024",
    crs: "EPSG:4326 (reprojeção de SIRGAS 2000/EPSG:4674)",
    simplifyToleranceDegrees: Number(SIMPLIFY_DEGREES),
    featureCount: features.length,
    features,
  };
  fs.writeFileSync(outputPath, `${JSON.stringify(output)}\n`, "utf8");
  console.log(`Gerado ${path.relative(projectRoot, outputPath)} (${features.length} municípios).`);
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
