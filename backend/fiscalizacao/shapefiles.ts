/**
 * Shapefiles das feições encontradas — um conjunto por fonte, em SIRGAS 2000
 * geográficas, para abrir direto no ArcMap/QGIS.
 *
 * Polígonos e pontos não cabem no mesmo shapefile, então cada fonte pode gerar
 * dois conjuntos (`_poligono` e `_ponto`).
 */
import {
  buildDbfBuffer,
  buildPointShpAndShx,
  buildShpAndShx,
  geojsonToPolyRecords,
  type DbfFieldDef,
  type PointShpRecord,
  type ShpRecord,
} from "../shapefile-writer";
import { KIND_LABELS } from "./constants";
import type { FiscalizacaoRecord, FiscalizacaoSource } from "./types";

/** SIRGAS 2000 geográficas — mesmo .prj usado nos recortes do SIMCAR. */
export const PRJ_SIRGAS2000 =
  'GEOGCS["GCS_SIRGAS_2000",DATUM["D_SIRGAS_2000",' +
  'SPHEROID["Geodetic_Reference_System_of_1980",6378137.0,298.257222101]],' +
  'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** Nomes de campo DBF têm teto de 10 caracteres — daí as abreviações. */
const FIELDS: DbfFieldDef[] = [
  { name: "FONTE", type: "C", length: 10, decimals: 0 },
  { name: "CAMADA", type: "C", length: 60, decimals: 0 },
  { name: "NATUREZA", type: "C", length: 20, decimals: 0 },
  { name: "NOME", type: "C", length: 80, decimals: 0 },
  { name: "CPF_CNPJ", type: "C", length: 20, decimals: 0 },
  { name: "DOCUMENTO", type: "C", length: 30, decimals: 0 },
  { name: "PROCESSO", type: "C", length: 30, decimals: 0 },
  { name: "DATA", type: "C", length: 10, decimals: 0 },
  { name: "ANO", type: "C", length: 4, decimals: 0 },
  { name: "MUNICIPIO", type: "C", length: 40, decimals: 0 },
  { name: "IMOVEL", type: "C", length: 60, decimals: 0 },
  { name: "SITUACAO", type: "C", length: 40, decimals: 0 },
  { name: "AREA_DECL", type: "N", length: 18, decimals: 4 },
  { name: "AREA_GEOM", type: "N", length: 18, decimals: 4 },
  { name: "SOBREP_HA", type: "N", length: 18, decimals: 4 },
  { name: "PCT_ATP", type: "N", length: 10, decimals: 2 },
  { name: "DIST_M", type: "N", length: 14, decimals: 2 },
  { name: "INCIDENTE", type: "C", length: 3, decimals: 0 },
];

function attributesOf(record: FiscalizacaoRecord): Record<string, string | number | null> {
  return {
    FONTE: record.source.toUpperCase(),
    CAMADA: record.layerLabel,
    NATUREZA: KIND_LABELS[record.kind],
    NOME: record.nome,
    CPF_CNPJ: record.cpfCnpj,
    DOCUMENTO: record.documento,
    PROCESSO: record.numeroProcesso,
    DATA: record.data,
    ANO: record.ano,
    MUNICIPIO: record.municipio,
    IMOVEL: record.imovel,
    SITUACAO: record.situacao,
    AREA_DECL: record.areaDeclaradaHa,
    AREA_GEOM: record.areaGeomHa,
    SOBREP_HA: record.sobreposicaoHa,
    PCT_ATP: record.percentualAtp,
    DIST_M: record.distanciaM < 0 ? 0 : record.distanciaM,
    INCIDENTE: record.incidente ? "SIM" : "NAO",
  };
}

export type ShapefileSet = {
  /** Nome base, sem extensão. */
  stem: string;
  files: Array<{ name: string; buffer: Buffer }>;
};

function buildSet(
  stem: string,
  shp: Buffer,
  shx: Buffer,
  rows: Array<Record<string, string | number | null>>,
): ShapefileSet {
  return {
    stem,
    files: [
      { name: `${stem}.shp`, buffer: shp },
      { name: `${stem}.shx`, buffer: shx },
      { name: `${stem}.dbf`, buffer: buildDbfBuffer(rows, FIELDS) },
      { name: `${stem}.prj`, buffer: Buffer.from(PRJ_SIRGAS2000, "utf8") },
      { name: `${stem}.cpg`, buffer: Buffer.from("UTF-8", "utf8") },
    ],
  };
}

/** Gera os conjuntos de shapefile de uma fonte. Devolve [] se não houver feição. */
export function buildFiscalizacaoShapefiles(
  source: FiscalizacaoSource,
  records: FiscalizacaoRecord[],
): ShapefileSet[] {
  const sets: ShapefileSet[] = [];

  const polygonRecords: ShpRecord[] = [];
  const polygonRows: Array<Record<string, string | number | null>> = [];
  for (const record of records) {
    if (record.geometry.type !== "Polygon" && record.geometry.type !== "MultiPolygon") continue;
    const attrs = attributesOf(record);
    // Um MultiPolygon vira várias partes; cada parte carrega os mesmos atributos.
    for (const { rings } of geojsonToPolyRecords(record.geometry as any)) {
      polygonRecords.push({ type: "polygon", rings, attributes: attrs });
      polygonRows.push(attrs);
    }
  }
  if (polygonRecords.length) {
    const { shp, shx } = buildShpAndShx(polygonRecords, 5);
    sets.push(buildSet(`fiscalizacao_${source}_poligono`, shp, shx, polygonRows));
  }

  const pointRecords: PointShpRecord[] = [];
  const pointRows: Array<Record<string, string | number | null>> = [];
  for (const record of records) {
    if (record.geometry.type !== "Point") continue;
    const coords = record.geometry.coordinates as [number, number];
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const attrs = attributesOf(record);
    pointRecords.push({ coordinates: [coords[0], coords[1]], attributes: attrs });
    pointRows.push(attrs);
  }
  if (pointRecords.length) {
    const { shp, shx } = buildPointShpAndShx(pointRecords, 1);
    sets.push(buildSet(`fiscalizacao_${source}_ponto`, shp, shx, pointRows));
  }

  return sets;
}
