import path from "node:path";
import JSZip from "jszip";

import { normalizeLayerName, recognizeSimcarLayer } from "../../simcar-rules";
import {
  buildDbfBuffer,
  buildShpAndShx,
  parseDbfSchema,
  readDbfRows,
  type ShpRecord,
} from "../../shapefile-writer";
import { detectCrs, parsePolygonRecords } from "../../vertices-proximas";
import type {
  AutofixActionType,
  FixDiffSummary,
  LayerAction,
} from "./types";

type ZipFileInfo = {
  name: string;
  extension: string;
  stem: string;
  layerName: string;
};

function zipFileInfo(name: string): ZipFileInfo {
  const normalizedPath = name.replace(/\\/g, "/");
  const lower = normalizedPath.toLowerCase();
  const extension = lower.endsWith(".shp.xml")
    ? ".shp.xml"
    : path.posix.extname(normalizedPath).toLowerCase();
  const stem = normalizedPath.slice(
    0,
    normalizedPath.length - extension.length
  );
  return {
    name,
    extension,
    stem,
    layerName: path.posix.basename(stem),
  };
}

function sameLayerStem(a: string, b: string): boolean {
  return a.toLocaleLowerCase("pt-BR") === b.toLocaleLowerCase("pt-BR");
}

function resolveLayer(
  files: ZipFileInfo[],
  requestedLayer: string
): ZipFileInfo {
  const requested = normalizeLayerName(requestedLayer);
  const shapefiles = files.filter(file => file.extension === ".shp");
  let matches = shapefiles.filter(
    file => normalizeLayerName(file.layerName) === requested
  );
  if (!matches.length) {
    const requestedCode = recognizeSimcarLayer(requestedLayer);
    if (requestedCode)
      matches = shapefiles.filter(
        file => recognizeSimcarLayer(file.layerName) === requestedCode
      );
  }
  if (!matches.length)
    throw new Error(
      `Autofix recusado: camada ${requestedLayer} não encontrada no ZIP.`
    );
  if (matches.length > 1) {
    throw new Error(
      `Autofix recusado: camada ${requestedLayer} é ambígua (${matches.map(file => file.name).join(", ")}).`
    );
  }
  return matches[0];
}

function valuesMatch(
  actual: Record<string, string | number | null>,
  original: Record<string, string>,
  fields: Array<{ name: string }>
): boolean {
  return fields.every(
    field =>
      String(actual[field.name] ?? "").trim() ===
      String(original[field.name] ?? "").trim()
  );
}

function uniqueSorted(values: number[]): number[] {
  return [
    ...new Set(values.filter(value => Number.isInteger(value) && value > 0)),
  ].sort((a, b) => a - b);
}

function emptyMetrics() {
  return {
    verticesRemoved: 0,
    ringsRemoved: 0,
    recordsDropped: 0,
    recordsCreated: 0,
    identifiersCreated: 0,
  };
}

export type RewriteZipLayerArgs = {
  zipBuffer: Buffer;
  layer: string;
  actionType: AutofixActionType;
  action: LayerAction;
  relatedLayers?: string[];
};

export type RewriteZipLayerResult = {
  zipBuffer: Buffer;
  diff: FixDiffSummary;
};

/**
 * Regrava somente SHP/SHX/DBF da camada alterada. Todos os outros payloads do
 * ZIP são conferidos byte a byte após a serialização; PRJ/CPG nunca são tocados.
 */
export async function rewriteZipLayer(
  args: RewriteZipLayerArgs
): Promise<RewriteZipLayerResult> {
  if (!Buffer.isBuffer(args.zipBuffer) || args.zipBuffer.length < 22) {
    throw new Error("Autofix recusado: ZIP ausente ou inválido.");
  }
  const zip = await JSZip.loadAsync(args.zipBuffer, { checkCRC32: true });
  const fileEntries = Object.values(zip.files).filter(entry => !entry.dir);
  const files = fileEntries.map(entry => zipFileInfo(entry.name));
  const selected = resolveLayer(files, args.layer);
  const byExtension = new Map(
    files
      .filter(file => sameLayerStem(file.stem, selected.stem))
      .map(file => [file.extension, file])
  );
  const shpInfo = byExtension.get(".shp");
  const dbfInfo = byExtension.get(".dbf");
  if (!shpInfo || !dbfInfo) {
    throw new Error(
      `Autofix recusado: ${selected.layerName} precisa conter .shp e .dbf alinhados.`
    );
  }

  const originalPayloads = new Map<string, Buffer>();
  await Promise.all(
    fileEntries.map(async entry => {
      originalPayloads.set(
        entry.name,
        Buffer.from(await entry.async("nodebuffer"))
      );
    })
  );
  const shpBuffer = originalPayloads.get(shpInfo.name)!;
  const dbfBuffer = originalPayloads.get(dbfInfo.name)!;
  const shapeType = shpBuffer.length >= 36 ? shpBuffer.readInt32LE(32) : 0;
  if (shapeType !== 5) {
    throw new Error(
      `Autofix recusado: ${selected.layerName} usa shape type ${shapeType}; apenas Polygon 2D (5) é regravável.`
    );
  }
  const parsed = parsePolygonRecords(shpBuffer);
  const rows = readDbfRows(dbfBuffer);
  const schema = parseDbfSchema(dbfBuffer);
  const originalShxInfo = byExtension.get(".shx");
  const originalShxCount = originalShxInfo
    ? Math.max(
        0,
        (originalPayloads.get(originalShxInfo.name)!.length - 100) / 8
      )
    : parsed.length;
  if (!schema.length)
    throw new Error(
      `Autofix recusado: schema DBF vazio em ${selected.layerName}.`
    );
  if (
    parsed.length !== rows.length ||
    originalShxCount !== parsed.length ||
    parsed.some((record, index) => record.feature !== index + 1)
  ) {
    throw new Error(
      `Autofix recusado: SHP/SHX/DBF de ${selected.layerName} não têm correspondência 1:1 ` +
        `(${parsed.length}/${originalShxCount}/${rows.length}).`
    );
  }

  const prjInfo = byExtension.get(".prj");
  const relatedLayers = (args.relatedLayers || []).map(requestedLayer => {
    const related = resolveLayer(files, requestedLayer);
    const relatedByExtension = new Map(
      files
        .filter(file => sameLayerStem(file.stem, related.stem))
        .map(file => [file.extension, file])
    );
    const relatedShp = relatedByExtension.get(".shp");
    if (!relatedShp) {
      throw new Error(
        `Autofix recusado: camada de apoio ${requestedLayer} não contém .shp.`
      );
    }
    const relatedShpBuffer = originalPayloads.get(relatedShp.name)!;
    const relatedShapeType =
      relatedShpBuffer.length >= 36
        ? relatedShpBuffer.readInt32LE(32)
        : 0;
    if (relatedShapeType !== 5) {
      throw new Error(
        `Autofix recusado: camada de apoio ${related.layerName} usa shape type ${relatedShapeType}; era esperado Polygon 2D (5).`
      );
    }
    const relatedPrj = relatedByExtension.get(".prj");
    return {
      layerName: related.layerName,
      crs: detectCrs(
        relatedPrj
          ? originalPayloads.get(relatedPrj.name)?.toString("utf8")
          : undefined
      ),
      records: parsePolygonRecords(relatedShpBuffer).map(record => ({
        sourceFeature: record.feature,
        rings: record.rings.map(ring => ring.map(point => [...point])),
      })),
    };
  });
  const context = {
    layerName: selected.layerName,
    crs: detectCrs(
      prjInfo ? originalPayloads.get(prjInfo.name)?.toString("utf8") : undefined
    ),
    dbfSchema: schema,
    records: parsed.map((record, index) => ({
      sourceFeature: record.feature,
      rings: record.rings.map(ring => ring.map(point => [...point])),
      attributes: { ...rows[index] },
    })),
    relatedLayers,
  };
  const transformed = await args.action(context);
  const metrics = { ...emptyMetrics(), ...(transformed.metrics || {}) };
  const diff: FixDiffSummary = {
    camada: selected.layerName,
    acao: args.actionType,
    alterou: transformed.changed,
    feicoesAfetadas: uniqueSorted(transformed.affectedFeatures),
    registrosAntes: context.records.length,
    registrosDepois: transformed.records.length,
    verticesRemovidos: metrics.verticesRemoved,
    aneisRemovidos: metrics.ringsRemoved,
    registrosRemovidos: metrics.recordsDropped,
    registrosCriados: metrics.recordsCreated,
    identificadoresCriados: metrics.identifiersCreated,
    avisos: [...(transformed.warnings || [])],
  };
  if (!transformed.changed) return { zipBuffer: args.zipBuffer, diff };

  for (const record of transformed.records) {
    if (
      !record.rings.length ||
      record.rings.some(ring => {
        if (
          ring.length < 4 ||
          ring.some(
            point =>
              point.length < 2 || !point.slice(0, 2).every(Number.isFinite)
          )
        ) {
          return true;
        }
        const first = ring[0];
        const last = ring[ring.length - 1];
        return first[0] !== last[0] || first[1] !== last[1];
      })
    ) {
      throw new Error(
        `Autofix recusado: ação ${args.actionType} gerou registro poligonal inválido.`
      );
    }
    if (
      !context.records.some(
        source => source.sourceFeature === record.sourceFeature
      )
    ) {
      throw new Error(
        `Autofix recusado: ação ${args.actionType} perdeu a origem DBF de um registro.`
      );
    }
  }

  const shpRecords: ShpRecord[] = transformed.records.map(record => ({
    type: "polygon",
    rings: record.rings,
    attributes: record.attributes,
  }));
  const built = buildShpAndShx(shpRecords, 5);
  const dbfCanRemainByteExact =
    transformed.records.length === rows.length &&
    transformed.records.every(
      (record, index) =>
        record.sourceFeature === index + 1 &&
        valuesMatch(record.attributes, rows[index], schema)
    );
  const rewrittenDbf = dbfCanRemainByteExact
    ? dbfBuffer
    : buildDbfBuffer(
        transformed.records.map(record => record.attributes),
        schema
      );

  const shxInfo = originalShxInfo;
  const shxName = shxInfo?.name || `${selected.stem}.shx`;
  zip.file(shpInfo.name, built.shp);
  zip.file(shxName, built.shx);
  zip.file(dbfInfo.name, rewrittenDbf);

  const removedNames = new Set<string>();
  for (const extension of [".sbn", ".sbx", ".shp.xml"]) {
    const stale = byExtension.get(extension);
    if (!stale) continue;
    zip.remove(stale.name);
    removedNames.add(stale.name);
  }
  const changedNames = new Set([
    shpInfo.name,
    shxName,
    dbfInfo.name,
    ...removedNames,
  ]);
  const output = Buffer.from(
    await zip.generateAsync({
      type: "nodebuffer",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    })
  );

  const checkZip = await JSZip.loadAsync(output, { checkCRC32: true });
  for (const [name, expected] of originalPayloads) {
    if (changedNames.has(name)) continue;
    const entry = checkZip.file(name);
    if (!entry)
      throw new Error(
        `Sanidade autofix falhou: arquivo intocado desapareceu (${name}).`
      );
    const actual = Buffer.from(await entry.async("nodebuffer"));
    if (!actual.equals(expected)) {
      throw new Error(
        `Sanidade autofix falhou: arquivo intocado mudou (${name}).`
      );
    }
  }
  for (const name of removedNames) {
    if (checkZip.file(name))
      throw new Error(
        `Sanidade autofix falhou: índice espacial obsoleto permaneceu (${name}).`
      );
  }
  const checkShp = Buffer.from(
    await checkZip.file(shpInfo.name)!.async("nodebuffer")
  );
  const checkShx = Buffer.from(
    await checkZip.file(shxName)!.async("nodebuffer")
  );
  const checkDbf = Buffer.from(
    await checkZip.file(dbfInfo.name)!.async("nodebuffer")
  );
  const outputRecordCount = parsePolygonRecords(checkShp).length;
  const outputDbfCount = readDbfRows(checkDbf).length;
  const outputShxCount = Math.max(0, (checkShx.length - 100) / 8);
  if (
    outputRecordCount !== transformed.records.length ||
    outputDbfCount !== transformed.records.length ||
    outputShxCount !== transformed.records.length
  ) {
    throw new Error(
      `Sanidade autofix falhou: contagens SHP/SHX/DBF divergiram (${outputRecordCount}/${outputShxCount}/${outputDbfCount}).`
    );
  }
  return { zipBuffer: output, diff };
}
