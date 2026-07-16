// Correção FINAL e mínima da Santa Clara (CAR 270069), a partir do ORIGINAL:
//  - ARL/AVN: remove os vértices repetidos (feições 66/187, ≤0,1 m) e DELETA
//    as 4 feições degeneradas (111/115/232/236: micro-triângulo e agulha).
//  - Nada mais muda (sem deslocar vértices).
// DBF: remove as linhas correspondentes por cirurgia de buffer (preserva
// atributos originais das demais).
import fs from "node:fs";
import path from "node:path";
import proj4 from "proj4";
import {
  getZipLayerGroups,
  parsePolygonRecords,
  estimateUtmProjFromLonLat,
} from "./vertices-proximas";
import { buildShpAndShx, type ShpRecord } from "./shapefile-writer";

const SRC = "backend/fixtures/teste_1/Recorte_13.07.26_CORRIGIDO_SIMCAR.zip";
const OUT = "/tmp/claude-1000/-home-acer/4ff25bb4-c907-4ce9-973d-032b2eb2f77d/scratchpad/santa_clara/final";
const DELETE_FEATURES = new Set([111, 115, 232, 236]);
const DUP_TOL_M = 0.1;

const zip = fs.readFileSync(SRC);
const groups: any[] = getZipLayerGroups(zip) as any[];
fs.mkdirSync(OUT, { recursive: true });

function dbfRemoveRows(dbf: Buffer, removeIdx: Set<number>): Buffer {
  const numRecords = dbf.readInt32LE(4);
  const headerSize = dbf.readUInt16LE(8);
  const recordSize = dbf.readUInt16LE(10);
  const kept: Buffer[] = [];
  for (let i = 0; i < numRecords; i += 1) {
    if (removeIdx.has(i)) continue;
    kept.push(dbf.subarray(headerSize + i * recordSize, headerSize + (i + 1) * recordSize));
  }
  const out = Buffer.concat([dbf.subarray(0, headerSize), ...kept, Buffer.from([0x1a])]);
  out.writeInt32LE(kept.length, 4);
  return out;
}

for (const layer of ["ARL", "AVN"]) {
  const g = groups.find((x: any) => x.name === layer);
  const records = parsePolygonRecords(g.shp.data);
  const first = records[0].rings[0][0];
  const { projDef } = estimateUtmProjFromLonLat(first[0], first[1]);
  const toM = (p: number[]) => proj4("EPSG:4326", projDef, [p[0], p[1]]) as [number, number];

  const outRecords: ShpRecord[] = [];
  const removedRows = new Set<number>();
  let dupsRemoved = 0;
  for (const rec of records) {
    if (DELETE_FEATURES.has(rec.feature)) {
      removedRows.add(rec.feature - 1); // feature é 1-based na ordem do shp
      continue;
    }
    const outRings: number[][][] = [];
    for (const ring of rec.rings) {
      const closed =
        ring.length >= 2 &&
        Math.abs(ring[0][0] - ring[ring.length - 1][0]) < 1e-12 &&
        Math.abs(ring[0][1] - ring[ring.length - 1][1]) < 1e-12;
      const open = closed ? ring.slice(0, -1) : ring.slice();
      const m = open.map(toM);
      const kept: number[][] = [];
      const keptM: Array<[number, number]> = [];
      for (let i = 0; i < open.length; i += 1) {
        const prevM = keptM.length ? keptM[keptM.length - 1] : null;
        if (prevM && Math.hypot(m[i][0] - prevM[0], m[i][1] - prevM[1]) <= DUP_TOL_M) {
          dupsRemoved += 1;
          continue;
        }
        kept.push(open[i]);
        keptM.push(m[i]);
      }
      while (
        keptM.length >= 2 &&
        Math.hypot(keptM[0][0] - keptM[keptM.length - 1][0], keptM[0][1] - keptM[keptM.length - 1][1]) <= DUP_TOL_M
      ) {
        kept.pop();
        keptM.pop();
        dupsRemoved += 1;
      }
      const outRing = kept.map((p) => [p[0], p[1]]);
      outRing.push([outRing[0][0], outRing[0][1]]);
      outRings.push(outRing);
    }
    outRecords.push({ type: "polygon", rings: outRings } as ShpRecord);
  }

  const { shp, shx } = buildShpAndShx(outRecords, 5);
  const dbf = dbfRemoveRows(g.dbf.data, removedRows);
  fs.writeFileSync(path.join(OUT, `${layer}.shp`), shp);
  fs.writeFileSync(path.join(OUT, `${layer}.shx`), shx);
  fs.writeFileSync(path.join(OUT, `${layer}.dbf`), dbf);
  console.log(
    `${layer}: ${records.length} -> ${outRecords.length} feicoes (deletadas ${removedRows.size}); ${dupsRemoved} vertice(s) repetido(s) removido(s)`,
  );
}
