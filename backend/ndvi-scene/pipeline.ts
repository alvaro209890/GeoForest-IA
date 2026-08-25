/**
 * Pipeline da cena completa (padrão da aba CBERS).
 *
 * 1. Busca o item STAC no Planetary Computer e assina os hrefs de TODAS as bandas
 *    (nir08, red, green, blue, swir16, qa_pixel).
 * 2. **Materializa a cena INTEIRA** (não recorta pelo imóvel): projeta o footprint
 *    do item para a UTM nativa da cena e usa `gdal_translate -projwin` sobre
 *    `/vsicurl/<href>?<token>` na resolução nativa (~30 m, ~7800×7800 px por banda),
 *    com COMPRESS=LZW + TILED + BIGTIFF=IF_SAFER. Cada banda vira um GeoTIFF local
 *    (nir.tif, red.tif, green.tif, blue.tif, swir16.tif, qa.tif).
 * 3. Para cada composição pedida, gera o GeoTIFF RGB 8 bits (via `compositions.ts`),
 *    gera overviews, arquiva em `NDVI_SCENE_ARCHIVE_ROOT/<ndvi_path>_<row>/<ano>/`
 *    e publica no GeoServer via `publishNdviGeoTiff` (store/layer com sufixo da
 *    composição e estilo correspondente).
 * 4. Monta e devolve o estado da cena (itemId, composições publicadas, wmsLayerNames,
 *    wmsUrl, archive records, bytes).
 */
import fs from "node:fs";
import path from "node:path";
import proj4 from "proj4";
import { runCommand } from "../cbers/gdal";
import { buildOverviews } from "../ndvi/compute";
import { buildNdviStoreName, dateCompactFromItemId, platformFromText, platformShort } from "../ndvi/naming";
import { toSceneRef, type NdviCandidate } from "../ndvi/scene-select";
import type { NdviProgressPatch } from "../ndvi/types";
import {
  ndviSceneArchiveSubdir,
  saveNdviSceneArchiveAsset,
  saveNdviSceneArchiveRecord,
  type NdviSceneArchiveRecord,
} from "./archive";
import { buildCompositionCommand, throwIfCancelled } from "./compositions";
import { NDVI_SCENE_COMPOSITIONS, type NdviSceneComposition } from "./constants";
import { publishCompositionLayer } from "./geoserver";
import { getStacItem, resolveAllAssetHrefs, type SceneBandHrefs } from "./scene-select";

/** Bandas materializadas por `gdal_translate -projwin` na resolução nativa da cena. */
export type MaterializedSceneBands = {
  nir08: string;
  red: string;
  green: string;
  blue: string;
  swir16: string;
  qa_pixel: string | null;
};

export type NdviSceneCompositionResult = {
  composition: NdviSceneComposition;
  archive: NdviSceneArchiveRecord;
};

export type ProcessNdviSceneResult = {
  itemId: string;
  sceneRef: ReturnType<typeof toSceneRef> | null;
  compositions: NdviSceneCompositionResult[];
  wmsLayerNames: string[];
  wmsUrl: string;
  bytes: number;
};

/** Id único do registro de acervo (storeName + composição). */
function archiveIdFor(storeName: string, comp: NdviSceneComposition): string {
  return `${storeName}_${comp}`;
}

/** Registra a definição proj4 da UTM da cena (EPSG 326xx/327xx) e devolve o nome. */
function registerUtmEpsg(epsg: number): string {
  const key = `EPSG:${epsg}`;
  if (proj4.defs(key)) return key;
  const north = epsg >= 32601 && epsg <= 32660 ? epsg - 32600 : 0;
  const south = epsg >= 32701 && epsg <= 32760 ? epsg - 32700 : 0;
  const zone = north || south;
  if (!zone) throw new Error(`EPSG ${epsg} não é uma UTM WGS84 conhecida.`);
  proj4.defs(key, `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`);
  return key;
}

/** EPSG UTM da cena: usa `proj:epsg` do item ou deriva da zona do centroide. */
function utmEpsgFor(item: any): number {
  const declarado = Number(item?.properties?.["proj:epsg"]);
  if (Number.isFinite(declarado) && declarado >= 32601 && declarado <= 32760) return declarado;
  const [minLon, , maxLon, ] = stacItemBbox(item);
  const lon = (minLon + maxLon) / 2;
  const lat = Number(item?.geometry?.coordinates?.[0]?.[0]?.[1]);
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return lat >= 0 ? 32600 + zone : 32700 + zone;
}

/** Bbox WGS84 (minLon, minLat, maxLon, maxLat) do item STAC (footprint ou bbox). */
function stacItemBbox(item: any): [number, number, number, number] {
  const bbox = item?.bbox;
  if (Array.isArray(bbox) && bbox.length >= 4) {
    const values = bbox.slice(0, 4).map(Number);
    if (values.every(Number.isFinite)) return [values[0], values[1], values[2], values[3]];
  }
  const geom = item?.geometry;
  if (geom?.type === "Polygon") {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const ring of geom.coordinates as number[][][]) {
      for (const [x, y] of ring) {
        if (Number.isFinite(x) && Number.isFinite(y)) {
          xs.push(x);
          ys.push(y);
        }
      }
    }
    if (xs.length) {
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }
  throw new Error("Item STAC sem bbox ou footprint utilizável.");
}

/** Anel externo do footprint (WGS84), para projeção UTM. */
function footprintRingCoords(item: any): Array<[number, number]> {
  const geom = item?.geometry;
  const ring = geom?.type === "Polygon"
    ? geom.coordinates[0]
    : geom?.type === "MultiPolygon"
      ? geom.coordinates[0]?.[0]
      : null;
  if (!Array.isArray(ring)) return [];
  const coords: Array<[number, number]> = [];
  for (const [x, y] of ring as number[][]) {
    if (Number.isFinite(x) && Number.isFinite(y)) coords.push([Number(x), Number(y)]);
  }
  return coords;
}

/**
 * Extensão da cena na UTM nativa, com margem de ~100 m (evita borda de 1 px e
 * cobre pequenas diferenças entre footprint e raster real).
 */
function sceneUtmExtent(item: any): { epsg: number; minX: number; minY: number; maxX: number; maxY: number } {
  const epsg = utmEpsgFor(item);
  const target = registerUtmEpsg(epsg);
  const coords = footprintRingCoords(item);
  if (coords.length < 3) {
    const [minLon, minLat, maxLon, maxLat] = stacItemBbox(item);
    coords.push([minLon, minLat], [maxLon, minLat], [maxLon, maxLat], [minLon, maxLat]);
  }
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [lon, lat] of coords) {
    try {
      const [x, y] = proj4("EPSG:4326", target, [lon, lat]) as [number, number];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        xs.push(x);
        ys.push(y);
      }
    } catch {
      /* vértice fora da área de projeção — ignora */
    }
  }
  if (xs.length < 3) throw new Error("Não foi possível projetar o footprint da cena para a UTM.");
  const margin = 100;
  return {
    epsg,
    minX: Math.min(...xs) - margin,
    minY: Math.min(...ys) - margin,
    maxX: Math.max(...xs) + margin,
    maxY: Math.max(...ys) + margin,
  };
}

/**
 * Materializa uma banda da cena inteira em GeoTIFF local.
 *
 * `gdal_translate -projwin` sobre `/vsicurl/<href>?<token>` (COG do Planetary
 * Computer lê só os tiles da janela), na resolução nativa de 30 m, com
 * COMPRESS=LZW + TILED + BIGTIFF=IF_SAFER. `qa_pixel` é bitmask — usa `-r near`
 * (nunca interpola bits).
 */
async function materializeBand(args: {
  uid: string;
  jobId: string;
  href: string;
  outPath: string;
  bandKey: string;
  utm: { epsg: number; minX: number; minY: number; maxX: number; maxY: number };
  basePercent: number;
  spanPercent: number;
  onProgress?: (patch: NdviProgressPatch) => void;
}): Promise<void> {
  const remoto = /^https?:\/\//i.test(args.href) ? `/vsicurl/${args.href}` : args.href;
  const isQa = args.bandKey === "qa_pixel";
  await runCommand({
    uid: args.uid,
    jobId: args.jobId,
    command: "gdal_translate",
    commandArgs: [
      "-projwin", String(args.utm.minX), String(args.utm.maxY), String(args.utm.maxX), String(args.utm.minY),
      "-projwin_srs", `EPSG:${args.utm.epsg}`,
      "-tr", "30", "30",
      "-r", isQa ? "near" : "cubic",
      "-of", "GTiff",
      "-co", "COMPRESS=LZW",
      "-co", "TILED=YES",
      "-co", "BIGTIFF=IF_SAFER",
      remoto,
      args.outPath,
    ],
    basePercent: args.basePercent,
    spanPercent: args.spanPercent,
    stage: "materialize",
    message: `Materializando banda ${args.bandKey.toUpperCase()} da cena completa.`,
    onProgress: args.onProgress,
  });
}

/** Nome de arquivo do acervo: `NDVI_<path>_<row>_<date>_<PLAT>_<COMP>[.TIF]` (+ sufixo J<JOB>). */
function buildNdviSceneFilename(args: {
  path: string;
  row: string;
  dateCompact: string;
  platform: string;
  comp: NdviSceneComposition;
  jobId: string;
}): string {
  const ext = ".TIF";
  const plat = String(args.platform).toUpperCase();
  const job = args.jobId
    ? `_J${String(args.jobId).replace(/[^a-zA-Z0-9]/g, "").slice(0, 8).toUpperCase()}`
    : "";
  const base = [
    "NDVI",
    args.path.padStart(3, "0"),
    args.row.padStart(3, "0"),
    args.dateCompact,
    plat,
    args.comp,
  ].join("_");
  return `${base}${job}${ext}`;
}

export async function processNdviScene(args: {
  uid: string;
  jobId: string;
  itemId: string;
  tmpDir: string;
  propertyGeometry?: unknown;
  areaHa: number;
  compositions: NdviSceneComposition[];
  onSceneProgress?: (patch: NdviProgressPatch) => void;
}): Promise<ProcessNdviSceneResult> {
  const { uid, jobId, itemId } = args;
  const report = (patch: NdviProgressPatch) => args.onSceneProgress?.(patch);
  const sceneDir = path.join(args.tmpDir, String(itemId).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 64));
  fs.mkdirSync(sceneDir, { recursive: true });

  try {
    throwIfCancelled(jobId);
    report({ stage: "scene", percent: 2, message: `Carregando cena ${itemId} do STAC.` });

    // --- 1. Item STAC + hrefs assinados ----------------------------------
    const { item } = await getStacItem(itemId);
    throwIfCancelled(jobId);
    const hrefs: SceneBandHrefs = await resolveAllAssetHrefs(item);
    const utm = sceneUtmExtent(item);
    report({ stage: "scene", percent: 4, message: "Bandas assinadas; extensão da cena determinada na UTM nativa." });

    const pr = (() => {
      const match = String(itemId).match(/_(\d{3})(\d{3})_(\d{8})/);
      if (match) return { path: match[1], row: match[2] };
      const alt = String(itemId).match(/(?<![0-9])(\d{3})[_-](\d{3})(?![0-9])/);
      if (alt) return { path: alt[1], row: alt[2] };
      return { path: "000", row: "000" };
    })();
    const dateCompact = dateCompactFromItemId(itemId) || "";
    const year = String(dateCompact).slice(0, 4) || String(new Date().getUTCFullYear());
    const platform = platformFromText(itemId || item?.properties?.platform);
    const acquiredAt = String(item?.properties?.datetime || "").slice(0, 10) || "";
    const cloudCoverPct = Number.isFinite(Number(item?.properties?.["eo:cloud_cover"]))
      ? Number(item.properties["eo:cloud_cover"])
      : null;

    const sceneRef = (() => {
      const candidate: NdviCandidate = {
        itemId,
        item,
        platform,
        acquiredAt,
        cloudCoverPct,
        path: pr.path,
        row: pr.row,
        slcOff: false,
        cobreImovel: true,
        score: 0,
      };
      return toSceneRef(candidate);
    })();

    // --- 2. Materializa a cena completa -----------------------------------
    report({
      stage: "materialize",
      percent: 5,
      message: "Materializando bandas da cena completa (30 m, ~7800×7800 px).",
    });
    const bandPaths: MaterializedSceneBands = {
      nir08: path.join(sceneDir, "nir.tif"),
      red: path.join(sceneDir, "red.tif"),
      green: path.join(sceneDir, "green.tif"),
      blue: path.join(sceneDir, "blue.tif"),
      swir16: path.join(sceneDir, "swir16.tif"),
      qa_pixel: path.join(sceneDir, "qa.tif"),
    };

    // Sequencial: o GDAL remoto satura a rede se materializarmos em paralelo;
    // a concorrência por lote é controlada no job (NDVI_SCENE_BATCH_CONCURRENCY).
    const plan = [
      { key: "nir08", start: 5, span: 8 },
      { key: "red", start: 13, span: 8 },
      { key: "green", start: 21, span: 8 },
      { key: "blue", start: 29, span: 8 },
      { key: "swir16", start: 37, span: 8 },
      { key: "qa_pixel", start: 45, span: 4 },
    ] as const;
    for (const step of plan) {
      const href = hrefs[step.key];
      const outPath = bandPaths[step.key];
      if (!href || !outPath) continue; // qa_pixel pode faltar (null)
      await materializeBand({
        uid,
        jobId,
        href,
        outPath,
        bandKey: step.key,
        utm,
        basePercent: step.start,
        spanPercent: step.span,
        onProgress: report,
      });
      throwIfCancelled(jobId);
    }
    report({ stage: "materialize", percent: 50, message: "Bandas da cena completa materializadas." });

    // --- 3. Composições ----------------------------------------------------
    const wmsLayerNames: string[] = [];
    const results: NdviSceneCompositionResult[] = [];
    let totalBytes = 0;
    const comps = args.compositions.length
      ? args.compositions
      : NDVI_SCENE_COMPOSITIONS.map((c) => c.id);
    const compSpan = comps.length ? 42 / comps.length : 0;

    for (let i = 0; i < comps.length; i += 1) {
      const comp = comps[i];
      throwIfCancelled(jobId);
      const compBase = 50 + i * compSpan;
      report({
        stage: comp.toLowerCase(),
        percent: compBase,
        message: `Gerando composição ${comp} (${i + 1}/${comps.length}).`,
      });

      const rgbPath = await buildCompositionCommand({
        comp,
        bandPaths: {
          nir08: bandPaths.nir08,
          red: bandPaths.red,
          green: bandPaths.green,
          blue: bandPaths.blue,
          swir16: bandPaths.swir16,
          qa_pixel: bandPaths.qa_pixel || undefined,
        },
        platform: platformFromText(itemId),
        outDir: sceneDir,
        uid,
        jobId,
        basePercent: compBase,
        spanPercent: compSpan * 0.8,
        onProgress: report,
      });
      throwIfCancelled(jobId);

      // Overviews do produto RGB (cena inteira: necessários para o zoom-out no WMS).
      await buildOverviews({
        uid,
        jobId,
        rasterPath: rgbPath,
        kind: "rgb",
        basePercent: compBase + compSpan * 0.8,
        spanPercent: compSpan * 0.1,
        onProgress: report,
      });

      // --- Acervo + publicação --------------------------------------------
      report({
        stage: comp.toLowerCase(),
        percent: compBase + compSpan * 0.92,
        message: `Arquivando composição ${comp}.`,
      });
      const filename = buildNdviSceneFilename({
        path: pr.path,
        row: pr.row,
        dateCompact,
        platform: platformShort(platform),
        comp,
        jobId,
      });
      const subdir = ndviSceneArchiveSubdir(pr.path, pr.row, year);
      const salvo = saveNdviSceneArchiveAsset({ subdir, filename, sourcePath: rgbPath });

      const storeName = buildNdviStoreName({
        path: pr.path,
        row: pr.row,
        year,
        filename,
      });

      report({
        stage: comp.toLowerCase(),
        percent: compBase + compSpan * 0.96,
        message: `Publicando ${comp} no WMS.`,
      });
      const compState = await publishCompositionLayer({
        uid,
        jobId,
        comp,
        storeName,
        title: `${sceneRef.platformLabel} ${pr.path}/${pr.row} ${dateCompact} — ${comp}`,
        hdPath: salvo.absolutePath,
        path: pr.path,
        row: pr.row,
        year,
        archiveFilename: filename,
        bytes: salvo.bytes,
      });

      const archiveRecord: NdviSceneArchiveRecord = {
        archiveId: archiveIdFor(storeName, comp),
        uid,
        ndviSceneJobId: jobId,
        itemId,
        composition: comp,
        platform: sceneRef.platform,
        path: pr.path,
        row: pr.row,
        year,
        acquiredAt,
        cloudCoverPct,
        filename: filename,
        hdPath: salvo.absolutePath,
        bytes: salvo.bytes,
        wmsLayerName: compState.wmsLayerName || "",
        wmsStoreName: compState.wmsStoreName || storeName,
        wmsPublicUrl: compState.wmsUrl || "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      saveNdviSceneArchiveRecord(archiveRecord);

      wmsLayerNames.push(compState.wmsLayerName || "");
      totalBytes += salvo.bytes;
      results.push({ composition: comp, archive: archiveRecord });
    }

    return {
      itemId,
      sceneRef,
      compositions: results,
      wmsLayerNames,
      wmsUrl: results[0]?.archive.wmsPublicUrl || "",
      bytes: totalBytes,
    };
  } finally {
    try {
      fs.rmSync(sceneDir, { recursive: true, force: true });
    } catch {
      /* temporário some na próxima limpeza */
    }
  }
}
