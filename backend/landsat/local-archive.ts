/**
 * Acervo Landsat local: leitura dos GeoTIFFs publicados e conversão para cena.
 */
import fs from "node:fs";
import path from "node:path";
import type { MultiPolygon, Polygon } from "geojson";
import { GEOSERVER_DATA_DIR, GEOSERVER_WORKSPACE, LANDSAT_ARCHIVE_ROOT } from "./constants";
import { decodeGeoserverFileUrl, parseBboxFromCoverageXml, publicWmsCapabilitiesUrl, wmsDownloadPathForLayer } from "./geoserver";
import { compositionLabel, isoFromDateCompact, parseLandsatLayerName } from "./naming";
import { LandsatLocalRecord, LandsatScene } from "./types";
import { bboxGeometry, computeSceneCoverage, safeName, xmlValue } from "./utils";

export function geoserverWorkspaceDir(): string {
  return path.join(GEOSERVER_DATA_DIR, "workspaces", GEOSERVER_WORKSPACE);
}

export function readLocalLandsatRecords(): LandsatLocalRecord[] {
  const root = geoserverWorkspaceDir();
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^landsat_/i.test(entry.name))
    .map((entry): LandsatLocalRecord | null => {
      try {
        const storeName = entry.name;
        const storeXmlPath = path.join(root, storeName, "coveragestore.xml");
        const coverageXmlPath = path.join(root, storeName, storeName, "coverage.xml");
        if (!fs.existsSync(storeXmlPath) || !fs.existsSync(coverageXmlPath)) return null;
        const storeXml = fs.readFileSync(storeXmlPath, "utf8");
        const coverageXml = fs.readFileSync(coverageXmlPath, "utf8");
        const sourcePath = decodeGeoserverFileUrl(xmlValue(storeXml, "url"));
        if (!sourcePath || !fs.existsSync(sourcePath)) return null;
        const parsed = parseLandsatLayerName(storeName);
        if (!parsed) return null;
        const title = xmlValue(coverageXml, "title") || path.basename(sourcePath, path.extname(sourcePath));
        const bbox = parseBboxFromCoverageXml(coverageXml);
        return {
          layerName: storeName,
          storeName,
          title,
          sourcePath,
          bytes: fs.statSync(sourcePath).size,
          ...parsed,
          bbox,
          geometry: bboxGeometry(bbox),
        } satisfies LandsatLocalRecord;
      } catch {
        return null;
      }
    })
    .filter((record): record is LandsatLocalRecord => Boolean(record));
}

export function localRecordToScene(record: LandsatLocalRecord, propertyGeometry?: Polygon | MultiPolygon): LandsatScene {
  const coverage = propertyGeometry && record.geometry
    ? computeSceneCoverage(propertyGeometry, record.geometry)
    : { coveragePercent: undefined, coversArea: undefined };
  return {
    id: record.layerName,
    source: "local_wms",
    platform: record.platform,
    path: record.path,
    row: record.row,
    orbit: record.orbit,
    year: record.year,
    date: record.date,
    datetime: isoFromDateCompact(record.date),
    cloudCover: null,
    composition: record.composition,
    compositionLabel: record.compositionLabel,
    bbox: record.bbox,
    geometry: record.geometry,
    coveragePercent: coverage.coveragePercent,
    coversArea: coverage.coversArea,
    downloadBytes: record.bytes,
    wmsAvailable: true,
    wmsLayerName: `${GEOSERVER_WORKSPACE}:${record.layerName}`,
    wmsStoreName: record.storeName,
    wmsUrl: publicWmsCapabilitiesUrl(),
    wmsDownloadUrl: wmsDownloadPathForLayer(record.layerName),
    sourcePath: record.sourcePath,
    outputFilename: path.basename(record.sourcePath),
  };
}

export function findLocalRecordByLayerName(layerName: string): LandsatLocalRecord | null {
  const clean = safeName(String(layerName || "").replace(/^cbers:/i, ""));
  if (!/^landsat_/i.test(clean)) return null;
  return readLocalLandsatRecords().find((record) => record.layerName === clean) || null;
}

export function findLocalRecordForExternal(scene: LandsatScene): LandsatLocalRecord | null {
  return readLocalLandsatRecords().find((record) => (
    record.path === scene.path &&
    record.row === scene.row &&
    record.date === scene.date &&
    record.composition === scene.composition
  )) || null;
}


export function landsatArchivePath(scene: LandsatScene, filename: string): string {
  return path.join(LANDSAT_ARCHIVE_ROOT, scene.orbit, scene.year, safeName(filename));
}

export function cleanLayerName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildStoreName(scene: LandsatScene, filename: string): string {
  return cleanLayerName(`landsat_${scene.orbit}_${scene.year}_${path.basename(filename, path.extname(filename))}`);
}
