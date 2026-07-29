import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { centroid } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizarNomeMunicipio } from "../simcar-oraculo/municipio-mt";

export type CroquiLandmark = {
  label: string;
  lon: number;
  lat: number;
  /** De onde veio a coordenada — entra no log e nos testes. */
  fonte: "curado" | "sede-ibge" | "centroide";
  /** Texto extra depois de "no município de X – MT" (ex.: "na rotatória..."). */
  introSuffix?: string;
};

/** Pontos conferidos à mão contra os croquis modelo; têm prioridade sobre a sede. */
const LANDMARKS_BY_IBGE: Record<string, Omit<CroquiLandmark, "fonte">> = {
  "5107909": {
    label: "rotatória entre a Av. Norte e a MT-109",
    lon: -52.2196222,
    lat: -12.5900389,
    introSuffix: "na rotatória entre a Av. Norte e a MT-109",
  },
};

const LANDMARKS_BY_NAME: Record<string, Omit<CroquiLandmark, "fonte">> = {
  QUERENCIA: LANDMARKS_BY_IBGE["5107909"],
};

type SedeMunicipal = {
  ibge: string;
  nome: string;
  lon: number;
  lat: number;
  lonVia: number | null;
  latVia: number | null;
  snapM: number | null;
};

let sedesCache: Map<string, SedeMunicipal> | null = null;

function sedesPath(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const configured = String(process.env.SEDES_MT_JSON || "").trim();
  const candidates = [
    configured ? path.resolve(configured) : "",
    path.resolve(process.cwd(), "config", "sedes-mt.json"),
    path.resolve(moduleDir, "../../config/sedes-mt.json"),
    path.resolve(moduleDir, "../config/sedes-mt.json"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function carregarSedesMt(): Map<string, SedeMunicipal> {
  if (sedesCache) return sedesCache;
  const found = sedesPath();
  const map = new Map<string, SedeMunicipal>();
  if (found) {
    try {
      const parsed = JSON.parse(fs.readFileSync(found, "utf8")) as { items?: SedeMunicipal[] };
      for (const item of parsed.items || []) {
        if (item?.ibge && Number.isFinite(item.lon) && Number.isFinite(item.lat)) {
          map.set(String(item.ibge), item);
        }
      }
    } catch (error) {
      console.warn("[CROQUI] Falha ao ler sedes-mt.json:", (error as Error)?.message);
    }
  }
  sedesCache = map;
  return map;
}

export function __resetSedesCacheForTests(): void {
  sedesCache = null;
}

export type PlaceLabel = { nome: string; lon: number; lat: number };

/**
 * Sedes municipais dentro do quadro do mapa. Os croquis modelo mostram o nome
 * das cidades sobre a imagem; como a base licenciada não traz rótulo, o nome é
 * desenhado a partir da mesma tabela que define o ponto de partida.
 */
export function sedesNaBbox(bbox: [number, number, number, number]): PlaceLabel[] {
  const [west, south, east, north] = bbox;
  const out: PlaceLabel[] = [];
  for (const sede of carregarSedesMt().values()) {
    if (sede.lon < west || sede.lon > east || sede.lat < south || sede.lat > north) continue;
    out.push({ nome: sede.nome, lon: sede.lon, lat: sede.lat });
  }
  return out;
}

/**
 * Ponto de partida do croqui: landmark conferido à mão, senão a sede do
 * município encaixada na via mais próxima, senão o centroide da malha.
 */
export function resolveLandmark(
  municipioNome: string | null,
  ibge: string | null,
  municipioFeature?: Feature<Polygon | MultiPolygon> | null,
): CroquiLandmark {
  if (ibge && LANDMARKS_BY_IBGE[ibge]) return { ...LANDMARKS_BY_IBGE[ibge], fonte: "curado" };
  const key = normalizarNomeMunicipio(municipioNome || "");
  if (key && LANDMARKS_BY_NAME[key]) return { ...LANDMARKS_BY_NAME[key], fonte: "curado" };

  const sede = ibge ? carregarSedesMt().get(ibge) : null;
  if (sede) {
    const temVia = Number.isFinite(sede.lonVia) && Number.isFinite(sede.latVia);
    return {
      label: `sede de ${sede.nome}`,
      lon: temVia ? (sede.lonVia as number) : sede.lon,
      lat: temVia ? (sede.latVia as number) : sede.lat,
      fonte: "sede-ibge",
      introSuffix: `na sede do município de ${sede.nome}`,
    };
  }

  if (municipioFeature) {
    const c = centroid(municipioFeature);
    const [lon, lat] = c.geometry.coordinates;
    return {
      label: `centro de ${municipioNome || "município"}`,
      lon: Number(lon),
      lat: Number(lat),
      fonte: "centroide",
      introSuffix: `no centro do município de ${municipioNome || "MT"}`,
    };
  }

  return {
    label: "ponto de referência municipal",
    lon: -52.22,
    lat: -12.59,
    fonte: "centroide",
    introSuffix: "em ponto de referência municipal",
  };
}
