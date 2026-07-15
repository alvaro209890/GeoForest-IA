import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

import {
  assertImportAllowsProcess,
  buildProcessarProjetoZip,
  IMPORT_REPROVADO_MSG,
  runImportPhase,
  runProcessPhase,
} from "./processar-projeto";
import { SIRGAS_2000_PRJ } from "./vertices-proximas";
import { buildDbfBuffer, buildShpAndShx, type ShpRecord } from "./shapefile-writer";
import { detectCrs } from "./vertices-proximas";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Fixture real (PDF SEMA: ARL com 4 bordas cruzadas + 2 pontos repetidos). */
function resolveTeste1Zip(): string | null {
  const candidates = [
    path.join(__dirname, "fixtures", "teste_1", "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip"),
    path.join("/mnt/c/Users/Usuario/Downloads/teste_1", "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip"),
    path.join("C:", "Users", "Usuario", "Downloads", "teste_1", "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const projectedCrs = detectCrs(undefined, "EPSG:31981");

function polyRecord(feature: number, rings: number[][][]): ShpRecord {
  return {
    type: "polygon",
    rings,
    attributes: { feicao: feature },
  };
}

function square(x0: number, y0: number, size: number): number[][] {
  return [
    [x0, y0],
    [x0, y0 + size],
    [x0 + size, y0 + size],
    [x0 + size, y0],
    [x0, y0],
  ];
}

async function zipFromLayers(
  layers: Array<{ name: string; records: ShpRecord[]; prj?: string; dbfAttrs?: Record<string, string | number>[]; dbfFields?: any[] }>,
): Promise<Buffer> {
  const zip = new JSZip();
  for (const layer of layers) {
    const { shp, shx } = buildShpAndShx(layer.records, 5);
    zip.file(`${layer.name}.shp`, shp);
    zip.file(`${layer.name}.shx`, shx);
    zip.file(`${layer.name}.prj`, layer.prj ?? SIRGAS_2000_PRJ);
    if (layer.dbfAttrs && layer.dbfFields) {
      zip.file(`${layer.name}.dbf`, buildDbfBuffer(layer.dbfAttrs, layer.dbfFields));
    } else {
      zip.file(
        `${layer.name}.dbf`,
        buildDbfBuffer(
          layer.records.map(() => ({ X: 0 })),
          [{ name: "X", type: "N", length: 8, decimals: 0 }],
        ),
      );
    }
  }
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer" }));
}

describe("runImportPhase", () => {
  it("flags unknown layer names as import failure", async () => {
    const zip = await zipFromLayers([
      {
        name: "CAMADA_X",
        records: [polyRecord(1, [square(-55, -12, 0.1)])],
      },
    ]);
    const result = runImportPhase(zip, "teste.zip");
    expect(result.ok).toBe(false);
    expect(result.rows.some((r) => r.tipo === "nomenclatura_desconhecida")).toBe(true);
    expect(result.relatorioTexto).toMatch(/importacao/i);
    expect(result.camadasReconhecidas[0].code).toBeNull();
  });

  it("accepts ATP+AIR with SIRGAS and required AIR fields", async () => {
    const zip = await zipFromLayers([
      {
        name: "ATP",
        records: [polyRecord(1, [square(-55, -12, 0.1)])],
      },
      {
        name: "AIR",
        records: [polyRecord(1, [square(-55, -12, 0.05)])],
        dbfAttrs: [{ TIPO: "M", IDENTIFIC: "1" }],
        dbfFields: [
          { name: "TIPO", type: "C", length: 1, decimals: 0 },
          { name: "IDENTIFIC", type: "C", length: 40, decimals: 0 },
        ],
      },
    ]);
    const result = runImportPhase(zip);
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(0);
    expect(result.camadasReconhecidas.map((c) => c.code).sort()).toEqual(["AIR", "ATP"]);
  });

  it("reprova importação quando há borda se cruza / pontos repetidos (topologia SIMCAR)", async () => {
    // Bowtie = auto-interseção; ring com vértice duplicado consecutivo.
    const bowtie = polyRecord(1, [
      [
        [0, 0],
        [2, 2],
        [2, 0],
        [0, 2],
        [0, 0],
      ],
    ]);
    const withDup = polyRecord(2, [
      [
        [10, 10],
        [10, 14],
        [10, 14], // ponto repetido
        [14, 14],
        [14, 10],
        [10, 10],
      ],
    ]);
    const zip = await zipFromLayers([
      { name: "ATP", records: [polyRecord(1, [square(-55, -12, 0.1)])] },
      {
        name: "AIR",
        records: [polyRecord(1, [square(-55, -12, 0.05)])],
        dbfAttrs: [{ TIPO: "M", IDENTIFIC: "1" }],
        dbfFields: [
          { name: "TIPO", type: "C", length: 1, decimals: 0 },
          { name: "IDENTIFIC", type: "C", length: 40, decimals: 0 },
        ],
      },
      { name: "ARL", records: [bowtie, withDup] },
    ]);
    const result = runImportPhase(zip, "arl_sujo.zip");
    expect(result.ok).toBe(false);
    expect(result.rows.some((r) => r.tipo === "borda_se_cruza")).toBe(true);
    expect(result.rows.some((r) => r.tipo === "vertice_duplicado")).toBe(true);
    expect(result.relatorioTexto).toMatch(/Reprovado/i);
    expect(() => assertImportAllowsProcess(result)).toThrow(/Reprovado/i);
  });
});

describe("assertImportAllowsProcess", () => {
  it("bloqueia processar quando importação falhou", () => {
    expect(() => assertImportAllowsProcess({ ok: false, status: "import_failed", rows: [] })).toThrow(
      IMPORT_REPROVADO_MSG,
    );
    expect(() => assertImportAllowsProcess(null)).toThrow(/importação/i);
  });

  it("libera processar quando importação OK", () => {
    expect(() => assertImportAllowsProcess({ ok: true, status: "import_ok", rows: [] })).not.toThrow();
  });
});

describe("paridade SIMCAR — fixture teste_1 (PDF SEMA importação)", () => {
  const zipPath = resolveTeste1Zip();
  const hasFixture = Boolean(zipPath);

  it.skipIf(!hasFixture)(
    "reprova o ZIP real com borda se cruza e pontos repetidos no ARL (oráculo PDF)",
    () => {
      const buf = fs.readFileSync(zipPath!);
      const result = runImportPhase(buf, "Recorte_13.07.26_CORRIGIDO_SIMCAR.zip");

      // Critério 1: importação reprovada
      expect(result.ok).toBe(false);
      expect(result.relatorioTexto).toMatch(/Reprovado/i);

      const arlRows = result.rows.filter((r) => {
        const name = String(r.camada || "").toUpperCase();
        return name === "ARL" || name.includes("ARL") || name.endsWith("_ARL");
      });
      const borda = arlRows.filter((r) => r.tipo === "borda_se_cruza");
      const pontos = arlRows.filter((r) => r.tipo === "vertice_duplicado");

      // Critério 2: tipos do PDF no ARL (oráculo: 4 bordas, 2 pontos repetidos)
      // Tolerância: ≥1 de cada tipo; contagens exatas documentadas no expect quando possível.
      expect(borda.length).toBeGreaterThanOrEqual(1);
      expect(pontos.length).toBeGreaterThanOrEqual(1);

      // Preferência de paridade com o PDF (4 e 2). Se o detector contar por ponto
      // e o SEMA por feição, o teste ainda passa no ≥1, e contagens ficam no log.
      // Ajuste de sensibilidade: buscar 4 e 2 quando o detector estiver alinhado.
      expect(borda.length).toBeGreaterThanOrEqual(4);
      expect(pontos.length).toBeGreaterThanOrEqual(2);

      // Critério 3: processar bloqueado
      expect(() => assertImportAllowsProcess(result)).toThrow(IMPORT_REPROVADO_MSG);
    },
  );

  it.skipIf(!hasFixture)("fixture path is resolvable for CI/local", () => {
    expect(zipPath).toBeTruthy();
    expect(fs.statSync(zipPath!).size).toBeGreaterThan(1000);
  });
});

describe("runProcessPhase", () => {
  it("detects gap between two AIR polygons and air_atp area mismatch", async () => {
    // Metric-like rings in projected-looking coords; use SIRGAS prj so CRS is geographic
    // but area checks still run (UTM estimated from lon/lat). Use projected prj text for clean m².
    const UTM_PRJ =
      'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["Meter",1]]';

    // ATP 100×100; AIRs leave a gap and sum to half ATP
    const atp = polyRecord(1, [square(0, 0, 100)]);
    const airLeft = polyRecord(1, [square(0, 0, 40)]); // 40x40 but we'll use rectangles
    // Use explicit rectangles matching geometry-errors tests
    const airA: ShpRecord = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [0, 50],
          [80, 50],
          [80, 0],
          [0, 0],
        ],
      ],
      attributes: {},
    };
    const airB: ShpRecord = {
      type: "polygon",
      rings: [
        [
          [80, 0],
          [80, 50],
          [100, 50],
          [100, 0],
          [80, 0],
        ],
      ],
      attributes: {},
    };
    // Gap layer: two polygons with 2m gap
    const left: ShpRecord = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [0, 10],
          [4, 10],
          [4, 0],
          [0, 0],
        ],
      ],
      attributes: {},
    };
    const right: ShpRecord = {
      type: "polygon",
      rings: [
        [
          [6, 0],
          [6, 10],
          [10, 10],
          [10, 0],
          [6, 0],
        ],
      ],
      attributes: {},
    };

    void airLeft;
    void atp;
    void projectedCrs;

    const zip = await zipFromLayers([
      { name: "ATP", records: [polyRecord(1, [square(0, 0, 100)]),], prj: UTM_PRJ },
      {
        name: "AIR",
        records: [airA, airB],
        prj: UTM_PRJ,
        dbfAttrs: [
          { TIPO: "M", IDENTIFIC: "A" },
          { TIPO: "M", IDENTIFIC: "B" },
        ],
        dbfFields: [
          { name: "TIPO", type: "C", length: 1, decimals: 0 },
          { name: "IDENTIFIC", type: "C", length: 40, decimals: 0 },
        ],
      },
      { name: "AVN", records: [left, right], prj: UTM_PRJ },
    ]);

    const result = runProcessPhase(zip, { minOverlapM2: 1, generateFixed: false });
    expect(result.rows.some((r) => r.tipo === "air_atp_area")).toBe(true);
    expect(result.rows.some((r) => r.tipo === "vazio")).toBe(true);
    expect(result.relatorioTexto).toMatch(/processamento/i);
    expect(result.gapPolygons.length).toBeGreaterThanOrEqual(1);
  });

  it("reports forbidden AVN × AUAS overlap", async () => {
    const UTM_PRJ =
      'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["D_SIRGAS_2000",SPHEROID["GRS_1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.017453292519943295]],PROJECTION["Transverse_Mercator"],PARAMETER["latitude_of_origin",0],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["Meter",1]]';

    const avn: ShpRecord = {
      type: "polygon",
      rings: [
        [
          [0, 0],
          [0, 100],
          [100, 100],
          [100, 0],
          [0, 0],
        ],
      ],
      attributes: {},
    };
    const auas: ShpRecord = {
      type: "polygon",
      rings: [
        [
          [90, 40],
          [90, 50],
          [110, 50],
          [110, 40],
          [90, 40],
        ],
      ],
      attributes: {},
    };
    const zip = await zipFromLayers([
      { name: "AVN", records: [avn], prj: UTM_PRJ },
      { name: "AUAS", records: [auas], prj: UTM_PRJ },
    ]);
    const result = runProcessPhase(zip, { minOverlapM2: 1, generateFixed: false });
    expect(result.rows.some((r) => r.tipo === "sobreposicao_proibida")).toBe(true);
    expect(result.ruleViolations.length).toBeGreaterThanOrEqual(1);
  });

  it("always builds arquivo processado layers and nested ZIPs", async () => {
    const zip = await zipFromLayers([
      {
        name: "ATP",
        records: [polyRecord(1, [square(0, 0, 100)])],
      },
      {
        name: "AIR",
        records: [polyRecord(1, [square(0, 0, 50)])],
        dbfAttrs: [{ TIPO: "M", IDENTIFIC: "1" }],
        dbfFields: [
          { name: "TIPO", type: "C", length: 1, decimals: 0 },
          { name: "IDENTIFIC", type: "C", length: 40, decimals: 0 },
        ],
      },
    ]);
    const process = runProcessPhase(zip, { minOverlapM2: 1 });
    expect(process.processedLayers.length).toBeGreaterThanOrEqual(2);
    expect(process.originalLayers.length).toBeGreaterThanOrEqual(2);
    expect(process.quadroAreas.length).toBeGreaterThanOrEqual(2);

    const importPhase = runImportPhase(zip);
    const outZip = await buildProcessarProjetoZip({
      importRelatorio: importPhase.relatorioTexto,
      process,
      importRows: importPhase.rows,
    });
    const jszip = await JSZip.loadAsync(outZip);
    const names = Object.keys(jszip.files);
    expect(names).toContain("arquivo_processado.zip");
    expect(names).toContain("arquivo_enviado.zip");
    expect(names).toContain("arquivo_conferencia.zip");
    expect(names).toContain("erros_processamento.zip");
    expect(names).toContain("quadro_areas.csv");
    expect(names).toContain("inventario_saidas.txt");
    expect(names.some((n) => n.startsWith("arquivo_processado/") && n.endsWith(".shp"))).toBe(true);
  });
});
