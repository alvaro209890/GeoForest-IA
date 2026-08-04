/**
 * Helpers compartilhados: leitura do ZIP, nomes seguros, CSV e ZIP aninhado.
 */
import archiver from "archiver";
import type { GeometryErrorRow, SimcarRuleLayer } from "../geometry-errors";
import { geometryPlanarAreaM2, metricProjDefFor, recordToGeoJSON } from "../geometry-errors";
import { difference as turfDifference, featureCollection as turfFeatureCollection, union as turfUnion } from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import type { SimcarLayerCode } from "../simcar-rules";
import { recognizeSimcarLayer } from "../simcar-rules";
import type { DbfFieldDef, PointShpRecord, ShpRecord } from "../shapefile-writer";
import { buildDbfBuffer, buildPointShpAndShx, buildShpAndShx } from "../shapefile-writer";
import { getZipLayerGroups } from "../vertices-proximas";
import { GEOMETRIAS_TABELA } from "./constants";
import { QuadroAreaRow } from "./types";

export function groupsFromZip(zipBuffer: Buffer) {
  return getZipLayerGroups(zipBuffer);
}

/* ────────── relatório oficial do ProcessarGeo (oráculo CAR 270069) ────────── */


/**
 * Calcula a tabela "Geometrias encontradas" como a SEMA: área PLANAR em UTM
 * (validado a ≤0,0003 ha no oráculo) e, na linha ARL, recorte de
 * UTILIDADE_PUBLICA/INTERESSE_SOCIAL antes de medir (área e quantidade das
 * partes resultantes; oráculo: ARL 62.302,3082 ha = ARL − UP).
 */
export function computeGeometriasEncontradas(args: {
  ruleLayers: SimcarRuleLayer[];
  pointCounts: Map<SimcarLayerCode, number>;
}): Array<{ rotulo: string; descricao: string; areaHa: number; quantidade: number }> {
  const byCode = new Map<SimcarLayerCode, Array<{ layer: SimcarRuleLayer; metricProjDef: string }>>();
  for (const layer of args.ruleLayers) {
    const code = recognizeSimcarLayer(layer.name);
    if (!code) continue;
    const entry = { layer, metricProjDef: metricProjDefFor(layer.crs, layer.records) };
    const list = byCode.get(code);
    if (list) list.push(entry);
    else byCode.set(code, [entry]);
  }
  const layersOf = (codes: SimcarLayerCode[]) => codes.flatMap((code) => byCode.get(code) || []);

  let eraseUnion: Feature<Polygon | MultiPolygon> | null = null;
  for (const { layer } of layersOf(["AREA_UTILIDADE_PUBLICA", "AREA_INTERESSE_SOCIAL"])) {
    for (const rec of layer.records) {
      const geometry = recordToGeoJSON(rec);
      if (!geometry) continue;
      const f = { type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>;
      try {
        eraseUnion = eraseUnion ? (turfUnion(turfFeatureCollection([eraseUnion, f]) as any) as any) : f;
      } catch {
        /* união falhou nesta feição: segue com as demais */
      }
    }
  }

  const rows: Array<{ rotulo: string; descricao: string; areaHa: number; quantidade: number }> = [];
  for (const def of GEOMETRIAS_TABELA) {
    if (def.ponto) {
      const quantidade = def.codes.reduce((sum, code) => sum + (args.pointCounts.get(code) || 0), 0);
      rows.push({ rotulo: def.rotulo, descricao: def.descricao, areaHa: 0, quantidade });
      continue;
    }
    let areaM2 = 0;
    let quantidade = 0;
    for (const { layer, metricProjDef } of layersOf(def.codes)) {
      for (const rec of layer.records) {
        const geometry = recordToGeoJSON(rec);
        if (!geometry) continue;
        if (def.recorteUp && eraseUnion) {
          let diff: Feature<Polygon | MultiPolygon> | null;
          try {
            diff = turfDifference(
              turfFeatureCollection([
                { type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>,
                eraseUnion,
              ]) as any,
            ) as Feature<Polygon | MultiPolygon> | null;
          } catch {
            diff = { type: "Feature", properties: {}, geometry } as Feature<Polygon | MultiPolygon>;
          }
          if (!diff?.geometry) continue; // feição toda dentro do recorte
          const polys =
            diff.geometry.type === "Polygon" ? [diff.geometry.coordinates] : diff.geometry.coordinates;
          for (const poly of polys) {
            const partM2 = geometryPlanarAreaM2(
              { type: "Polygon", coordinates: poly as number[][][] },
              layer.crs,
              metricProjDef,
            );
            if (partM2 < 0.01) continue; // resíduo numérico do recorte
            areaM2 += partM2;
            quantidade += 1;
          }
        } else {
          areaM2 += geometryPlanarAreaM2(geometry, layer.crs, metricProjDef);
          quantidade += 1;
        }
      }
    }
    rows.push({ rotulo: def.rotulo, descricao: def.descricao, areaHa: areaM2 / 10000, quantidade });
  }
  return rows;
}


export function safeSegment(input: string): string {
  return String(input || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120);
}

export function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(rows: GeometryErrorRow[]): Buffer {
  const headers = ["camada", "tipo", "feicao", "parte", "anel", "x", "y", "detalhe"];
  const lines = rows.map((row) => headers.map((h) => csvEscape((row as any)[h])).join(";"));
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

export function buildQuadroCsv(rows: QuadroAreaRow[]): Buffer {
  const headers = ["camada", "codigo", "feicoes", "erros", "corrigidas", "area_m2", "area_ha"];
  const lines = rows.map((row) =>
    headers.map((h) => csvEscape((row as any)[h])).join(";"),
  );
  return Buffer.from([headers.join(";"), ...lines].join("\n"), "utf8");
}

export function appendPointSet(
  archive: { append: (data: Buffer, opts: { name: string }) => void },
  folder: string,
  baseName: string,
  records: PointShpRecord[],
  fields: DbfFieldDef[],
  prj: string,
): void {
  const base = folder ? `${folder}/${baseName}` : baseName;
  const points = buildPointShpAndShx(records, 1);
  archive.append(points.shp, { name: `${base}.shp` });
  archive.append(points.shx, { name: `${base}.shx` });
  archive.append(buildDbfBuffer(records.map((p) => p.attributes), fields), { name: `${base}.dbf` });
  archive.append(Buffer.from(prj, "utf8"), { name: `${base}.prj` });
}

/** Monta um ZIP interno (ex.: arquivo_processado.zip) a partir de entradas buffer. */
export function buildNestedZip(files: Array<{ name: string; data: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (c: Buffer) => chunks.push(c));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.data, { name: f.name });
    archive.finalize().catch(reject);
  });
}

export function layerShpFiles(
  name: string,
  records: ShpRecord[],
  fields: DbfFieldDef[],
  prj: string,
): Array<{ name: string; data: Buffer }> {
  const safe = safeSegment(name) || "camada";
  const built = buildShpAndShx(records, 5);
  return [
    { name: `${safe}.shp`, data: built.shp },
    { name: `${safe}.shx`, data: built.shx },
    { name: `${safe}.dbf`, data: buildDbfBuffer(records.map((r) => r.attributes), fields) },
    { name: `${safe}.prj`, data: Buffer.from(prj, "utf8") },
  ];
}


export function parseBase64Zip(raw: unknown): Buffer {
  const value = String(raw || "").trim();
  if (!value) throw new Error("ZIP não enviado.");
  const payload = value.includes(",") ? value.split(",").pop() || "" : value;
  const buffer = Buffer.from(payload, "base64");
  if (buffer.length < 22) throw new Error("ZIP inválido ou vazio.");
  return buffer;
}
