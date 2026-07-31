/**
 * Análise de sobreposição SIGEF × CAR (estadual/federal) e CAR estadual × CAR estadual.
 *
 * Gera até 3 planilhas ExcelJS no formato das referências Joelise:
 *   - SIGEF × CAR estadual
 *   - SIGEF × CAR federal (SICAR)
 *   - CAR estadual × CAR estadual (didática)
 *
 * Endpoints:
 *   POST /api/overlap/upload
 *   POST /api/overlap/process
 *   GET  /api/overlap/jobs/:id/status
 *   GET  /api/overlap/jobs/:id/events
 *   GET  /api/overlap/download/:id
 *   DELETE /api/overlap/jobs/:id
 *   GET  /api/overlap/sources/health
 */
import type { Express, Request, Response } from "express";
import archiver from "archiver";
import crypto from "node:crypto";
import fs from "node:fs";
import proj4 from "proj4";
import ExcelJS from "exceljs";
import {
  bbox as turfBbox,
  buffer as turfBuffer,
  intersect as turfIntersect,
  featureCollection as turfFeatureCollection,
  area as turfArea,
  union as turfUnion,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import {
  getAbsoluteStoragePath,
  readDocBySegments,
  removeStoragePath,
  saveUserBuffer,
  stripUndefinedDeep,
  writeDocBySegments,
} from "./local-storage";
import { finishJob, isCancelRequested, requestCancel, startJob } from "./processing-jobs";
import { parseUserShapefile } from "./simcar";
import { fetchParcelByCode } from "./sigef-client";
import {
  buildWfsUrl,
  fetchJsonWithTimeout,
  normalizePolygonGeometry,
  WFS_TIMEOUT_MS,
} from "./wfs-intersection";
import { estimateUtmProjFromLonLat } from "./vertices-proximas";

proj4.defs("EPSG:4674", "+proj=longlat +ellps=GRS80 +no_defs +type=crs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_BUFFER_METERS = 50;
const MIN_OVERLAP_M2 = 0.5;

export type OverlapMode =
  | "sigef-car-estadual"
  | "sigef-car-federal"
  | "car-estadual-car-estadual";

const SEMA_CAR_ATP_LAYER = process.env.SEMA_CAR_ATP_WFS_LAYER || "Geoportal:CAR_ATP";
const SEMA_CAR_REQ_LAYER =
  process.env.SEMA_CAR_REQUIRED_WFS_LAYER || "Geoportal:MVW_REQUERIMENTO_ATP";
const SICAR_WFS_BASE_URL =
  process.env.SICAR_WFS_BASE_URL || "https://geoserver.car.gov.br/geoserver/sicar/ows";
const SICAR_WFS_LAYER = process.env.SICAR_WFS_LAYER || "sicar:sicar_imoveis_mt";
const SICAR_WFS_TIMEOUT_MS = Number(process.env.SICAR_WFS_TIMEOUT_MS || Math.max(WFS_TIMEOUT_MS, 90000));

const subscribers = new Map<string, Set<Response>>();

type PolyFeature = Feature<Polygon | MultiPolygon>;

type TargetParcel = {
  id: string;
  label: string;
  parcelaCodigo?: string;
  geometry: Polygon | MultiPolygon;
  areaHa: number;
};

type CarEstadualCandidate = {
  numeroEstadual: string;
  nomePropriedade: string;
  carFederal: string;
  situacao: string;
  situacaoRaw: string;
  protocolo: string;
  encontradoEm: string[];
  geometry: Polygon | MultiPolygon;
  areaHa: number;
};

type CarFederalCandidate = {
  codImovel: string;
  status: string;
  condicao: string;
  geometry: Polygon | MultiPolygon;
  areaHa: number;
};

type OverlapDetailEstadual = {
  targetId: string;
  targetLabel: string;
  targetAreaHa: number;
  numeroEstadual: string;
  nomePropriedade: string;
  carFederal: string;
  situacao: string;
  encontradoEm: string;
  carAreaHa: number;
  overlapHa: number;
  overlapPct: number;
  protocolo: string;
  isOwn: boolean;
  isCancelled: boolean;
};

type OverlapDetailFederal = {
  targetId: string;
  targetLabel: string;
  targetAreaHa: number;
  codImovel: string;
  status: string;
  condicao: string;
  carAreaHa: number;
  overlapHa: number;
  overlapPct: number;
  isCancelled: boolean;
};

/* ─────────────────────────── util ─────────────────────────── */

function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}

function writeSse(res: Response, data: Record<string, unknown>): void {
  if (res.writableEnded || res.destroyed || (res as any)?.socket?.destroyed) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    if (typeof (res as any).flush === "function") (res as any).flush();
  } catch {
    // conexão encerrada
  }
}

function emitJobEvent(jobId: string, data: Record<string, unknown>): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const r of set) writeSse(r, data);
}

function closeSubscribers(jobId: string): void {
  const set = subscribers.get(jobId);
  if (!set) return;
  for (const r of set) {
    if (!r.writableEnded) r.end();
  }
  subscribers.delete(jobId);
}

function persistJob(uid: string, jobId: string, patch: Record<string, unknown>): void {
  writeDocBySegments(
    ["users", uid, "overlap_jobs", jobId],
    stripUndefinedDeep({ jobId, ...patch, updatedAtMs: Date.now() }),
    { merge: true },
  );
}

function progress(uid: string, jobId: string, patch: Record<string, unknown>): void {
  persistJob(uid, jobId, patch);
  emitJobEvent(jobId, { type: "progress", jobId, ...patch });
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function cleanSituacao(raw: string): string {
  const s = String(raw || "")
    .replace(/^\[|\]$/g, "")
    .trim();
  const map: Record<string, string> = {
    CAR_VALIDADO: "Car Validado",
    CAR_VALIDADO_EM_REGULARIZACAO: "Car Validado Em Regularizacao",
    AGUARDANDO_ENVIO_PRA: "Aguardando Envio Pra",
    AGUARDANDO_COMPLEMENTACAO: "Aguardando Complementacao",
    AGUARDANDO_ANALISE: "Aguardando Analise",
    CANCELADO: "Cancelado",
  };
  return map[s] || s || "Desconhecida";
}

function isCancelledSituacao(raw: string): boolean {
  return /CANCELADO/i.test(String(raw || ""));
}

function federalStatusLabel(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (s === "AT" || s === "ATIVO") return "Ativo";
  if (s === "CA" || s === "CANCELADO" || s === "RE") return "Cancelado";
  return String(raw || "Desconhecido");
}

function isFederalCancelled(raw: string): boolean {
  return /cancel|CA\b|^RE$/i.test(String(raw || ""));
}

function featureAreaHa(geom: Polygon | MultiPolygon): number {
  try {
    return turfArea({ type: "Feature", properties: {}, geometry: geom }) / 10000;
  } catch {
    return 0;
  }
}

function densifiedPlanarAreaM2(geom: Polygon | MultiPolygon): number {
  const polys = geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  const sample = polys[0]?.[0]?.[0];
  if (!sample) return 0;
  const { projDef } = estimateUtmProjFromLonLat(sample[0], sample[1]);
  const densifyRing = (ring: number[][], stepDeg = 0.001): number[][] => {
    const out: number[][] = [];
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[i + 1];
      out.push([x1, y1]);
      const span = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      const extra = Math.min(64, Math.floor(span / stepDeg));
      for (let k = 1; k <= extra; k += 1) {
        out.push([x1 + ((x2 - x1) * k) / (extra + 1), y1 + ((y2 - y1) * k) / (extra + 1)]);
      }
    }
    out.push(ring[ring.length - 1]);
    return out;
  };
  const ringArea = (ring: number[][]): number => {
    const projected = densifyRing(ring).map((pt) => {
      const out = proj4("EPSG:4326", projDef, [pt[0], pt[1]]) as [number, number];
      return Number.isFinite(out[0]) && Number.isFinite(out[1]) ? out : ([pt[0], pt[1]] as [number, number]);
    });
    let area = 0;
    for (let i = 0, j = projected.length - 1; i < projected.length; j = i++) {
      area += projected[j][0] * projected[i][1] - projected[i][0] * projected[j][1];
    }
    return Math.abs(area / 2);
  };
  let total = 0;
  for (const poly of polys) {
    poly.forEach((ring, idx) => {
      const a = ringArea(ring as number[][]);
      total += idx === 0 ? a : -a;
    });
  }
  return Math.max(0, total);
}

function intersectionAreaHa(a: Polygon | MultiPolygon, b: Polygon | MultiPolygon): number {
  try {
    const fc = turfFeatureCollection([
      { type: "Feature", properties: {}, geometry: a },
      { type: "Feature", properties: {}, geometry: b },
    ]);
    const inter = turfIntersect(fc as any);
    if (!inter?.geometry) return 0;
    const geom = normalizePolygonGeometry(inter.geometry);
    if (!geom) return 0;
    return densifiedPlanarAreaM2(geom) / 10000;
  } catch {
    return 0;
  }
}

function expandBbox(
  geom: Polygon | MultiPolygon,
  bufferMeters: number,
): [number, number, number, number] {
  const feat: PolyFeature = { type: "Feature", properties: {}, geometry: geom };
  let buffered = feat;
  try {
    const b = turfBuffer(feat, Math.max(1, bufferMeters), { units: "meters" });
    if (b) buffered = b as PolyFeature;
  } catch {
    // keep original
  }
  const box = turfBbox(buffered);
  return [box[0], box[1], box[2], box[3]];
}

function propStr(props: Record<string, unknown> | null | undefined, ...keys: string[]): string {
  if (!props) return "";
  for (const key of keys) {
    const v = props[key];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  // case-insensitive fallback
  const lowerMap = new Map(Object.keys(props).map((k) => [k.toLowerCase(), k]));
  for (const key of keys) {
    const real = lowerMap.get(key.toLowerCase());
    if (real != null && props[real] != null && String(props[real]).trim()) {
      return String(props[real]).trim();
    }
  }
  return "";
}

async function fetchWfsFeaturesByBbox(args: {
  baseUrl?: string;
  typeName: string;
  bbox: [number, number, number, number];
  maxFeatures?: number;
  includeAuthkey?: boolean;
  timeoutMs?: number;
}): Promise<PolyFeature[]> {
  const [minx, miny, maxx, maxy] = args.bbox;
  const maxFeatures = args.maxFeatures ?? 500;
  const timeoutMs = args.timeoutMs ?? WFS_TIMEOUT_MS;
  const params: Record<string, string> = {
    service: "WFS",
    version: "1.0.0",
    request: "GetFeature",
    typeName: args.typeName,
    outputFormat: "application/json",
    srsName: "EPSG:4326",
    bbox: `${minx},${miny},${maxx},${maxy},EPSG:4326`,
    maxFeatures: String(maxFeatures),
  };

  let url: string;
  if (args.baseUrl) {
    const u = new URL(args.baseUrl);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    // WFS 2.0 style alternate
    if (!u.searchParams.has("typeNames")) u.searchParams.set("typeNames", args.typeName);
    url = u.toString();
  } else {
    url = buildWfsUrl(params, { includeAuthkey: args.includeAuthkey !== false });
  }

  const fc = await fetchJsonWithTimeout<any>(url, timeoutMs);
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const out: PolyFeature[] = [];
  for (const f of features) {
    const geom = normalizePolygonGeometry(f?.geometry);
    if (!geom) continue;
    out.push({
      type: "Feature",
      properties: f?.properties || {},
      geometry: geom,
    });
  }
  return out;
}

async function fetchSicarFeaturesByBbox(
  bbox: [number, number, number, number],
): Promise<PolyFeature[]> {
  const [minx, miny, maxx, maxy] = bbox;
  const u = new URL(SICAR_WFS_BASE_URL);
  u.searchParams.set("service", "WFS");
  u.searchParams.set("version", "2.0.0");
  u.searchParams.set("request", "GetFeature");
  u.searchParams.set("typeNames", SICAR_WFS_LAYER);
  u.searchParams.set("outputFormat", "application/json");
  u.searchParams.set("srsName", "EPSG:4326");
  u.searchParams.set("bbox", `${minx},${miny},${maxx},${maxy},EPSG:4326`);
  u.searchParams.set("count", "500");
  const fc = await fetchJsonWithTimeout<any>(u.toString(), SICAR_WFS_TIMEOUT_MS);
  const features = Array.isArray(fc?.features) ? fc.features : [];
  const out: PolyFeature[] = [];
  for (const f of features) {
    const geom = normalizePolygonGeometry(f?.geometry);
    if (!geom) continue;
    out.push({
      type: "Feature",
      properties: f?.properties || {},
      geometry: geom,
    });
  }
  return out;
}

function mergeCarEstadualCandidates(features: PolyFeature[], sourceLabel: string): CarEstadualCandidate[] {
  const map = new Map<string, CarEstadualCandidate>();
  for (const f of features) {
    const props = (f.properties || {}) as Record<string, unknown>;
    const numero = propStr(props, "NUMEROESTADUAL", "NUMEROESTA", "numeroestadual");
    if (!numero) continue;
    const situacaoRaw = propStr(props, "SITUACAO_CAR", "SITUACAO_C", "SITUACAO");
    const nome = propStr(props, "NOMEPROPRIEDADE", "NOMEPROPRI", "nomepropriedade");
    const carFederal = propStr(props, "CAR_FEDERAL", "CODIGO_CAR_FEDERAL", "cod_imovel");
    const protocolo = propStr(props, "PROTOCOLO", "protocolo");
    const areaHa = Number(propStr(props, "AREA", "area", "AREA_HA")) || featureAreaHa(f.geometry);
    const existing = map.get(numero);
    if (!existing) {
      map.set(numero, {
        numeroEstadual: numero,
        nomePropriedade: nome,
        carFederal,
        situacao: cleanSituacao(situacaoRaw),
        situacaoRaw,
        protocolo,
        encontradoEm: [sourceLabel],
        geometry: f.geometry,
        areaHa,
      });
    } else {
      if (!existing.encontradoEm.includes(sourceLabel)) existing.encontradoEm.push(sourceLabel);
      if (!existing.nomePropriedade && nome) existing.nomePropriedade = nome;
      if (!existing.carFederal && carFederal) existing.carFederal = carFederal;
      if (!existing.protocolo && protocolo) existing.protocolo = protocolo;
      try {
        const u = turfUnion(
          turfFeatureCollection([
            { type: "Feature", properties: {}, geometry: existing.geometry },
            { type: "Feature", properties: {}, geometry: f.geometry },
          ]) as any,
        );
        const g = u?.geometry ? normalizePolygonGeometry(u.geometry) : null;
        if (g) {
          existing.geometry = g;
          existing.areaHa = featureAreaHa(g);
        }
      } catch {
        // keep existing
      }
    }
  }
  return Array.from(map.values());
}

function toFederalCandidates(features: PolyFeature[]): CarFederalCandidate[] {
  const map = new Map<string, CarFederalCandidate>();
  for (const f of features) {
    const props = (f.properties || {}) as Record<string, unknown>;
    const cod = propStr(props, "cod_imovel", "COD_IMOVEL", "codImovel");
    if (!cod) continue;
    const status = federalStatusLabel(propStr(props, "status_imovel", "STATUS_IMOVEL", "ind_status"));
    const condicao = propStr(props, "condicao", "CONDICAO", "des_condic");
    const areaHa = Number(propStr(props, "area", "AREA", "num_area")) || featureAreaHa(f.geometry);
    if (!map.has(cod)) {
      map.set(cod, {
        codImovel: cod,
        status,
        condicao,
        geometry: f.geometry,
        areaHa,
      });
    }
  }
  return Array.from(map.values());
}

/* ─────────────────────────── Excel builders ─────────────────────────── */

const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
const FILL_GREEN: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
const FILL_YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
const FILL_BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7EE" } };
const FONT_HEADER: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = FILL_HEADER;
    cell.font = FONT_HEADER;
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  row.height = 28;
}

function detailFill(row: {
  isOwn?: boolean;
  isCancelled?: boolean;
  overlapPct: number;
}): ExcelJS.Fill | undefined {
  if (row.isOwn) return FILL_BLUE;
  if (row.isCancelled) return FILL_YELLOW;
  if (row.overlapPct < 1) return FILL_GREEN;
  return undefined;
}

async function buildSigefCarEstadualXlsx(args: {
  targets: TargetParcel[];
  details: OverlapDetailEstadual[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GeoForest-IA";

  const resumo = wb.addWorksheet("Resumo por imovel");
  resumo.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Qtd CARs estaduais sobrepostos",
    "Situacao dos CARs estaduais sobrepostos",
    "Area total sobreposta c/ CAR estadual (ha)",
    "% da area sobreposta c/ CAR estadual",
    "Area livre de CAR estadual (ha)",
    "% area livre",
  ]);
  styleHeader(resumo.getRow(1));

  for (const t of args.targets) {
    const rows = args.details.filter((d) => d.targetId === t.id);
    const situacaoCounts = new Map<string, number>();
    for (const r of rows) {
      situacaoCounts.set(r.situacao, (situacaoCounts.get(r.situacao) || 0) + 1);
    }
    const situacaoTxt = Array.from(situacaoCounts.entries())
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    // Approximate union of overlaps via sum capped at target area (conservative for summary)
    const overlapSum = Math.min(
      t.areaHa,
      rows.reduce((acc, r) => acc + r.overlapHa, 0),
    );
    const pct = t.areaHa > 0 ? (overlapSum / t.areaHa) * 100 : 0;
    const livre = Math.max(0, t.areaHa - overlapSum);
    resumo.addRow([
      t.label,
      round4(t.areaHa),
      rows.length,
      situacaoTxt,
      round4(overlapSum),
      round4(pct),
      round4(livre),
      round4(t.areaHa > 0 ? (livre / t.areaHa) * 100 : 0),
    ]);
  }

  const det = wb.addWorksheet("Detalhe sobreposicao Estadual");
  det.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Numero estadual (CAR)",
    "Nome da propriedade (CAR estadual)",
    "CAR federal vinculado",
    "Situacao",
    "Encontrado em",
    "Area total do CAR estadual (ha)",
    "Area de sobreposicao (ha)",
    "% da area do imovel sobreposta",
    "Protocolo",
  ]);
  styleHeader(det.getRow(1));
  for (const d of args.details) {
    const row = det.addRow([
      d.targetLabel,
      round4(d.targetAreaHa),
      d.numeroEstadual,
      d.nomePropriedade,
      d.carFederal,
      d.situacao,
      d.encontradoEm,
      round4(d.carAreaHa),
      round4(d.overlapHa),
      round4(d.overlapPct),
      d.protocolo,
    ]);
    const fill = detailFill(d);
    if (fill) row.eachCell((c) => (c.fill = fill));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function buildSigefCarFederalXlsx(args: {
  targets: TargetParcel[];
  details: OverlapDetailFederal[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const resumo = wb.addWorksheet("Resumo por imovel");
  resumo.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Qtd CARs sobrepostos",
    "Situacao dos CARs sobrepostos",
    "Area total sobreposta c/ CAR (ha)",
    "% da area sobreposta c/ CAR",
    "Area livre de CAR (ha)",
    "% area livre",
  ]);
  styleHeader(resumo.getRow(1));

  for (const t of args.targets) {
    const rows = args.details.filter((d) => d.targetId === t.id);
    const situacaoCounts = new Map<string, number>();
    for (const r of rows) {
      situacaoCounts.set(r.status, (situacaoCounts.get(r.status) || 0) + 1);
    }
    const situacaoTxt = Array.from(situacaoCounts.entries())
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    const overlapSum = Math.min(
      t.areaHa,
      rows.reduce((acc, r) => acc + r.overlapHa, 0),
    );
    const pct = t.areaHa > 0 ? (overlapSum / t.areaHa) * 100 : 0;
    const livre = Math.max(0, t.areaHa - overlapSum);
    resumo.addRow([
      t.label,
      round4(t.areaHa),
      rows.length,
      situacaoTxt,
      round4(overlapSum),
      round4(pct),
      round4(livre),
      round4(t.areaHa > 0 ? (livre / t.areaHa) * 100 : 0),
    ]);
  }

  const det = wb.addWorksheet("Detalhe sobreposicoes CAR");
  det.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Codigo do CAR",
    "Situacao do CAR",
    "Condicao (analise)",
    "Area total do CAR (ha)",
    "Area de sobreposicao (ha)",
    "% da area do imovel sobreposta",
  ]);
  styleHeader(det.getRow(1));
  for (const d of args.details) {
    const row = det.addRow([
      d.targetLabel,
      round4(d.targetAreaHa),
      d.codImovel,
      d.status,
      d.condicao,
      round4(d.carAreaHa),
      round4(d.overlapHa),
      round4(d.overlapPct),
    ]);
    const fill = detailFill({ isCancelled: d.isCancelled, overlapPct: d.overlapPct });
    if (fill) row.eachCell((c) => (c.fill = fill));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

async function buildCarEstadualVsCarEstadualXlsx(args: {
  targets: Array<TargetParcel & { numeroEstadual?: string; situacao?: string }>;
  details: OverlapDetailEstadual[];
  ourNumeros: Set<string>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const intro = wb.addWorksheet("1. Leia primeiro");
  intro.getColumn(1).width = 3;
  intro.getColumn(2).width = 100;
  intro.getCell("B2").value = "ANALISE DE SOBREPOSICAO — CAR ESTADUAL x CAR ESTADUAL";
  intro.getCell("B2").font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
  intro.getCell("B3").value = "Fonte: SEMA-MT (geoportal.sema.mt.gov.br) • Gerado pelo GeoForest-IA";
  intro.getCell("B3").font = { italic: true, size: 10, color: { argb: "FF808080" } };
  intro.getCell("B5").value = "O QUE FOI FEITO";
  intro.getCell("B5").font = { bold: true, color: { argb: "FF1F4E79" } };
  intro.getCell("B6").value =
    "Comparei cada CAR estadual das suas propriedades contra todos os outros CARs estaduais " +
    "na região (incluindo vizinhos). Para cada par calculei a área exata de sobreposição.";
  intro.getCell("B6").alignment = { wrapText: true };
  intro.getRow(6).height = 40;

  const meaningful = args.details.filter((d) => d.overlapPct >= 1 || d.isCancelled);
  intro.getCell("B8").value = "RESULTADO — EM UMA FRASE";
  intro.getCell("B8").font = { bold: true, color: { argb: "FF1F4E79" } };
  intro.getCell("B9").value = meaningful.length
    ? `${meaningful.length} sobreposição(ões) merecem atenção (ver aba 2 e 3).`
    : "Nenhuma propriedade tem sobreposição real com CAR de terceiros — só frestas de divisa.";
  intro.getCell("B9").fill = meaningful.length ? FILL_YELLOW : FILL_GREEN;
  intro.getCell("B9").font = { bold: true };

  intro.getCell("B11").value = "LEGENDA DE CORES (aba de detalhe)";
  intro.getCell("B11").font = { bold: true, color: { argb: "FF1F4E79" } };
  intro.getCell("B12").value = "Azul = CAR da sua propriedade  |  Amarelo = CAR cancelado  |  Verde = sobreposição < 1% (fresta de divisa)";

  const res = wb.addWorksheet("2. Resultado por imovel");
  res.addRow(["RESULTADO POR IMOVEL"]);
  res.addRow(["Um olhar rápido: cada propriedade sua e o veredito"]);
  res.addRow(["Sua propriedade", "CAR estadual", "Situacao do seu CAR", "Area (ha)", "RESULTADO", "Explicacao"]);
  styleHeader(res.getRow(3));

  for (const t of args.targets) {
    const rows = args.details.filter((d) => d.targetId === t.id && !args.ourNumeros.has(d.numeroEstadual));
    const big = rows.filter((d) => d.overlapPct >= 1);
    const cancelled = rows.filter((d) => d.isCancelled && d.overlapPct >= 1);
    let resultado = "OK";
    let explicacao = "Nenhuma sobreposicao real. So encostos de divisa.";
    if (cancelled.length) {
      resultado = "CONFERIR";
      explicacao = `Sobreposição relevante com CAR cancelado (${cancelled.map((c) => c.numeroEstadual).join(", ")}).`;
    } else if (big.length) {
      resultado = "CONFERIR";
      explicacao = `Sobreposição ≥1% com ${big.map((c) => c.numeroEstadual).join(", ")}.`;
    }
    const row = res.addRow([
      t.label,
      t.numeroEstadual || "",
      t.situacao || "",
      round4(t.areaHa),
      resultado,
      explicacao,
    ]);
    if (resultado === "OK") row.getCell(5).fill = FILL_GREEN;
    else row.getCell(5).fill = FILL_YELLOW;
  }

  const det = wb.addWorksheet("3. Detalhe completo");
  det.addRow(["DETALHE DE CADA SOBREPOSICAO ENCONTRADA"]);
  det.addRow(["Ordenado do mais importante para o menos."]);
  det.addRow([
    "Sua propriedade",
    "Seu CAR",
    "CAR que sobrepoe",
    "Nome no CAR que sobrepoe",
    "Situacao dele",
    "De quem e",
    "Sobreposicao",
    "% do seu imovel",
    "O QUE SIGNIFICA",
    "Precisa fazer algo?",
  ]);
  styleHeader(det.getRow(3));

  const sorted = [...args.details].sort((a, b) => b.overlapHa - a.overlapHa);
  for (const d of sorted) {
    if (args.ourNumeros.has(d.numeroEstadual) && d.overlapPct < 0.01) continue;
    const deQuem = args.ourNumeros.has(d.numeroEstadual) ? "SUA propriedade" : "Terceiro";
    const overlapTxt =
      d.overlapHa >= 0.01 ? `${round4(d.overlapHa)} ha` : `${Math.round(d.overlapHa * 10000)} m2`;
    const pctTxt = d.overlapPct < 0.01 ? "menos de 0,01%" : `${round4(d.overlapPct)}%`;
    let significa = "Divisa normal / fresta de mapa.";
    let acao = "Nao.";
    if (d.isCancelled && d.overlapPct >= 1) {
      significa = "Possível registro antigo cancelado sobre a mesma terra.";
      acao = "Confirmar cancelamento na SEMA.";
    } else if (d.overlapPct >= 1 && deQuem === "Terceiro") {
      significa = "Sobreposição relevante com CAR de terceiro.";
      acao = "Analisar no geoportal.";
    } else if (deQuem === "SUA propriedade") {
      significa = "Divisa com outra propriedade sua do mesmo grupo.";
      acao = "Nao.";
    }
    const row = det.addRow([
      d.targetLabel,
      args.targets.find((t) => t.id === d.targetId)?.numeroEstadual || "",
      d.numeroEstadual,
      d.nomePropriedade,
      d.situacao,
      deQuem,
      overlapTxt,
      pctTxt,
      significa,
      acao,
    ]);
    const fill = detailFill(d);
    if (fill) row.eachCell((c) => (c.fill = fill));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ─────────────────────────── core job ─────────────────────────── */

async function resolveTargetsFromUpload(upload: Record<string, any>): Promise<TargetParcel[]> {
  if (Array.isArray(upload.parcelCodes) && upload.parcelCodes.length) {
    const targets: TargetParcel[] = [];
    for (const code of upload.parcelCodes as string[]) {
      const feature = await fetchParcelByCode(code);
      const areaHa = featureAreaHa(feature.geometry);
      targets.push({
        id: code,
        label: code,
        parcelaCodigo: code,
        geometry: feature.geometry,
        areaHa,
      });
    }
    return targets;
  }

  const relative = String(upload.inputRelativePath || "");
  if (!relative) throw new Error("Upload sem geometria.");
  const absolute = getAbsoluteStoragePath(relative);
  const zipBuffer = fs.readFileSync(absolute);
  const parsed = parseUserShapefile(zipBuffer);
  return parsed.polygons.map((poly, idx) => {
    const code = String((poly.properties as any)?.parcela_codigo || "").trim();
    const label =
      code ||
      String((poly.properties as any)?.nome || (poly.properties as any)?.NOME || "").trim() ||
      `Poligono_${idx + 1}`;
    return {
      id: code || `poly_${idx + 1}`,
      label,
      parcelaCodigo: code || undefined,
      geometry: poly.geometry,
      areaHa: featureAreaHa(poly.geometry),
    };
  });
}

async function runOverlapJob(args: {
  uid: string;
  jobId: string;
  upload: Record<string, any>;
  modes: OverlapMode[];
  bufferMeters: number;
}): Promise<void> {
  const { uid, jobId, upload, modes, bufferMeters } = args;
  try {
    progress(uid, jobId, {
      status: "processing",
      stage: "targets",
      percent: 5,
      message: "Resolvendo polígonos alvo...",
    });
    if (isCancelRequested(jobId)) throw new Error("Cancelado pelo usuário.");

    const targets = await resolveTargetsFromUpload(upload);
    if (!targets.length) throw new Error("Nenhum polígono alvo encontrado.");

    const files: Array<{ name: string; buffer: Buffer }> = [];
    const warnings: string[] = [];
    let estadualDetails: OverlapDetailEstadual[] = [];
    let federalDetails: OverlapDetailFederal[] = [];
    let carTargetsForCarCar: Array<TargetParcel & { numeroEstadual?: string; situacao?: string }> = [];
    const ourNumeros = new Set<string>();

    const needEstadual =
      modes.includes("sigef-car-estadual") || modes.includes("car-estadual-car-estadual");
    const needFederal = modes.includes("sigef-car-federal");

    // Preload candidates per target
    const perTargetEstadual = new Map<string, CarEstadualCandidate[]>();
    const perTargetFederal = new Map<string, CarFederalCandidate[]>();

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i];
      const pct = 10 + Math.round((i / Math.max(1, targets.length)) * 50);
      progress(uid, jobId, {
        status: "processing",
        stage: "wfs",
        percent: pct,
        message: `Consultando WFS para ${t.label} (${i + 1}/${targets.length})...`,
      });
      if (isCancelRequested(jobId)) throw new Error("Cancelado pelo usuário.");

      const bbox = expandBbox(t.geometry, bufferMeters);

      if (needEstadual) {
        try {
          const [atp, req] = await Promise.all([
            fetchWfsFeaturesByBbox({ typeName: SEMA_CAR_ATP_LAYER, bbox }),
            fetchWfsFeaturesByBbox({ typeName: SEMA_CAR_REQ_LAYER, bbox }),
          ]);
          const map = new Map<string, CarEstadualCandidate>();
          for (const [feats, label] of [
            [atp, "ATP"] as const,
            [req, "Requerido"] as const,
          ]) {
            for (const c of mergeCarEstadualCandidates(feats, label)) {
              const existing = map.get(c.numeroEstadual);
              if (!existing) {
                map.set(c.numeroEstadual, c);
              } else {
                for (const s of c.encontradoEm) {
                  if (!existing.encontradoEm.includes(s)) existing.encontradoEm.push(s);
                }
                if (!existing.nomePropriedade && c.nomePropriedade) existing.nomePropriedade = c.nomePropriedade;
                if (!existing.carFederal && c.carFederal) existing.carFederal = c.carFederal;
                if (!existing.protocolo && c.protocolo) existing.protocolo = c.protocolo;
              }
            }
          }
          perTargetEstadual.set(t.id, Array.from(map.values()));
        } catch (error: any) {
          warnings.push(`CAR estadual (${t.label}): ${error?.message || error}`);
          perTargetEstadual.set(t.id, []);
        }
      }

      if (needFederal) {
        try {
          const feats = await fetchSicarFeaturesByBbox(bbox);
          perTargetFederal.set(t.id, toFederalCandidates(feats));
        } catch (error: any) {
          warnings.push(`CAR federal (${t.label}): ${error?.message || error}`);
          perTargetFederal.set(t.id, []);
        }
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "intersect",
      percent: 65,
      message: "Calculando interseções...",
    });

    if (modes.includes("sigef-car-estadual") || modes.includes("car-estadual-car-estadual")) {
      for (const t of targets) {
        const cands = perTargetEstadual.get(t.id) || [];
        // Identify "own" CAR as the one with largest overlap
        let best: CarEstadualCandidate | null = null;
        let bestHa = 0;
        for (const c of cands) {
          const ha = intersectionAreaHa(t.geometry, c.geometry);
          if (ha > bestHa) {
            bestHa = ha;
            best = c;
          }
        }
        if (best && bestHa / Math.max(t.areaHa, 1e-9) >= 0.5) {
          ourNumeros.add(best.numeroEstadual);
          carTargetsForCarCar.push({
            ...t,
            id: `car_${best.numeroEstadual}`,
            label: `${t.label} (${best.numeroEstadual})`,
            numeroEstadual: best.numeroEstadual,
            situacao: best.situacao,
            geometry: best.geometry,
            areaHa: best.areaHa,
          });
        }

        for (const c of cands) {
          const overlapHa = intersectionAreaHa(t.geometry, c.geometry);
          const overlapM2 = overlapHa * 10000;
          if (overlapM2 < MIN_OVERLAP_M2) continue;
          estadualDetails.push({
            targetId: t.id,
            targetLabel: t.label,
            targetAreaHa: t.areaHa,
            numeroEstadual: c.numeroEstadual,
            nomePropriedade: c.nomePropriedade,
            carFederal: c.carFederal,
            situacao: c.situacao,
            encontradoEm: c.encontradoEm.join(", "),
            carAreaHa: c.areaHa,
            overlapHa,
            overlapPct: t.areaHa > 0 ? (overlapHa / t.areaHa) * 100 : 0,
            protocolo: c.protocolo,
            isOwn: Boolean(best && c.numeroEstadual === best.numeroEstadual),
            isCancelled: isCancelledSituacao(c.situacaoRaw),
          });
        }
      }
    }

    if (modes.includes("sigef-car-federal")) {
      for (const t of targets) {
        const cands = perTargetFederal.get(t.id) || [];
        for (const c of cands) {
          const overlapHa = intersectionAreaHa(t.geometry, c.geometry);
          const overlapM2 = overlapHa * 10000;
          if (overlapM2 < MIN_OVERLAP_M2) continue;
          federalDetails.push({
            targetId: t.id,
            targetLabel: t.label,
            targetAreaHa: t.areaHa,
            codImovel: c.codImovel,
            status: c.status,
            condicao: c.condicao,
            carAreaHa: c.areaHa,
            overlapHa,
            overlapPct: t.areaHa > 0 ? (overlapHa / t.areaHa) * 100 : 0,
            isCancelled: isFederalCancelled(c.status),
          });
        }
      }
      if (!federalDetails.length && warnings.some((w) => /CAR federal/i.test(w))) {
        warnings.push(
          `Modo federal indisponível ou sem feições. Camada configurada: ${SICAR_WFS_LAYER}`,
        );
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "xlsx",
      percent: 80,
      message: "Gerando planilhas...",
    });

    if (modes.includes("sigef-car-estadual")) {
      files.push({
        name: "SIGEF_sobreposicao_CAR_ESTADUAL.xlsx",
        buffer: await buildSigefCarEstadualXlsx({ targets, details: estadualDetails }),
      });
    }
    if (modes.includes("sigef-car-federal")) {
      files.push({
        name: "SIGEF_sobreposicao_CAR_Federal.xlsx",
        buffer: await buildSigefCarFederalXlsx({ targets, details: federalDetails }),
      });
    }
    if (modes.includes("car-estadual-car-estadual")) {
      // Build CAR×CAR details: for each our CAR target, compare against all candidates in region
      const carCarDetails: OverlapDetailEstadual[] = [];
      // Dedupe car targets by numero
      const uniqueCars = new Map<string, (typeof carTargetsForCarCar)[0]>();
      for (const c of carTargetsForCarCar) {
        if (c.numeroEstadual && !uniqueCars.has(c.numeroEstadual)) uniqueCars.set(c.numeroEstadual, c);
      }
      const carList = Array.from(uniqueCars.values());
      for (const car of carList) {
        // Use candidates from the matching SIGEF target bbox set — union all candidates seen
        const allCands = new Map<string, CarEstadualCandidate>();
        for (const list of perTargetEstadual.values()) {
          for (const c of list) allCands.set(c.numeroEstadual, c);
        }
        for (const c of allCands.values()) {
          if (c.numeroEstadual === car.numeroEstadual) continue;
          const overlapHa = intersectionAreaHa(car.geometry, c.geometry);
          if (overlapHa * 10000 < MIN_OVERLAP_M2) continue;
          carCarDetails.push({
            targetId: car.id,
            targetLabel: car.label,
            targetAreaHa: car.areaHa,
            numeroEstadual: c.numeroEstadual,
            nomePropriedade: c.nomePropriedade,
            carFederal: c.carFederal,
            situacao: c.situacao,
            encontradoEm: c.encontradoEm.join(", "),
            carAreaHa: c.areaHa,
            overlapHa,
            overlapPct: car.areaHa > 0 ? (overlapHa / car.areaHa) * 100 : 0,
            protocolo: c.protocolo,
            isOwn: ourNumeros.has(c.numeroEstadual),
            isCancelled: isCancelledSituacao(c.situacaoRaw),
          });
        }
      }
      files.push({
        name: "CAR_Estadual_sobreposicao_CAR_Estadual.xlsx",
        buffer: await buildCarEstadualVsCarEstadualXlsx({
          targets: carList,
          details: carCarDetails,
          ourNumeros,
        }),
      });
    }

    if (!files.length) throw new Error("Nenhuma planilha gerada. Selecione ao menos um modo.");

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 92,
      message: "Empacotando ZIP...",
    });

    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      archive.on("data", (c: Buffer) => chunks.push(c));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
      for (const f of files) archive.append(f.buffer, { name: f.name });
      if (warnings.length) {
        archive.append(Buffer.from(warnings.join("\n"), "utf8"), { name: "avisos.txt" });
      }
      void archive.finalize();
    });

    const stored = saveUserBuffer({
      uid,
      area: "overlap/output",
      filename: `${jobId}_sobreposicoes.zip`,
      buffer: zipBuffer,
    });

    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: `${files.length} planilha(s) gerada(s) para ${targets.length} imóvel(is).`,
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/overlap/download/${jobId}`,
      files: files.map((f) => f.name),
      targetCount: targets.length,
      warnings,
      createdAt: upload.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    progress(uid, jobId, payload);
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const message = String(error?.message || error || "Falha na análise de sobreposição.");
    progress(uid, jobId, {
      status: /cancel/i.test(message) ? "cancelled" : "failed",
      stage: "error",
      percent: 100,
      message,
      error: message,
    });
    finishJob({
      jobId,
      status: /cancel/i.test(message) ? "cancelled" : "failed",
      error: message,
    });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────────── routes ─────────────────────────── */

export function registerOverlapRoutes(app: Express): void {
  app.get("/api/overlap/sources/health", async (_req: Request, res: Response) => {
    const carFederal: {
      layer: string;
      baseUrl: string;
      ok: boolean;
      error: string;
      sampleFeatures?: number;
    } = {
      layer: SICAR_WFS_LAYER,
      baseUrl: SICAR_WFS_BASE_URL,
      ok: false,
      error: "",
    };
    try {
      const bbox: [number, number, number, number] = [-52.35, -12.75, -52.25, -12.65];
      const feats = await fetchSicarFeaturesByBbox(bbox);
      carFederal.ok = true;
      carFederal.sampleFeatures = feats.length;
    } catch (error: any) {
      carFederal.ok = false;
      carFederal.error = String(error?.message || error);
    }
    res.json({
      sigef: { source: "wfs-incra", ok: true },
      carEstadual: { layers: [SEMA_CAR_ATP_LAYER, SEMA_CAR_REQ_LAYER] },
      carFederal,
    });
  });

  app.post("/api/overlap/upload", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }

      const parcelCodesRaw = (req.body as any)?.parcelCodes;
      const parcelCodes = Array.isArray(parcelCodesRaw)
        ? parcelCodesRaw.map((c: unknown) => String(c || "").trim()).filter(Boolean)
        : String((req.body as any)?.parcelCodesText || "")
            .split(/[\s,;]+/)
            .map((c) => c.trim())
            .filter(Boolean);

      const uploadId = crypto.randomUUID();
      let filename = "sigef_codigos.txt";
      let inputRelativePath = "";
      let inputUrl = "";
      let polygonCount = 0;

      if (parcelCodes.length) {
        polygonCount = parcelCodes.length;
        filename = `sigef_codigos_${parcelCodes.length}.txt`;
        const stored = saveUserBuffer({
          uid,
          area: "overlap/input",
          filename: `${uploadId}_${filename}`,
          buffer: Buffer.from(parcelCodes.join("\n"), "utf8"),
        });
        inputRelativePath = stored.relativePath;
        inputUrl = stored.publicUrl;
      } else {
        filename = safeSegment(String((req.body as any)?.filename || "sigef.zip")) || "sigef.zip";
        const zipBuffer = parseBase64Zip((req.body as any)?.zipBase64);
        const parsed = parseUserShapefile(zipBuffer);
        polygonCount = parsed.polygons.length;
        const stored = saveUserBuffer({
          uid,
          area: "overlap/input",
          filename: `${uploadId}_${filename.toLowerCase().endsWith(".zip") ? filename : `${filename}.zip`}`,
          buffer: zipBuffer,
        });
        inputRelativePath = stored.relativePath;
        inputUrl = stored.publicUrl;
      }

      persistJob(uid, uploadId, {
        type: "upload",
        status: "uploaded",
        filename,
        inputRelativePath,
        inputUrl,
        parcelCodes: parcelCodes.length ? parcelCodes : undefined,
        polygonCount,
        createdAt: new Date().toISOString(),
        expiresAtMs: Date.now() + CACHE_TTL_MS,
      });

      res.json({
        ok: true,
        uploadId,
        filename,
        polygonCount,
        parcelCodes: parcelCodes.length ? parcelCodes : undefined,
        modes: [
          { id: "sigef-car-estadual", label: "SIGEF × CAR estadual" },
          { id: "sigef-car-federal", label: "SIGEF × CAR federal" },
          { id: "car-estadual-car-estadual", label: "CAR estadual × CAR estadual" },
        ],
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao importar dados." });
    }
  });

  app.post("/api/overlap/process", async (req: Request, res: Response) => {
    try {
      const uid = String((req as any).authUid || "").trim();
      if (!uid) {
        res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
        return;
      }
      const uploadId = String((req.body as any)?.uploadId || "").trim();
      const modesRaw = Array.isArray((req.body as any)?.modes) ? (req.body as any).modes : [];
      const modes = modesRaw
        .map((m: unknown) => String(m))
        .filter((m: string): m is OverlapMode =>
          ["sigef-car-estadual", "sigef-car-federal", "car-estadual-car-estadual"].includes(m),
        );
      const bufferMeters = Number((req.body as any)?.bufferMeters);
      if (!uploadId) {
        res.status(400).json({ error: "uploadId é obrigatório." });
        return;
      }
      if (!modes.length) {
        res.status(400).json({ error: "Selecione ao menos um modo de análise." });
        return;
      }
      const upload = readDocBySegments(["users", uid, "overlap_jobs", uploadId]);
      if (!upload || upload.status !== "uploaded") {
        res.status(404).json({ error: "Upload não encontrado." });
        return;
      }
      const job = startJob({
        uid,
        endpoint: "/api/overlap/process",
        metadata: { uploadId, filename: upload.filename, modes },
      });
      persistJob(uid, job.jobId, {
        type: "process",
        uploadId,
        filename: upload.filename,
        modes,
        status: "processing",
        stage: "queued",
        percent: 1,
        message: "Análise de sobreposição enfileirada.",
        createdAt: new Date().toISOString(),
      });
      res.status(202).json({ ok: true, jobId: job.jobId });
      void runOverlapJob({
        uid,
        jobId: job.jobId,
        upload,
        modes,
        bufferMeters: Number.isFinite(bufferMeters) ? bufferMeters : DEFAULT_BUFFER_METERS,
      });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || "Falha ao iniciar análise." });
    }
  });

  app.get("/api/overlap/jobs/:jobId/status", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.json({ ok: true, job: data });
  });

  app.get("/api/overlap/jobs/:jobId/events", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
    if (!data) {
      res.status(404).json({ error: "Job não encontrado." });
      return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    writeSse(res, { type: "snapshot", jobId, job: data });
    const status = String(data.status || "").toLowerCase();
    if (["completed", "failed", "cancelled"].includes(status)) {
      res.end();
      return;
    }
    const set = subscribers.get(jobId) || new Set<Response>();
    set.add(res);
    subscribers.set(jobId, set);
    const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat", jobId }), 15000);
    req.on("close", () => {
      clearInterval(heartbeat);
      set.delete(res);
      if (set.size === 0) subscribers.delete(jobId);
    });
  });

  app.get("/api/overlap/download/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
    if (!data || data.status !== "completed" || !data.outputRelativePath) {
      res.status(404).json({ error: "Resultado não encontrado." });
      return;
    }
    try {
      const absolute = getAbsoluteStoragePath(String(data.outputRelativePath));
      res.download(absolute, `sobreposicoes_${jobId.slice(0, 8)}.zip`);
    } catch (error: any) {
      res.status(500).json({ error: error?.message || "Falha ao baixar ZIP." });
    }
  });

  app.delete("/api/overlap/jobs/:jobId", async (req: Request, res: Response) => {
    const uid = String((req as any).authUid || "").trim();
    const jobId = String(req.params.jobId || "").trim();
    const data = readDocBySegments(["users", uid, "overlap_jobs", jobId]);
    if (!data) {
      res.json({ ok: true });
      return;
    }
    requestCancel(jobId, uid);
    removeStoragePath(String(data.outputRelativePath || ""));
    removeStoragePath(String(data.inputRelativePath || ""));
    persistJob(uid, jobId, { status: "deleted", deletedAt: new Date().toISOString() });
    res.json({ ok: true });
  });
}
