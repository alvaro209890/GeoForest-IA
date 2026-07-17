import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  WFS_TIMEOUT_MS,
  buildWfsUrl,
  fetchJsonWithTimeout,
} from "../wfs-intersection";
import { simcarGet, withSimcarAuthRetry } from "./client";
import type { MunicipioDetectado } from "./types";

type MunicipioProperties = { ibge: string; nome: string };
type MunicipioFeature = Feature<Polygon | MultiPolygon, MunicipioProperties>;
type MunicipioIndexItem = {
  feature: MunicipioFeature;
  bbox: [number, number, number, number];
};

export type MunicipioSimcarOption = {
  chave: string | number;
  nome: string;
  ibge: string | null;
};

type MunicipioGeoJson = {
  type: "FeatureCollection";
  edition?: string;
  source?: string;
  features: MunicipioFeature[];
};

let municipioIndexCache: MunicipioIndexItem[] | null = null;
let simcarMunicipiosCache:
  | { expiresAtMs: number; items: MunicipioSimcarOption[] }
  | null = null;

export function normalizarNomeMunicipio(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function municipioGeoJsonPath(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const configured = String(process.env.MUNICIPIOS_MT_GEOJSON || "").trim();
  const candidates = [
    configured ? path.resolve(configured) : "",
    path.resolve(process.cwd(), "config", "municipios-mt.geojson"),
    path.resolve(moduleDir, "../../config/municipios-mt.geojson"),
    path.resolve(moduleDir, "../config/municipios-mt.geojson"),
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Malha municipal de MT ausente. Caminhos verificados: ${candidates.join(", ")}`,
    );
  }
  return found;
}

function geometryBbox(geometry: Polygon | MultiPolygon): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const visit = (value: unknown): void => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      const x = Number(value[0]);
      const y = Number(value[1]);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      return;
    }
    for (const item of value) visit(item);
  };
  visit(geometry.coordinates);
  return [minX, minY, maxX, maxY];
}

function municipioIndex(): MunicipioIndexItem[] {
  if (municipioIndexCache) return municipioIndexCache;
  const parsed = JSON.parse(fs.readFileSync(municipioGeoJsonPath(), "utf8")) as MunicipioGeoJson;
  if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
    throw new Error("Malha municipal de MT inválida: FeatureCollection esperada.");
  }
  const features = parsed.features.filter(
    (feature) =>
      (feature.geometry?.type === "Polygon" || feature.geometry?.type === "MultiPolygon") &&
      /^51\d{5}$/.test(String(feature.properties?.ibge || "")) &&
      Boolean(feature.properties?.nome),
  );
  if (features.length < 141) {
    throw new Error(`Malha municipal de MT incompleta: ${features.length} feições válidas.`);
  }
  municipioIndexCache = features.map((feature) => ({
    feature,
    bbox: geometryBbox(feature.geometry),
  }));
  return municipioIndexCache;
}

export function listarMunicipiosMtLocais(): Array<{ nome: string; ibge: string }> {
  return municipioIndex().map(({ feature }) => ({
    nome: feature.properties.nome,
    ibge: feature.properties.ibge,
  }));
}

export function municipioNaoDetectado(): MunicipioDetectado {
  return { nome: null, ibge: null, fonte: "nao-detectado" };
}

export function detectarMunicipioMt(
  coordinate: [number, number],
): MunicipioDetectado | null {
  const lon = Number(coordinate?.[0]);
  const lat = Number(coordinate?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  if (lon < -62 || lon > -50 || lat < -19 || lat > -7) return null;
  const candidatePoint = point([lon, lat]);
  for (const item of municipioIndex()) {
    const [minX, minY, maxX, maxY] = item.bbox;
    if (lon < minX || lon > maxX || lat < minY || lat > maxY) continue;
    if (!booleanPointInPolygon(candidatePoint, item.feature, { ignoreBoundary: false })) continue;
    return {
      nome: item.feature.properties.nome,
      ibge: item.feature.properties.ibge,
      fonte: "malha-ibge",
    };
  }
  return null;
}

export async function detectarMunicipioWfsSema(
  coordinate: [number, number],
): Promise<MunicipioDetectado | null> {
  const lon = Number(coordinate?.[0]);
  const lat = Number(coordinate?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  const layer = String(
    process.env.SIMCAR_MUNICIPIO_WFS_LAYER || "Geoportal:LIM_MUNICIPIOS_MT",
  ).trim();
  const url = buildWfsUrl({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: layer,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    propertyName: "MUNICIPIO,COD_IBGE",
    count: 2,
    CQL_FILTER: `INTERSECTS(SHAPE,POINT(${lon.toFixed(8)} ${lat.toFixed(8)}))`,
  });
  const raw = await fetchJsonWithTimeout<{
    features?: Array<{ properties?: Record<string, unknown> }>;
  }>(url, WFS_TIMEOUT_MS);
  const properties = raw.features?.[0]?.properties;
  const nome = String(properties?.MUNICIPIO || properties?.municipio || "").trim();
  const ibge = String(properties?.COD_IBGE || properties?.cod_ibge || "").trim();
  if (!nome || !/^51\d{5}$/.test(ibge)) return null;
  return { nome, ibge, fonte: "wfs-sema" };
}

export async function detectarMunicipioMtComFallback(
  coordinate: [number, number],
): Promise<MunicipioDetectado | null> {
  return detectarMunicipioMt(coordinate) || detectarMunicipioWfsSema(coordinate);
}

export async function listarMunicipiosSimcar(
  forceRefresh = false,
): Promise<MunicipioSimcarOption[]> {
  const now = Date.now();
  if (!forceRefresh && simcarMunicipiosCache && simcarMunicipiosCache.expiresAtMs > now) {
    return simcarMunicipiosCache.items;
  }
  const raw = (await withSimcarAuthRetry((token) =>
    simcarGet(token, "Municipio/ListarMatoGrosso"),
  )) as any;
  const source = Array.isArray(raw) ? raw : Array.isArray(raw?.Data) ? raw.Data : [];
  const localByName = new Map(
    listarMunicipiosMtLocais().map((item) => [normalizarNomeMunicipio(item.nome), item]),
  );
  const items = source
    .map((item: any) => {
      const nome = String(item?.Texto ?? item?.texto ?? "").trim();
      const chave = item?.Chave ?? item?.chave;
      const local = localByName.get(normalizarNomeMunicipio(nome));
      return { chave, nome, ibge: local?.ibge || null } as MunicipioSimcarOption;
    })
    .filter((item: MunicipioSimcarOption) => item.nome && item.chave !== undefined);
  if (!items.length) throw new Error("SIMCAR não retornou a lista de municípios de MT.");
  simcarMunicipiosCache = { expiresAtMs: now + 24 * 60 * 60 * 1000, items };
  return items;
}

export async function resolverChaveMunicipioSimcar(
  municipio: Pick<MunicipioDetectado, "nome" | "ibge">,
): Promise<MunicipioSimcarOption | null> {
  const items = await listarMunicipiosSimcar();
  const byIbge = municipio.ibge ? items.find((item) => item.ibge === municipio.ibge) : null;
  if (byIbge) return byIbge;
  const normalized = normalizarNomeMunicipio(municipio.nome);
  return items.find((item) => normalizarNomeMunicipio(item.nome) === normalized) || null;
}

export function __resetMunicipioCachesForTests(): void {
  municipioIndexCache = null;
  simcarMunicipiosCache = null;
}
