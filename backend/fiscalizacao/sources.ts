/**
 * Coleta das feições de fiscalização nas três fontes.
 *
 * Cada fonte tem um jeito próprio de filtrar por área, e os dois filtros abaixo
 * foram calibrados contra feições de coordenada conhecida — ver NOTA em cada um.
 * Um filtro espacial errado aqui devolve lista vazia **sem erro**, o que se
 * parece exatamente com "não há ocorrência". Por isso os dois têm nota fixa.
 */
import type { Point, Polygon, MultiPolygon } from "geojson";
import {
  HTTP_USER_AGENT,
  IMAP_LAYERS,
  IMAP_WFS_BASE,
  MAX_FEATURES_PER_LAYER,
  PAMGIA_EMBARGOS_URL,
  REQUEST_TIMEOUT_MS,
  type ImapLayerDef,
} from "./constants";
import type { FiscalizacaoGeometry, FiscalizacaoRecord } from "./types";
import { propStr } from "../overlap/utils";

type Bbox = [number, number, number, number];

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": HTTP_USER_AGENT, Accept: "application/json", ...(init?.headers || {}) },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Converte data em milissegundos, "dd/mm/aaaa", ISO ou só o ano para ISO curto. */
export function normalizeDate(raw: unknown): { iso: string; ano: string } {
  const value = String(raw ?? "").trim();
  if (!value) return { iso: "", ano: "" };

  if (/^\d{13}$/.test(value)) {
    const d = new Date(Number(value));
    return { iso: d.toISOString().slice(0, 10), ano: String(d.getUTCFullYear()) };
  }
  if (/^\d{4}$/.test(value)) return { iso: "", ano: value };

  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return { iso: `${br[3]}-${br[2]}-${br[1]}`, ano: br[3] };

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return { iso: `${iso[1]}-${iso[2]}-${iso[3]}`, ano: iso[1] };

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 1e11) {
    const d = new Date(asNumber);
    return { iso: d.toISOString().slice(0, 10), ano: String(d.getUTCFullYear()) };
  }
  return { iso: "", ano: "" };
}

/** Formata CPF/CNPJ; devolve o valor original quando não tem 11/14 dígitos. */
export function formatCpfCnpj(raw: unknown): string {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (digits.length === 11) {
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  }
  if (digits.length === 14) {
    return `${digits.slice(0, 2)}.${digits.slice(2, 5)}.${digits.slice(5, 8)}/${digits.slice(8, 12)}-${digits.slice(12)}`;
  }
  return String(raw ?? "").trim();
}

/** Converte `rings` do ArcGIS em geometria GeoJSON. */
export function esriRingsToGeometry(rings: unknown): Polygon | MultiPolygon | null {
  if (!Array.isArray(rings) || rings.length === 0) return null;
  const valid = rings.filter(
    (r) => Array.isArray(r) && r.length >= 4 && r.every((p: unknown) => Array.isArray(p) && p.length >= 2),
  ) as number[][][];
  if (!valid.length) return null;
  if (valid.length === 1) return { type: "Polygon", coordinates: [valid[0]] };
  // O ArcGIS não distingue ilha de buraco no JSON simples; cada anel vira um
  // polígono próprio, o que é seguro para área e desenho.
  return { type: "MultiPolygon", coordinates: valid.map((r) => [r]) };
}

/**
 * Embargos do IBAMA via REST do PAMGIA.
 *
 * NOTA: o serviço responde 403 sem User-Agent de navegador. A consulta usa
 * `geometryType=esriGeometryEnvelope` com `inSR=4674` — o mesmo CRS das
 * camadas, então não há reprojeção envolvida.
 */
export async function fetchIbamaFeatures(bbox: Bbox): Promise<FiscalizacaoRecord[]> {
  const body = new URLSearchParams({
    geometry: bbox.join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4674",
    outSR: "4674",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "*",
    returnGeometry: "true",
    resultRecordCount: String(MAX_FEATURES_PER_LAYER),
    f: "json",
  });

  const data = await fetchJson(PAMGIA_EMBARGOS_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  });
  if (data?.error) throw new Error(String(data.error?.message || "Erro no PAMGIA."));

  const out: FiscalizacaoRecord[] = [];
  for (const feature of data?.features || []) {
    const geometry = esriRingsToGeometry(feature?.geometry?.rings);
    if (!geometry) continue;
    const a = feature.attributes || {};
    const { iso, ano } = normalizeDate(a.dat_embargo);
    out.push({
      source: "ibama",
      layerLabel: "Embargo IBAMA",
      kind: "embargo",
      nome: String(a.nome_embargado || "").trim(),
      cpfCnpj: formatCpfCnpj(a.cpf_cnpj_embargado),
      documento: [a.num_tad, a.serie_tad].filter(Boolean).join("-"),
      numeroProcesso: String(a.num_processo || "").trim(),
      data: iso,
      ano,
      municipio: String(a.municipio || "").trim(),
      imovel: String(a.nome_imovel || a.des_localizacao || "").trim(),
      descricao: String(a.des_infracao || a.des_tad || "").trim(),
      situacao: String(a.sit_desmatamento || "").trim(),
      areaDeclaradaHa: Number(a.qtd_area_embargada) || 0,
      areaGeomHa: 0,
      sobreposicaoHa: 0,
      percentualAtp: 0,
      distanciaM: 0,
      incidente: false,
      geometry,
    });
  }
  return out;
}

/**
 * Uma camada de fiscalização do GeoServer da IMAP.
 *
 * NOTA CRÍTICA: `BBOX(the_geom,minx,miny,maxx,maxy)` **sem o CRS** devolve 0
 * feições neste servidor, em qualquer lugar do mapa, e sem erro nenhum. O 5º
 * argumento `'EPSG:4674'` é obrigatório. `INTERSECTS(the_geom, POLYGON(...))`
 * também devolve 0 e não deve ser usado aqui.
 */
export async function fetchImapLayer(layer: ImapLayerDef, bbox: Bbox): Promise<FiscalizacaoRecord[]> {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: `cbers:${layer.name}`,
    outputFormat: "application/json",
    srsName: "EPSG:4674",
    count: String(MAX_FEATURES_PER_LAYER),
    cql_filter: `BBOX(the_geom,${bbox[0]},${bbox[1]},${bbox[2]},${bbox[3]},'EPSG:4674')`,
  });

  const data = await fetchJson(`${IMAP_WFS_BASE}?${params.toString()}`);
  const out: FiscalizacaoRecord[] = [];

  for (const feature of data?.features || []) {
    // Geometria vem do WFS sem tipagem garantida — a checagem é em runtime.
    const geometry = feature?.geometry as { type?: string; coordinates?: unknown } | undefined;
    const tipo = String(geometry?.type || "");
    if (!["Polygon", "MultiPolygon", "Point", "MultiPoint"].includes(tipo)) continue;

    const props = (feature.properties || {}) as Record<string, unknown>;
    const rawDate = propStr(props, ...layer.fieldData);
    const { iso, ano } = normalizeDate(rawDate);

    // As camadas SIGA de ponto vêm como MultiPoint de um ponto só; achatar aqui
    // deixa o desenho e o shapefile de saída com um caso a menos para tratar.
    let geom: FiscalizacaoGeometry;
    if (tipo === "MultiPoint") {
      const coords = (geometry as any)?.coordinates?.[0];
      if (!Array.isArray(coords) || coords.length < 2) continue;
      geom = { type: "Point", coordinates: [coords[0], coords[1]] } as Point;
    } else {
      geom = geometry as unknown as FiscalizacaoGeometry;
    }

    out.push({
      source: layer.source,
      layerLabel: layer.label,
      kind: layer.kind,
      nome: propStr(props, ...layer.fieldNome),
      cpfCnpj: formatCpfCnpj(propStr(props, ...layer.fieldCpf)),
      documento: propStr(props, ...layer.fieldDoc),
      numeroProcesso: propStr(props, ...layer.fieldProcesso),
      data: iso,
      ano,
      municipio: propStr(props, ...layer.fieldMunicipio),
      imovel: propStr(props, ...layer.fieldImovel),
      descricao: propStr(props, ...layer.fieldDescricao).slice(0, 500),
      situacao: propStr(props, ...layer.fieldSituacao),
      areaDeclaradaHa: Number(propStr(props, ...layer.fieldArea)) || 0,
      areaGeomHa: 0,
      sobreposicaoHa: 0,
      percentualAtp: 0,
      distanciaM: 0,
      incidente: false,
      geometry: geom,
    });
  }
  return out;
}

/** Todas as camadas SEMA ou SIGA. Uma camada que falha não derruba as outras. */
export async function fetchImapSource(
  source: "sema" | "siga",
  bbox: Bbox,
): Promise<{ records: FiscalizacaoRecord[]; errors: string[] }> {
  const layers = IMAP_LAYERS.filter((l) => l.source === source);
  const results = await Promise.all(
    layers.map(async (layer) => {
      try {
        return { records: await fetchImapLayer(layer, bbox), error: "" };
      } catch (error: any) {
        return { records: [] as FiscalizacaoRecord[], error: `${layer.label}: ${error?.message || error}` };
      }
    }),
  );
  return {
    records: results.flatMap((r) => r.records),
    errors: results.map((r) => r.error).filter(Boolean),
  };
}
