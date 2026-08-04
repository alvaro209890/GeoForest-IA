/**
 * Definições dos shapefiles de saída e montagem do ZIP de resultado.
 */
import archiver from "archiver";
import type { GeometryErrorRow } from "../geometry-errors";
import { LAYER_LEVEL_TIPOS, geometryPlanarAreaM2, metricProjDefFor, recordToGeoJSON } from "../geometry-errors";
import type { Polygon } from "geojson";
import { recognizeSimcarLayer } from "../simcar-rules";
import type { DbfFieldDef, PointShpRecord, ShpRecord } from "../shapefile-writer";
import { buildDbfBuffer, buildPointShpAndShx, buildShpAndShx, geojsonToShpRecords } from "../shapefile-writer";
import { SIRGAS_2000_PRJ, detectCrs, parsePolygonRecords } from "../vertices-proximas";
import { ProcessPhaseResult } from "./types";
import { appendPointSet, buildCsv, buildNestedZip, buildQuadroCsv, layerShpFiles, safeSegment } from "./utils";

export const errorPointFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "tipo", type: "C", length: 24, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "parte", type: "N", length: 8, decimals: 0 },
  { name: "anel", type: "N", length: 8, decimals: 0 },
  { name: "x", type: "F", length: 18, decimals: 8 },
  { name: "y", type: "F", length: 18, decimals: 8 },
  { name: "detalhe", type: "C", length: 120, decimals: 0 },
];

export const overlapFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "feicao_b", type: "N", length: 8, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

export const ruleViolationFields: DbfFieldDef[] = [
  { name: "camada_a", type: "C", length: 40, decimals: 0 },
  { name: "feicao_a", type: "N", length: 8, decimals: 0 },
  { name: "camada_b", type: "C", length: 40, decimals: 0 },
  { name: "regra", type: "C", length: 12, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];

export const fixedLayerFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

export const processadoFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
];

export const conferenciaFields: DbfFieldDef[] = [
  { name: "camada", type: "C", length: 40, decimals: 0 },
  { name: "feicao", type: "N", length: 8, decimals: 0 },
  { name: "corrigido", type: "C", length: 1, decimals: 0 },
  { name: "area_m2", type: "F", length: 18, decimals: 2 },
  { name: "area_ha", type: "F", length: 18, decimals: 6 },
];


/**
 * ZIP completo no espírito SIMCAR:
 * - arquivo_enviado (+ .zip)
 * - arquivo_processado (+ .zip)
 * - arquivo_conferencia (+ .zip)
 * - erros / erros_processamento.zip
 * - relatórios e quadro de áreas
 */
export async function buildProcessarProjetoZip(args: {
  importRelatorio: string;
  process: ProcessPhaseResult;
  importRows?: GeometryErrorRow[];
}): Promise<Buffer> {
  const allRows = [...(args.importRows || []), ...args.process.rows];
  const prj = args.process.prjText || SIRGAS_2000_PRJ;
  const proc = args.process;

  const pointRecords: PointShpRecord[] = proc.rows
    .filter((row) => !LAYER_LEVEL_TIPOS.has(row.tipo))
    .map((row) => ({
      coordinates: [row.x, row.y] as [number, number],
      attributes: {
        camada: row.camada,
        tipo: row.tipo,
        feicao: row.feicao,
        parte: row.parte,
        anel: row.anel,
        x: row.x,
        y: row.y,
        detalhe: row.detalhe,
      },
    }));

  // Nested: arquivo_processado.zip
  const processadoFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.processedLayers) {
    processadoFiles.push(...layerShpFiles(layer.name, layer.records, processadoFields, prj));
  }
  const processadoZip = await buildNestedZip(processadoFiles);

  // Nested: arquivo_conferencia.zip (mesmas geometrias + áreas em UTM planar,
  // método de área da SEMA)
  const conferenciaCrs = detectCrs(prj);
  const conferenciaFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.processedLayers) {
    const layerProjDef = metricProjDefFor(
      conferenciaCrs,
      layer.records.map((rec, index) => ({ feature: index + 1, rings: rec.rings || [] })) as any,
    );
    const withArea: ShpRecord[] = layer.records.map((rec, index) => {
      const geometry = recordToGeoJSON({ feature: index + 1, rings: rec.rings || [] } as any);
      const areaM2 = geometry ? geometryPlanarAreaM2(geometry, conferenciaCrs, layerProjDef) : 0;
      return {
        ...rec,
        attributes: {
          ...rec.attributes,
          area_m2: Number(areaM2.toFixed(2)),
          area_ha: Number((areaM2 / 10000).toFixed(6)),
        },
      };
    });
    conferenciaFiles.push(...layerShpFiles(layer.name, withArea, conferenciaFields, prj));
  }
  const conferenciaZip = await buildNestedZip(conferenciaFiles);

  // Nested: arquivo_enviado.zip (originais)
  const enviadoFiles: Array<{ name: string; data: Buffer }> = [];
  for (const layer of proc.originalLayers) {
    const safe = safeSegment(layer.name) || "camada";
    // Reconstrói shx a partir do shp parseado
    const records = parsePolygonRecords(layer.shp);
    const shpRecords: ShpRecord[] = records.map((r) => ({
      type: "polygon" as const,
      rings: r.rings,
      attributes: { feicao: r.feature },
    }));
    if (shpRecords.length) {
      const built = buildShpAndShx(shpRecords, 5);
      enviadoFiles.push({ name: `${safe}.shp`, data: layer.shp });
      enviadoFiles.push({ name: `${safe}.shx`, data: built.shx });
    } else {
      enviadoFiles.push({ name: `${safe}.shp`, data: layer.shp });
    }
    if (layer.dbf) enviadoFiles.push({ name: `${safe}.dbf`, data: layer.dbf });
    else {
      enviadoFiles.push({
        name: `${safe}.dbf`,
        data: buildDbfBuffer(
          records.map((r) => ({ feicao: r.feature })),
          [{ name: "feicao", type: "N", length: 8, decimals: 0 }],
        ),
      });
    }
    enviadoFiles.push({ name: `${safe}.prj`, data: Buffer.from(layer.prjText || prj, "utf8") });
  }
  const enviadoZip = await buildNestedZip(enviadoFiles);

  // Nested: erros_processamento.zip — SÓ o artefato oficial da SEMA
  // (ERROS_DE_SOBREPOSICAO: pontos com ID + DETALHES "A com B" em nomes de
  // código, UM por PAR de feições — mesmo schema do download oficial).
  const errosFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const centroidOf = (geometry: { type: string; coordinates: any }): [number, number] => {
      const ring: number[][] =
        geometry.type === "Polygon" ? geometry.coordinates[0] : geometry.coordinates[0]?.[0] || [];
      let sx = 0;
      let sy = 0;
      for (const p of ring) {
        sx += Number(p[0]) || 0;
        sy += Number(p[1]) || 0;
      }
      const n = Math.max(1, ring.length);
      return [sx / n, sy / n];
    };
    const codeOf = (name: string) => recognizeSimcarLayer(name) || name;
    const sobreposicaoPoints: PointShpRecord[] = proc.overlapPairs.map((pair, index) => ({
      coordinates: centroidOf(pair.geometry as any),
      attributes: { ID: index + 1, DETALHES: `${codeOf(pair.camadaA)} com ${codeOf(pair.camadaB)}` },
    }));
    if (sobreposicaoPoints.length) {
      const built = buildPointShpAndShx(sobreposicaoPoints, 1);
      errosFiles.push({ name: "ERROS_DE_SOBREPOSICAO.shp", data: built.shp });
      errosFiles.push({ name: "ERROS_DE_SOBREPOSICAO.shx", data: built.shx });
      errosFiles.push({
        name: "ERROS_DE_SOBREPOSICAO.dbf",
        data: buildDbfBuffer(sobreposicaoPoints.map((p) => p.attributes), [
          { name: "ID", type: "N", length: 18, decimals: 0 },
          { name: "DETALHES", type: "C", length: 254, decimals: 0 },
        ]),
      });
      errosFiles.push({ name: "ERROS_DE_SOBREPOSICAO.prj", data: Buffer.from(prj, "utf8") });
    }
  }
  const errosZip = await buildNestedZip(errosFiles);

  // Nested: erros_diagnostico.zip — diagnósticos EXTRAS do GeoForest (não
  // existem no download da SEMA; úteis no SIG).
  const diagFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const points = buildPointShpAndShx(pointRecords, 1);
    diagFiles.push({ name: "pontos_erros.shp", data: points.shp });
    diagFiles.push({ name: "pontos_erros.shx", data: points.shx });
    diagFiles.push({
      name: "pontos_erros.dbf",
      data: buildDbfBuffer(pointRecords.map((p) => p.attributes), errorPointFields),
    });
    diagFiles.push({ name: "pontos_erros.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.overlapPolygons.length) {
    const records: ShpRecord[] = proc.overlapPolygons.flatMap((o) =>
      geojsonToShpRecords(o.geometry, {
        camada: o.camada,
        feicao_a: o.feicaoA,
        feicao_b: o.feicaoB,
        area_m2: o.areaM2,
        area_ha: o.areaM2 / 10000,
      }),
    );
    const built = buildShpAndShx(records, 5);
    diagFiles.push({ name: "poligonos_sobreposicao.shp", data: built.shp });
    diagFiles.push({ name: "poligonos_sobreposicao.shx", data: built.shx });
    diagFiles.push({
      name: "poligonos_sobreposicao.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), overlapFields),
    });
    diagFiles.push({ name: "poligonos_sobreposicao.prj", data: Buffer.from(prj, "utf8") });
  }
  if (proc.ruleViolations.length) {
    const records: ShpRecord[] = proc.ruleViolations.flatMap((v) =>
      geojsonToShpRecords(v.geometry, {
        camada_a: v.camadaA,
        feicao_a: v.feicaoA,
        camada_b: v.camadaB,
        regra: v.regra,
        area_m2: v.areaM2,
        area_ha: v.areaM2 / 10000,
      }),
    );
    const built = buildShpAndShx(records, 5);
    diagFiles.push({ name: "poligonos_regras_simcar.shp", data: built.shp });
    diagFiles.push({ name: "poligonos_regras_simcar.shx", data: built.shx });
    diagFiles.push({
      name: "poligonos_regras_simcar.dbf",
      data: buildDbfBuffer(records.map((r) => r.attributes), ruleViolationFields),
    });
    diagFiles.push({ name: "poligonos_regras_simcar.prj", data: Buffer.from(prj, "utf8") });
  }
  const diagZip = await buildNestedZip(diagFiles);

  // erros_processamento_app.zip — pontos de erro de cálculo de APP (artefato SIMCAR)
  const appErrorPoints = pointRecords.filter((p) => String(p.attributes.tipo) === "erro_calculo_app");
  const appErrosFiles: Array<{ name: string; data: Buffer }> = [];
  {
    const pts = buildPointShpAndShx(appErrorPoints, 1);
    appErrosFiles.push({ name: "pontos_erro_app.shp", data: pts.shp });
    appErrosFiles.push({ name: "pontos_erro_app.shx", data: pts.shx });
    appErrosFiles.push({
      name: "pontos_erro_app.dbf",
      data: buildDbfBuffer(appErrorPoints.map((p) => p.attributes), errorPointFields),
    });
    appErrosFiles.push({ name: "pontos_erro_app.prj", data: Buffer.from(prj, "utf8") });
  }
  const appErrosZip = await buildNestedZip(appErrosFiles);

  const inventario = [
    "Inventario de saidas — Processar projeto (fluxo completo SIMCAR / ProcessarGeo local)",
    "",
    "arquivo_enviado.zip            — shapefiles originais enviados",
    "arquivo_processado.zip         — projeto processado: limpos + APP/APPD/APPP/APPRL/AURD/ARLDR",
    "arquivo_conferencia.zip        — camadas com area_m2/area_ha",
    "erros_processamento.zip        — ERROS_DE_SOBREPOSICAO (mesmo artefato/schema do download da SEMA)",
    "erros_diagnostico.zip          — diagnosticos extras GeoForest (pontos de erro, poligonos)",
    "erros_processamento_app.zip    — pontos de erro de calculo de APP",
    "relatorio_importacao.txt       — fase Importar",
    "relatorio_processamento.txt    — fase Processar",
    "resumo_erros.csv               — tabela unificada de erros",
    "quadro_areas.csv               — areas por camada (inclui APP*)",
    "",
    "Pastas espelhadas (mesmos arquivos, para abrir direto no SIG):",
    "  arquivo_enviado/",
    "  arquivo_processado/   ← aqui entram APP.shp, APPD.shp, APPP.shp, …",
    "  arquivo_conferencia/",
    "  erros/",
    "  erros_app/",
    "",
  ].join("\n");

  return new Promise((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } });
    const chunks: Buffer[] = [];
    archive.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));

    archive.append(Buffer.from(args.importRelatorio, "utf8"), { name: "relatorio_importacao.txt" });
    archive.append(Buffer.from(proc.relatorioTexto, "utf8"), { name: "relatorio_processamento.txt" });
    archive.append(buildCsv(allRows), { name: "resumo_erros.csv" });
    archive.append(buildQuadroCsv(proc.quadroAreas), { name: "quadro_areas.csv" });
    archive.append(Buffer.from(inventario, "utf8"), { name: "inventario_saidas.txt" });

    archive.append(enviadoZip, { name: "arquivo_enviado.zip" });
    archive.append(processadoZip, { name: "arquivo_processado.zip" });
    archive.append(conferenciaZip, { name: "arquivo_conferencia.zip" });
    archive.append(errosZip, { name: "erros_processamento.zip" });
    archive.append(diagZip, { name: "erros_diagnostico.zip" });
    archive.append(appErrosZip, { name: "erros_processamento_app.zip" });

    // Pastas planas (mesmos conteúdos)
    for (const f of enviadoFiles) archive.append(f.data, { name: `arquivo_enviado/${f.name}` });
    for (const f of processadoFiles) archive.append(f.data, { name: `arquivo_processado/${f.name}` });
    for (const f of conferenciaFiles) archive.append(f.data, { name: `arquivo_conferencia/${f.name}` });
    for (const f of errosFiles) archive.append(f.data, { name: `erros/${f.name}` });
    for (const f of diagFiles) archive.append(f.data, { name: `erros_diagnostico/${f.name}` });
    for (const f of appErrosFiles) archive.append(f.data, { name: `erros_app/${f.name}` });

    // Também na raiz para quem espera só pontos_erros.shp
    appendPointSet(archive, "", "pontos_erros", pointRecords, errorPointFields, prj);

    archive.finalize().catch(reject);
  });
}

/* ─────────────────────── job plumbing ─────────────────────── */
