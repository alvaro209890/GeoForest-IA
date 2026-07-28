import { centroid } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import { normalizarNomeMunicipio } from "../simcar-oraculo/municipio-mt";

export type CroquiLandmark = {
  label: string;
  lon: number;
  lat: number;
  /** Texto extra após "no município de X – MT" (ex.: "na rotatória...") */
  introSuffix?: string;
};

/** Landmarks calibrados com os croquis modelo (Querência primeiro). */
const LANDMARKS_BY_IBGE: Record<string, CroquiLandmark> = {
  "5107909": {
    label: "rotatória entre a Av. Norte e a MT-109",
    lon: -52.2196222,
    lat: -12.5900389,
    introSuffix: "na rotatória entre a Av. Norte e a MT-109",
  },
};

const LANDMARKS_BY_NAME: Record<string, CroquiLandmark> = {
  QUERENCIA: LANDMARKS_BY_IBGE["5107909"],
};

export function resolveLandmark(
  municipioNome: string | null,
  ibge: string | null,
  municipioFeature?: Feature<Polygon | MultiPolygon> | null,
): CroquiLandmark {
  if (ibge && LANDMARKS_BY_IBGE[ibge]) return LANDMARKS_BY_IBGE[ibge];
  const key = normalizarNomeMunicipio(municipioNome || "");
  if (key && LANDMARKS_BY_NAME[key]) return LANDMARKS_BY_NAME[key];
  if (municipioFeature) {
    const c = centroid(municipioFeature);
    const [lon, lat] = c.geometry.coordinates;
    return {
      label: `centro de ${municipioNome || "município"}`,
      lon: Number(lon),
      lat: Number(lat),
      introSuffix: `no centro do município de ${municipioNome || "MT"}`,
    };
  }
  return {
    label: "ponto de referência municipal",
    lon: -52.22,
    lat: -12.59,
    introSuffix: "em ponto de referência municipal",
  };
}
