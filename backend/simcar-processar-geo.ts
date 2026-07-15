/**
 * ProcessarGeo local — deriva as feições oficiais do Projeto Geográfico SIMCAR
 * a partir das camadas enviadas (como o servidor SEMA faz no ProcessarGeo):
 *
 *   APP   = união dos buffers de APP (rios por faixa, nascente 50 m, lagoa,
 *           reservatório, vereda 50 m) ∩ limite do imóvel (AIR ou ATP)
 *   APPP  = APP ∩ AVN  (APP preservada — aproximação)
 *   APPD  = APP − APPP (APP degradada / passivo — aproximação)
 *   APPRL = APP ∩ ARL
 *   AURD  = (AREA_DECLIVIDADE ∪ AREA_PANTANEIRA) ∩ AUAS  (uso restrito degradado)
 *
 * Faixas de APP: Código Florestal Lei 12.651/2012 Art. 4º (mesmas do Manual SIMCAR).
 * Operações em metros via turf.buffer({ units: "meters" }) — turf reprojeta
 * internamente a partir de WGS84/lon-lat; se CRS for projetado, coordenadas
 * já estão em metros e o buffer em "meters" continua correto.
 */
import {
  buffer as turfBuffer,
  difference as turfDifference,
  featureCollection as turfFeatureCollection,
  intersect as turfIntersect,
  point as turfPoint,
  union as turfUnion,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import proj4 from "proj4";
import type { GeometryErrorRow } from "./geometry-errors";
import { recordToGeoJSON } from "./geometry-errors";
import { recognizeSimcarLayer, type SimcarLayerCode } from "./simcar-rules";
import { geojsonToShpRecords, type ShpRecord } from "./shapefile-writer";
import type { CodedCrs, ParsedPolygonRecord } from "./vertices-proximas";

/** Distâncias oficiais de APP (m) por feição de origem. */
export const APP_BUFFER_M_BY_CODE: Partial<Record<SimcarLayerCode, number>> = {
  RIO_MENOR_10: 30,
  RIO_10_ATE_50: 50,
  RIO_50_ATE_200: 100,
  RIO_200_ATE_600: 200,
  RIO_MAIOR_600: 500,
  NASCENTE: 50,
  LAGO_LAGOA_NATURAL: 50,
  RESERVATORIO_ARTIFICIAL: 30,
  VEREDA: 50,
};

/** Também reconhece nomes do modelo clip (RIO_ATE_10 etc.) via aliases em simcar-rules. */
export function appBufferMetersForLayer(layerName: string): number | null {
  const code = recognizeSimcarLayer(layerName);
  if (!code) {
    const n = String(layerName || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
    if (/RIO.*ATE_10|RIO.*MENOR_10|RIO_LT_10/.test(n)) return 30;
    if (/RIO.*10.*50/.test(n)) return 50;
    if (/RIO.*50.*200/.test(n)) return 100;
    if (/RIO.*200.*600/.test(n)) return 200;
    if (/RIO.*ACIMA_600|RIO.*MAIOR_600|RIO_GT_600/.test(n)) return 500;
    if (/NASCENTE|OLHO/.test(n)) return 50;
    if (/VEREDA/.test(n)) return 50;
    if (/LAGO|LAGOA/.test(n)) return 50;
    if (/RESERVATORIO|REPRESA/.test(n)) return 30;
    return null;
  }
  return APP_BUFFER_M_BY_CODE[code] ?? null;
}

export type ProcessarGeoInputLayer = {
  name: string;
  records: ParsedPolygonRecord[];
  crs: CodedCrs;
  /** Pontos de NASCENTE (se o .shp for point). */
  points?: Array<{ feature: number; x: number; y: number }>;
};

export type DerivedLayerOut = {
  code: string;
  name: string;
  records: ShpRecord[];
  areaM2: number;
  areaHa: number;
  featureCount: number;
};

export type QuadroAppRow = {
  feicao: string;
  area_ha: number;
  area_m2: number;
  origem: string;
};

export type ProcessarGeoResult = {
  derived: DerivedLayerOut[];
  warnings: string[];
  errorRows: GeometryErrorRow[];
  quadroApp: QuadroAppRow[];
};

function ringPlanarArea(ring: number[][]): number {
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return area / 2;
}

function geometryAreaAbs(geometry: Polygon | MultiPolygon, crs?: CodedCrs): number {
  const polys = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  const project =
    crs && (crs.kind === "geographic" || !crs.projDef)
      ? (pt: number[]) => {
          // UTM aproximado local a partir do centro do anel
          return pt;
        }
      : null;

  // Em CRS geográfico, converte anéis para UTM local (metros) antes da área.
  if (crs && (crs.kind === "geographic" || !crs.projDef)) {
    let lon0 = 0;
    let lat0 = 0;
    let n = 0;
    for (const poly of polys) {
      for (const ring of poly) {
        for (const [x, y] of ring) {
          lon0 += x;
          lat0 += y;
          n += 1;
        }
      }
    }
    if (n > 0) {
      lon0 /= n;
      lat0 /= n;
    }
    const zone = Math.floor((lon0 + 180) / 6) + 1;
    const south = lat0 < 0;
    const utm = `+proj=utm +zone=${zone} ${south ? "+south " : ""}+datum=WGS84 +units=m +no_defs`;
    const toUtm = (pt: number[]): number[] => {
      try {
        return proj4("EPSG:4326", utm, [pt[0], pt[1]]) as number[];
      } catch {
        // fallback grosso: graus → metros
        const mPerDegLat = 111320;
        const mPerDegLon = 111320 * Math.cos((lat0 * Math.PI) / 180);
        return [(pt[0] - lon0) * mPerDegLon, (pt[1] - lat0) * mPerDegLat];
      }
    };
    let total = 0;
    for (const poly of polys) {
      poly.forEach((ring, idx) => {
        const projected = ring.map(toUtm);
        const a = Math.abs(ringPlanarArea(projected));
        total += idx === 0 ? a : -a;
      });
    }
    return Math.max(0, total);
  }

  void project;
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, idx) => {
      const a = Math.abs(ringPlanarArea(ring));
      total += idx === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

function asFeature(geometry: Polygon | MultiPolygon): Feature<Polygon | MultiPolygon> {
  return { type: "Feature", properties: {}, geometry };
}

/**
 * turf.buffer com units:"meters" assume lon/lat WGS84.
 * Se a camada estiver em CRS projetado, converte para WGS84, buffer, e devolve
 * no CRS de trabalho (UTM estimado a partir do centro, se necessário).
 */
function bufferMeters(
  geometry: Polygon | MultiPolygon,
  meters: number,
  crs: CodedCrs,
): Polygon | MultiPolygon | null {
  const isGeographic = crs.kind === "geographic" || !crs.projDef;
  try {
    if (isGeographic) {
      const buffered = turfBuffer(asFeature(geometry) as any, meters, { units: "meters" });
      const g = buffered?.geometry as Polygon | MultiPolygon | undefined;
      return g && (g.type === "Polygon" || g.type === "MultiPolygon") ? g : null;
    }
    const src = crs.projDef || "EPSG:31981";
    const toWgs = (pt: number[]): [number, number] => {
      const out = proj4(src, "EPSG:4326", [pt[0], pt[1]]) as [number, number];
      return [out[0], out[1]];
    };
    const fromWgs = (pt: number[]): [number, number] => {
      const out = proj4("EPSG:4326", src, [pt[0], pt[1]]) as [number, number];
      return [out[0], out[1]];
    };
    const mapCoords = (coords: any, fn: (p: number[]) => [number, number]): any => {
      if (typeof coords[0] === "number") return fn(coords as number[]);
      return (coords as any[]).map((c) => mapCoords(c, fn));
    };
    const wgsGeom = {
      type: geometry.type,
      coordinates: mapCoords(geometry.coordinates, toWgs),
    } as Polygon | MultiPolygon;
    const buffered = turfBuffer(asFeature(wgsGeom) as any, meters, { units: "meters" });
    const g = buffered?.geometry as Polygon | MultiPolygon | undefined;
    if (!g || (g.type !== "Polygon" && g.type !== "MultiPolygon")) return null;
    return {
      type: g.type,
      coordinates: mapCoords(g.coordinates, fromWgs),
    } as Polygon | MultiPolygon;
  } catch {
    return null;
  }
}

function unionMany(geoms: Array<Polygon | MultiPolygon>): Feature<Polygon | MultiPolygon> | null {
  let acc: Feature<Polygon | MultiPolygon> | null = null;
  for (const g of geoms) {
    const f = asFeature(g);
    if (!acc) {
      acc = f;
      continue;
    }
    try {
      const merged = turfUnion(turfFeatureCollection([acc, f]) as any) as Feature<Polygon | MultiPolygon> | null;
      if (merged?.geometry) acc = merged;
    } catch {
      // keep partial
    }
  }
  return acc;
}

function intersectSafe(
  a: Feature<Polygon | MultiPolygon>,
  b: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null {
  try {
    return turfIntersect(turfFeatureCollection([a, b]) as any) as Feature<Polygon | MultiPolygon> | null;
  } catch {
    return null;
  }
}

function differenceSafe(
  a: Feature<Polygon | MultiPolygon>,
  b: Feature<Polygon | MultiPolygon>,
): Feature<Polygon | MultiPolygon> | null {
  try {
    return turfDifference(turfFeatureCollection([a, b]) as any) as Feature<Polygon | MultiPolygon> | null;
  } catch {
    return null;
  }
}

function geometryToShpRecords(
  geometry: Polygon | MultiPolygon | null | undefined,
  code: string,
  attrs: Record<string, string | number | null> = {},
): ShpRecord[] {
  if (!geometry) return [];
  return geojsonToShpRecords(geometry, {
    camada: code,
    feicao: 1,
    origem: "PROCESSAR_GEO",
    ...attrs,
  });
}

function derivedFromGeometry(
  code: string,
  geometry: Polygon | MultiPolygon | null | undefined,
  origem: string,
  crs?: CodedCrs,
): DerivedLayerOut | null {
  if (!geometry) return null;
  const areaM2 = geometryAreaAbs(geometry, crs);
  if (areaM2 < 0.01) return null; // < 1 cm²
  const records = geometryToShpRecords(geometry, code, { tipo: code });
  if (!records.length) return null;
  return {
    code,
    name: code,
    records,
    areaM2,
    areaHa: areaM2 / 10000,
    featureCount: records.length,
  };
}

function collectCodeGeometries(
  layers: ProcessarGeoInputLayer[],
  code: SimcarLayerCode,
): Array<Polygon | MultiPolygon> {
  const out: Array<Polygon | MultiPolygon> = [];
  for (const layer of layers) {
    if (recognizeSimcarLayer(layer.name) !== code) continue;
    for (const rec of layer.records) {
      const g = recordToGeoJSON(rec);
      if (g) out.push(g);
    }
  }
  return out;
}

/**
 * Lê pontos de um .shp Point / PointZ / PointM.
 */
export function parsePointRecords(shpBuffer: Buffer): Array<{ feature: number; x: number; y: number }> {
  const out: Array<{ feature: number; x: number; y: number }> = [];
  if (!shpBuffer || shpBuffer.length < 100) return out;
  let offset = 100;
  let feature = 0;
  while (offset + 12 <= shpBuffer.length) {
    feature += 1;
    const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
    const contentLengthBytes = contentLengthWords * 2;
    const recStart = offset + 8;
    const recEnd = recStart + contentLengthBytes;
    if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;
    const shapeType = shpBuffer.readInt32LE(recStart);
    if ([1, 11, 21].includes(shapeType) && contentLengthBytes >= 20) {
      const x = shpBuffer.readDoubleLE(recStart + 4);
      const y = shpBuffer.readDoubleLE(recStart + 12);
      if (Number.isFinite(x) && Number.isFinite(y)) out.push({ feature, x, y });
    }
    offset = recEnd;
  }
  return out;
}

/**
 * Gera as camadas derivadas do ProcessarGeo (APP, APPP, APPD, APPRL, AURD).
 */
export function generateSimcarDerivedLayers(layers: ProcessarGeoInputLayer[]): ProcessarGeoResult {
  const warnings: string[] = [];
  const errorRows: GeometryErrorRow[] = [];
  const appPieces: Array<Polygon | MultiPolygon> = [];
  let appSources = 0;

  for (const layer of layers) {
    const dist = appBufferMetersForLayer(layer.name);
    if (dist == null) continue;

    // Polígonos (rios, lagoas, veredas…)
    for (const rec of layer.records) {
      const geom = recordToGeoJSON(rec);
      if (!geom) continue;
      const bg = bufferMeters(geom, dist, layer.crs);
      if (bg) {
        appPieces.push(bg);
        appSources += 1;
      } else {
        const x = geom.type === "Polygon" ? geom.coordinates[0][0][0] : geom.coordinates[0][0][0][0];
        const y = geom.type === "Polygon" ? geom.coordinates[0][0][1] : geom.coordinates[0][0][0][1];
        errorRows.push({
          camada: layer.name,
          tipo: "erro_calculo_app",
          feicao: rec.feature,
          parte: 0,
          anel: 0,
          x,
          y,
          detalhe: `Buffer de APP (${dist} m) não gerou polígono válido para a feição ${rec.feature}.`,
        });
      }
    }

    // Pontos (nascente)
    const points = layer.points || [];
    for (const pt of points) {
      // mini polígono → buffer
      const tiny: Polygon = {
        type: "Polygon",
        coordinates: [
          [
            [pt.x, pt.y],
            [pt.x + 1e-9, pt.y],
            [pt.x + 1e-9, pt.y + 1e-9],
            [pt.x, pt.y + 1e-9],
            [pt.x, pt.y],
          ],
        ],
      };
      // buffer direto do ponto via turf em lon/lat
      let bg: Polygon | MultiPolygon | null = null;
      try {
        if (layer.crs.kind === "geographic" || !layer.crs.projDef) {
          const buffered = turfBuffer(turfPoint([pt.x, pt.y]) as any, dist, { units: "meters" });
          bg = (buffered?.geometry as Polygon | MultiPolygon) || null;
        } else {
          const wgs = proj4(layer.crs.projDef, "EPSG:4326", [pt.x, pt.y]) as [number, number];
          const buffered = turfBuffer(turfPoint(wgs) as any, dist, { units: "meters" });
          const g = buffered?.geometry as Polygon | MultiPolygon | undefined;
          if (g) {
            const mapCoords = (coords: any): any => {
              if (typeof coords[0] === "number") {
                return proj4("EPSG:4326", layer.crs.projDef!, coords as number[]);
              }
              return (coords as any[]).map(mapCoords);
            };
            bg = { type: g.type, coordinates: mapCoords(g.coordinates) } as Polygon | MultiPolygon;
          }
        }
      } catch {
        bg = bufferMeters(tiny, dist, layer.crs);
      }
      if (bg && (bg.type === "Polygon" || bg.type === "MultiPolygon")) {
        appPieces.push(bg);
        appSources += 1;
      } else {
        errorRows.push({
          camada: layer.name,
          tipo: "erro_calculo_app",
          feicao: pt.feature,
          parte: 0,
          anel: 0,
          x: pt.x,
          y: pt.y,
          detalhe: `Buffer de nascente (${dist} m) não gerou polígono.`,
        });
      }
    }
  }

  if (!appPieces.length) {
    warnings.push(
      "ProcessarGeo: nenhuma feição hidrográfica/APP de origem encontrada (rios, nascente, lagoa, vereda, reservatório). Camadas APP/APPD/APPP/APPRL não geradas.",
    );
  }

  let appUnion = unionMany(appPieces);

  // Clip ao imóvel (AIR preferencial, senão ATP)
  const airGeoms = collectCodeGeometries(layers, "AIR");
  const atpGeoms = collectCodeGeometries(layers, "ATP");
  const limitUnion = unionMany(airGeoms.length ? airGeoms : atpGeoms);
  if (appUnion && limitUnion) {
    const clipped = intersectSafe(appUnion, limitUnion);
    if (clipped?.geometry) appUnion = clipped;
    else warnings.push("ProcessarGeo: APP após clip no imóvel resultou vazia; mantendo APP sem clip.");
  } else if (appUnion && !limitUnion) {
    warnings.push("ProcessarGeo: AIR/ATP ausentes — APP gerada sem recorte ao imóvel.");
  }

  const derived: DerivedLayerOut[] = [];
  const quadroApp: QuadroAppRow[] = [];
  const workCrs = layers[0]?.crs;

  const appLayer = derivedFromGeometry(
    "APP",
    appUnion?.geometry as Polygon | MultiPolygon | undefined,
    "buffer hidrografia",
    workCrs,
  );
  if (appLayer) {
    derived.push(appLayer);
    quadroApp.push({
      feicao: "APP",
      area_ha: appLayer.areaHa,
      area_m2: appLayer.areaM2,
      origem: `${appSources} buffer(s) hidrografia/APP`,
    });
  }

  // APPP = APP ∩ AVN
  const avnUnion = unionMany(collectCodeGeometries(layers, "AVN"));
  let apppGeom: Polygon | MultiPolygon | null = null;
  if (appUnion && avnUnion) {
    const hit = intersectSafe(appUnion, avnUnion);
    apppGeom = (hit?.geometry as Polygon | MultiPolygon) || null;
  } else if (appUnion && !avnUnion) {
    warnings.push("ProcessarGeo: AVN ausente — APPP/APPD usam APP total como degradada se sem AVN.");
  }
  const apppLayer = derivedFromGeometry("APPP", apppGeom, "APP ∩ AVN", workCrs);
  if (apppLayer) {
    derived.push(apppLayer);
    quadroApp.push({
      feicao: "APPP",
      area_ha: apppLayer.areaHa,
      area_m2: apppLayer.areaM2,
      origem: "APP ∩ AVN (preservada)",
    });
  }

  // APPD = APP − APPP (ou APP inteira se sem AVN)
  let appdGeom: Polygon | MultiPolygon | null = null;
  if (appUnion) {
    if (apppGeom) {
      const diff = differenceSafe(appUnion, asFeature(apppGeom));
      appdGeom = (diff?.geometry as Polygon | MultiPolygon) || null;
    } else if (!avnUnion) {
      appdGeom = appUnion.geometry as Polygon | MultiPolygon;
    }
  }
  const appdLayer = derivedFromGeometry("APPD", appdGeom, "APP − APPP", workCrs);
  if (appdLayer) {
    derived.push(appdLayer);
    quadroApp.push({
      feicao: "APPD",
      area_ha: appdLayer.areaHa,
      area_m2: appdLayer.areaM2,
      origem: "APP degradada (passivo aproximado)",
    });
  }

  // APPRL = APP ∩ ARL
  const arlUnion = unionMany(collectCodeGeometries(layers, "ARL"));
  if (appUnion && arlUnion) {
    const hit = intersectSafe(appUnion, arlUnion);
    const apprl = derivedFromGeometry(
      "APPRL",
      hit?.geometry as Polygon | MultiPolygon | undefined,
      "APP ∩ ARL",
      workCrs,
    );
    if (apprl) {
      derived.push(apprl);
      quadroApp.push({
        feicao: "APPRL",
        area_ha: apprl.areaHa,
        area_m2: apprl.areaM2,
        origem: "APP ∩ ARL",
      });
    }
  }

  // AURD ≈ (AREA_DECLIVIDADE ∪ AREA_PANTANEIRA) ∩ AUAS
  const decl = collectCodeGeometries(layers, "AREA_DECLIVIDADE");
  const pant = collectCodeGeometries(layers, "AREA_PANTANEIRA");
  const aurBase = unionMany([...decl, ...pant]);
  const auasUnion = unionMany(collectCodeGeometries(layers, "AUAS"));
  if (aurBase && auasUnion) {
    const hit = intersectSafe(aurBase, auasUnion);
    const aurd = derivedFromGeometry(
      "AURD",
      hit?.geometry as Polygon | MultiPolygon | undefined,
      "AUR ∩ AUAS",
      workCrs,
    );
    if (aurd) {
      derived.push(aurd);
      quadroApp.push({
        feicao: "AURD",
        area_ha: aurd.areaHa,
        area_m2: aurd.areaM2,
        origem: "(declividade/pantaneira) ∩ AUAS",
      });
    }
  }

  // ARLDR ≈ ARL ∩ AUAS (RL a recuperar — aproximação comum)
  if (arlUnion && auasUnion) {
    const hit = intersectSafe(arlUnion, auasUnion);
    const arldr = derivedFromGeometry(
      "ARLDR",
      hit?.geometry as Polygon | MultiPolygon | undefined,
      "ARL ∩ AUAS",
      workCrs,
    );
    if (arldr) {
      derived.push(arldr);
      quadroApp.push({
        feicao: "ARLDR",
        area_ha: arldr.areaHa,
        area_m2: arldr.areaM2,
        origem: "ARL ∩ AUAS (a recuperar, aprox.)",
      });
    }
  }

  return { derived, warnings, errorRows, quadroApp };
}
