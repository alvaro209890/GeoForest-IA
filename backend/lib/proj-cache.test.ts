import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "../proj-defs";
import proj4 from "proj4";
import { clearProjConverterCache, getProjConverter, projectPoint } from "./proj-cache";
import { detectCrs, getZipLayerGroups, parsePolygonRecords } from "../vertices-proximas";
import { metricProjForCrs } from "../geometry/utils";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "..", "fixtures", "teste_1", "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip");

describe("proj-cache", () => {
  it("reaproveita o mesmo conversor por par de CRS", () => {
    clearProjConverterCache();
    const a = getProjConverter("EPSG:4674", "+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs");
    const b = getProjConverter("EPSG:4674", "+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs");
    const c = getProjConverter("EPSG:4326", "+proj=utm +zone=22 +south +datum=WGS84 +units=m +no_defs");
    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  // Prova com dado real (lição do projeto: teste sintético não valida geometria):
  // todo vértice de toda camada do CAR 270069 tem que sair BIT A BIT igual à
  // chamada original `proj4(from, to, ponto)`, ida e volta.
  it.skipIf(!fs.existsSync(FIXTURE))(
    "dá coordenadas idênticas ao proj4 sem cache em todos os vértices do fixture real",
    () => {
      const groups = getZipLayerGroups(fs.readFileSync(FIXTURE)).filter((g) => g.shp);
      let vertices = 0;
      let mismatches = 0;
      for (const g of groups) {
        const crs = detectCrs(g.prj?.data.toString("utf8"));
        if (crs.kind !== "geographic") continue;
        const records = parsePolygonRecords(g.shp!.data);
        if (!records.length) continue;
        const src = crs.projDef || "EPSG:4326";
        const metric = metricProjForCrs(crs, records);
        for (const rec of records) {
          for (const ring of rec.rings) {
            for (const pt of ring) {
              const ref = proj4(src, metric, [pt[0], pt[1]]) as [number, number];
              const got = projectPoint(src, metric, pt);
              const refBack = proj4(metric, src, ref) as [number, number];
              const gotBack = getProjConverter(src, metric).inverse([got[0], got[1]]) as [number, number];
              vertices += 1;
              if (
                !Object.is(ref[0], got[0]) ||
                !Object.is(ref[1], got[1]) ||
                !Object.is(refBack[0], gotBack[0]) ||
                !Object.is(refBack[1], gotBack[1])
              ) {
                mismatches += 1;
              }
            }
          }
        }
      }
      expect(vertices).toBeGreaterThan(1000);
      expect(mismatches).toBe(0);
    },
    60_000,
  );
});
