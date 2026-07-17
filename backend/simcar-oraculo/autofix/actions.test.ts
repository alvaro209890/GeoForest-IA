import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import {
  detectComplexPolygons,
  detectDuplicateVertices,
  detectOverlappingRings,
  detectSelfIntersections,
} from "../../geometry-errors";
import {
  buildDbfBuffer,
  buildShpAndShx,
  readDbfRows,
  type DbfFieldDef,
  type ShpRecord,
} from "../../shapefile-writer";
import {
  detectCrs,
  parsePolygonRecords,
  type ParsedPolygonRecord,
} from "../../vertices-proximas";
import { applyImportFixActions } from "./apply";
import type { FixAction } from "./types";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const UTM_PRJ =
  'PROJCS["SIRGAS 2000 / UTM zone 21S",GEOGCS["SIRGAS 2000",DATUM["Sistema_de_Referencia_Geocentrico_para_las_AmericaS_2000",SPHEROID["GRS 1980",6378137,298.257222101]],PRIMEM["Greenwich",0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["central_meridian",-57],PARAMETER["scale_factor",0.9996],PARAMETER["false_easting",500000],PARAMETER["false_northing",10000000],UNIT["metre",1]]';
const CPG = Buffer.from("ISO-8859-1\r\n", "ascii");
const TARGET = "ARL";

const defaultSchema: DbfFieldDef[] = [
  { name: "ID", type: "N", length: 10, decimals: 0 },
  { name: "IDENTIFIC", type: "N", length: 10, decimals: 0 },
  { name: "NOME", type: "C", length: 30, decimals: 0 },
];

function cwRect(
  x: number,
  y: number,
  width: number,
  height = width
): number[][] {
  return [
    [x, y],
    [x, y + height],
    [x + width, y + height],
    [x + width, y],
    [x, y],
  ];
}

function ccwRect(
  x: number,
  y: number,
  width: number,
  height = width
): number[][] {
  return [...cwRect(x, y, width, height)].reverse();
}

function polygon(rings: number[][][]): ShpRecord {
  return { type: "polygon", rings, attributes: {} };
}

function action(type: FixAction["type"], layers = [TARGET]): FixAction {
  return { type, layers, motivo: "teste sintético" };
}

async function buildFixtureZip(
  records: ShpRecord[],
  rows = records.map((_record, index) => ({
    ID: index + 1,
    IDENTIFIC: index + 10,
    NOME: `Feição ${index + 1}`,
  })),
  schema = defaultSchema
): Promise<Buffer> {
  const zip = new JSZip();
  const target = buildShpAndShx(records, 5);
  zip.file(`${TARGET}.shp`, target.shp);
  zip.file(`${TARGET}.shx`, target.shx);
  zip.file(`${TARGET}.dbf`, buildDbfBuffer(rows, schema));
  zip.file(`${TARGET}.prj`, Buffer.from(UTM_PRJ, "utf8"));
  zip.file(`${TARGET}.cpg`, CPG);
  zip.file(`${TARGET}.sbn`, Buffer.from([1, 2, 3, 4]));
  zip.file(`${TARGET}.sbx`, Buffer.from([5, 6, 7, 8]));
  zip.file(
    `${TARGET}.shp.xml`,
    Buffer.from("<metadata>stale</metadata>", "utf8")
  );

  const untouchedRecords = [polygon([cwRect(501000, 8_701_000, 50)])];
  const untouched = buildShpAndShx(untouchedRecords, 5);
  zip.file("dados/AVN.shp", untouched.shp);
  zip.file("dados/AVN.shx", untouched.shx);
  zip.file(
    "dados/AVN.dbf",
    buildDbfBuffer(
      [{ ID: 99 }],
      [{ name: "ID", type: "N", length: 10, decimals: 0 }]
    )
  );
  zip.file("dados/AVN.prj", Buffer.from(UTM_PRJ, "utf8"));
  zip.file("dados/AVN.cpg", CPG);
  zip.file(
    "LEIA-ME.txt",
    Buffer.from("payload intocado com acentuação: ação", "utf8")
  );
  return Buffer.from(
    await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })
  );
}

async function payloads(zipBuffer: Buffer): Promise<Map<string, Buffer>> {
  const zip = await JSZip.loadAsync(zipBuffer, { checkCRC32: true });
  const map = new Map<string, Buffer>();
  await Promise.all(
    Object.values(zip.files)
      .filter(entry => !entry.dir)
      .map(async entry =>
        map.set(entry.name, Buffer.from(await entry.async("nodebuffer")))
      )
  );
  return map;
}

async function readTarget(zipBuffer: Buffer): Promise<{
  records: ParsedPolygonRecord[];
  rows: Array<Record<string, string>>;
  payloads: Map<string, Buffer>;
}> {
  const entries = await payloads(zipBuffer);
  return {
    records: parsePolygonRecords(entries.get(`${TARGET}.shp`)!),
    rows: readDbfRows(entries.get(`${TARGET}.dbf`)!),
    payloads: entries,
  };
}

async function expectUntouchedPayloadsPreserved(
  beforeZip: Buffer,
  afterZip: Buffer
): Promise<void> {
  const before = await payloads(beforeZip);
  const after = await payloads(afterZip);
  for (const name of [
    `${TARGET}.prj`,
    `${TARGET}.cpg`,
    "dados/AVN.shp",
    "dados/AVN.shx",
    "dados/AVN.dbf",
    "dados/AVN.prj",
    "dados/AVN.cpg",
    "LEIA-ME.txt",
  ]) {
    expect(after.get(name), `${name} deve permanecer byte a byte`).toEqual(
      before.get(name)
    );
  }
  expect(after.has(`${TARGET}.sbn`)).toBe(false);
  expect(after.has(`${TARGET}.sbx`)).toBe(false);
  expect(after.has(`${TARGET}.shp.xml`)).toBe(false);
}

const projectedCrs = detectCrs(UTM_PRJ);

describe("autofix de importação — ações mecânicas", () => {
  it("remove somente vértices consecutivos a até 0,1 m e mantém DBF/sidecars", async () => {
    const dirty = polygon([
      [
        [500000, 8_700_000],
        [500000, 8_700_020],
        [500000.05, 8_700_020],
        [500020, 8_700_020],
        [500020, 8_700_000],
        [500000, 8_700_000],
      ],
    ]);
    const input = await buildFixtureZip(
      [dirty],
      [{ ID: 1, IDENTIFIC: 10, NOME: "Árvore" }]
    );
    const before = await readTarget(input);
    expect(detectDuplicateVertices(TARGET, before.records)).toHaveLength(1);

    const result = await applyImportFixActions(input, [
      action("remove_duplicate_vertices"),
    ]);
    const after = await readTarget(result.novoZip);

    expect(detectDuplicateVertices(TARGET, after.records)).toHaveLength(0);
    expect(after.records).toHaveLength(1);
    expect(after.rows).toEqual(before.rows);
    expect(after.payloads.get(`${TARGET}.dbf`)).toEqual(
      before.payloads.get(`${TARGET}.dbf`)
    );
    expect(result.diffResumo[0]).toMatchObject({
      alterou: true,
      feicoesAfetadas: [1],
      verticesRemovidos: 1,
      registrosAntes: 1,
      registrosDepois: 1,
    });
    await expectUntouchedPayloadsPreserved(input, result.novoZip);
  });

  it("remove anel com área ≤0,01 m² ou largura ≤0,02 m sem apagar a casca válida", async () => {
    const input = await buildFixtureZip([
      polygon([
        cwRect(500000, 8_700_000, 20),
        ccwRect(500005, 8_700_005, 0.01, 1),
      ]),
    ]);
    const before = await readTarget(input);
    expect(
      detectSelfIntersections(TARGET, before.records).some(
        row => row.tipo === "borda_se_cruza"
      )
    ).toBe(true);

    const result = await applyImportFixActions(input, [
      action("clean_degenerate_rings"),
    ]);
    const after = await readTarget(result.novoZip);

    expect(after.records).toHaveLength(1);
    expect(after.records[0].rings).toHaveLength(1);
    expect(
      detectSelfIntersections(TARGET, after.records).some(
        row => row.tipo === "borda_se_cruza"
      )
    ).toBe(false);
    expect(result.diffResumo[0]).toMatchObject({
      aneisRemovidos: 1,
      registrosRemovidos: 0,
    });
    expect(after.payloads.get(`${TARGET}.dbf`)).toEqual(
      before.payloads.get(`${TARGET}.dbf`)
    );
    await expectUntouchedPayloadsPreserved(input, result.novoZip);
  });

  it("divide auto-interseção real, preserva atributos e cria IDs para partes extras", async () => {
    const bowtie = polygon([
      [
        [500000, 8_700_000],
        [500020, 8_700_020],
        [500020, 8_700_000],
        [500000, 8_700_020],
        [500000, 8_700_000],
      ],
    ]);
    const input = await buildFixtureZip(
      [bowtie],
      [{ ID: 7, IDENTIFIC: 50, NOME: "Talhão" }]
    );
    const before = await readTarget(input);
    expect(
      detectSelfIntersections(TARGET, before.records, {
        selfIntersectionSnapM: 0,
      })
    ).not.toHaveLength(0);

    const result = await applyImportFixActions(input, [
      action("unkink_self_intersection"),
    ]);
    const after = await readTarget(result.novoZip);

    expect(after.records.length).toBeGreaterThan(1);
    expect(
      detectSelfIntersections(TARGET, after.records, {
        selfIntersectionSnapM: 0,
      })
    ).toHaveLength(0);
    expect(new Set(after.rows.map(row => row.ID)).size).toBe(after.rows.length);
    expect(new Set(after.rows.map(row => row.IDENTIFIC)).size).toBe(
      after.rows.length
    );
    expect(after.rows.every(row => row.NOME === "Talhão")).toBe(true);
    expect(result.diffResumo[0].identificadoresCriados).toBe(
      after.records.length - 1
    );
    await expectUntouchedPayloadsPreserved(input, result.novoZip);
  });

  it("remove buraco colado por ≥1 m, mas preserva buraco interno e encoste pontual", async () => {
    const legitimate = ccwRect(500002, 8_700_002, 3);
    const glued = ccwRect(500018, 8_700_005, 2, 5);
    const pointTouch = [
      [500019, 8_700_019],
      [500019.2, 8_700_019],
      [500020, 8_700_020],
      [500019, 8_700_019],
    ];
    const input = await buildFixtureZip([
      polygon([cwRect(500000, 8_700_000, 20), legitimate, glued, pointTouch]),
    ]);
    const before = await readTarget(input);
    expect(
      detectOverlappingRings(TARGET, before.records, projectedCrs)
    ).toHaveLength(1);

    const result = await applyImportFixActions(input, [
      action("remove_glued_holes"),
    ]);
    const after = await readTarget(result.novoZip);

    expect(after.records[0].rings).toHaveLength(3);
    expect(after.records[0].rings).toContainEqual(legitimate);
    expect(after.records[0].rings).toContainEqual(pointTouch);
    expect(
      detectOverlappingRings(TARGET, after.records, projectedCrs)
    ).toHaveLength(0);
    expect(result.diffResumo[0]).toMatchObject({
      aneisRemovidos: 1,
      feicoesAfetadas: [1],
    });
    expect(after.payloads.get(`${TARGET}.dbf`)).toEqual(
      before.payloads.get(`${TARGET}.dbf`)
    );
    await expectUntouchedPayloadsPreserved(input, result.novoZip);
  });

  it("separa polígono complexo, associa seus buracos e não duplica linha DBF", async () => {
    const input = await buildFixtureZip(
      [
        polygon([
          cwRect(500000, 8_700_000, 20),
          ccwRect(500002, 8_700_002, 2),
          cwRect(500100, 8_700_100, 20),
          ccwRect(500102, 8_700_102, 2),
        ]),
      ],
      [{ ID: 7, IDENTIFIC: 50, NOME: "Reserva" }]
    );
    const before = await readTarget(input);
    expect(detectComplexPolygons(TARGET, before.records)).toHaveLength(1);

    const result = await applyImportFixActions(input, [
      action("split_complex_polygon"),
    ]);
    const after = await readTarget(result.novoZip);

    expect(after.records).toHaveLength(2);
    expect(after.records.every(record => record.rings.length === 2)).toBe(true);
    expect(detectComplexPolygons(TARGET, after.records)).toHaveLength(0);
    expect(after.rows.map(row => row.ID)).toEqual(["7", "8"]);
    expect(after.rows.map(row => row.IDENTIFIC)).toEqual(["50", "51"]);
    expect(after.rows.map(row => row.NOME)).toEqual(["Reserva", "Reserva"]);
    expect(result.diffResumo[0]).toMatchObject({
      registrosCriados: 1,
      identificadoresCriados: 1,
    });
    await expectUntouchedPayloadsPreserved(input, result.novoZip);
  });

  it("encadeia ações usando o ZIP produzido pela etapa anterior", async () => {
    const input = await buildFixtureZip([
      polygon([
        [
          [500000, 8_700_000],
          [500000, 8_700_020],
          [500000.05, 8_700_020],
          [500020, 8_700_020],
          [500020, 8_700_000],
          [500000, 8_700_000],
        ],
        [
          [500005, 8_700_005],
          [500005.2, 8_700_005],
          [500005.1, 8_700_005.05],
          [500005, 8_700_005],
        ],
      ]),
    ]);

    const result = await applyImportFixActions(input, [
      action("remove_duplicate_vertices"),
      action("clean_degenerate_rings"),
    ]);
    const after = await readTarget(result.novoZip);

    expect(result.diffResumo.map(diff => diff.alterou)).toEqual([true, true]);
    expect(detectDuplicateVertices(TARGET, after.records)).toHaveLength(0);
    expect(
      detectSelfIntersections(TARGET, after.records).some(
        row => row.tipo === "borda_se_cruza"
      )
    ).toBe(false);
    expect(after.records[0].rings).toHaveLength(1);
  });

  it("não altera o ZIP quando a ação não encontra defeito", async () => {
    const input = await buildFixtureZip([
      polygon([cwRect(500000, 8_700_000, 20)]),
    ]);
    const result = await applyImportFixActions(input, [
      action("remove_duplicate_vertices"),
    ]);

    expect(result.diffResumo[0].alterou).toBe(false);
    expect(result.novoZip.equals(input)).toBe(true);
  });

  it("não trata encoste pontual como cruzamento a ser reescrito", async () => {
    const pointContact = polygon([
      [
        [500000, 8_700_000],
        [500000, 8_700_020],
        [500010, 8_700_010],
        [500020, 8_700_020],
        [500020, 8_700_000],
        [500010, 8_700_010],
        [500000, 8_700_000],
      ],
    ]);
    const input = await buildFixtureZip([pointContact]);
    const result = await applyImportFixActions(input, [
      action("unkink_self_intersection"),
    ]);

    expect(result.diffResumo[0].alterou).toBe(false);
    expect(result.novoZip.equals(input)).toBe(true);
  });

  it("não contém qualquer implementação por buffer nas ações mecânicas", () => {
    const actionsDirectory = path.join(dirname, "actions");
    const source = fs
      .readdirSync(actionsDirectory)
      .filter(name => name.endsWith(".ts"))
      .map(name => fs.readFileSync(path.join(actionsDirectory, name), "utf8"))
      .join("\n");

    expect(source).not.toMatch(/@turf\/buffer|turfBuffer|buffer\s+as\s+turf/i);
  });
});
