import proj4 from "proj4";

import { metricProjDefFor } from "../../../geometry-errors";
import { ringSignedArea, type DbfFieldDef } from "../../../shapefile-writer";
import type { CodedCrs, ParsedPolygonRecord } from "../../../vertices-proximas";
import type { AutofixPolygonRecord } from "../types";

export type MetricBridge = {
  toMetric: (point: number[]) => [number, number];
};

export function createMetricBridge(
  records: AutofixPolygonRecord[],
  crs: CodedCrs
): MetricBridge {
  if (crs.kind === "unknown") {
    throw new Error(
      "Autofix recusado: CRS ausente ou desconhecido; tolerâncias métricas seriam inseguras."
    );
  }
  if (crs.kind === "projected") {
    return { toMetric: point => [Number(point[0]), Number(point[1])] };
  }
  const parsed: ParsedPolygonRecord[] = records.map((record, index) => ({
    feature: index + 1,
    rings: record.rings,
  }));
  const source = crs.projDef || "EPSG:4326";
  const target = metricProjDefFor(crs, parsed);
  const projection = proj4(source, target);
  return {
    toMetric: point => {
      const projected = projection.forward([
        Number(point[0]),
        Number(point[1]),
      ]) as [number, number];
      if (!Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) {
        throw new Error(
          "Autofix recusado: falha ao reprojetar geometria para unidade métrica."
        );
      }
      return projected;
    },
  };
}

export function metricDistance(
  a: number[],
  b: number[],
  bridge: MetricBridge
): number {
  const am = bridge.toMetric(a);
  const bm = bridge.toMetric(b);
  return Math.hypot(bm[0] - am[0], bm[1] - am[1]);
}

export function ensureClosed(ring: number[][]): number[][] {
  if (!ring.length) return [];
  const out = ring.map(point => [Number(point[0]), Number(point[1])]);
  const first = out[0];
  const last = out[out.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) out.push([...first]);
  return out;
}

export function openRing(ring: number[][]): number[][] {
  const closed = ensureClosed(ring);
  return closed.length > 1 ? closed.slice(0, -1) : closed;
}

export function ringAreaM2(ring: number[][], bridge: MetricBridge): number {
  const points = openRing(ring).map(bridge.toMetric);
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function convexHull(points: Array<[number, number]>): Array<[number, number]> {
  const unique = new Map(
    points.map(point => [`${point[0]}:${point[1]}`, point])
  );
  const sorted = [...unique.values()].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1]
  );
  if (sorted.length <= 2) return sorted;
  const cross = (o: number[], a: number[], b: number[]) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Array<[number, number]> = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
    )
      lower.pop();
    lower.push(point);
  }
  const upper: Array<[number, number]> = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
    )
      upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function ringMinWidthM(ring: number[][], bridge: MetricBridge): number {
  const hull = convexHull(openRing(ring).map(bridge.toMetric));
  if (hull.length < 3) return 0;
  let best = Infinity;
  for (let i = 0; i < hull.length; i += 1) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length <= 0) continue;
    let farthest = 0;
    for (const point of hull) {
      farthest = Math.max(
        farthest,
        Math.abs((point[0] - a[0]) * dy - (point[1] - a[1]) * dx) / length
      );
    }
    best = Math.min(best, farthest);
  }
  return Number.isFinite(best) ? best : 0;
}

export function pointInRing(point: number[], ring: number[][]): boolean {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if (
      Math.abs(cross) <= 1e-10 &&
      x >= Math.min(xi, xj) - 1e-10 &&
      x <= Math.max(xi, xj) + 1e-10 &&
      y >= Math.min(yi, yj) - 1e-10 &&
      y <= Math.max(yi, yj) + 1e-10
    ) {
      return true;
    }
    if (yi > y !== yj > y) {
      const atX = xi + ((y - yi) * (xj - xi)) / (yj - yi);
      if (x < atX) inside = !inside;
    }
  }
  return inside;
}

export function exteriorRingIndexes(rings: number[][][]): number[] {
  return rings
    .map((ring, index) => ({
      index,
      clockwise: ringSignedArea(ensureClosed(ring)) > 0,
    }))
    .filter(item => item.clockwise)
    .map(item => item.index);
}

export function containingExteriorIndex(
  rings: number[][][],
  holeIndex: number,
  exteriorIndexes: number[]
): number | null {
  const point = openRing(rings[holeIndex])[0];
  if (!point) return null;
  let best: { index: number; area: number } | null = null;
  for (const index of exteriorIndexes) {
    if (!pointInRing(point, rings[index])) continue;
    const area = Math.abs(ringSignedArea(ensureClosed(rings[index])));
    if (!best || area < best.area) best = { index, area };
  }
  return best?.index ?? null;
}

/** Evita que a remoção de uma casca transforme seus antigos buracos em cascas artificiais. */
export function removeOrphanedHoleIndexes(
  rings: number[][][],
  retainedIndexes: Set<number>
): Set<number> {
  const exteriors = exteriorRingIndexes(rings);
  if (!exteriors.length || exteriors.every(index => retainedIndexes.has(index)))
    return retainedIndexes;
  const exteriorSet = new Set(exteriors);
  const safe = new Set(retainedIndexes);
  for (let index = 0; index < rings.length; index += 1) {
    if (exteriorSet.has(index) || !safe.has(index)) continue;
    const parent = containingExteriorIndex(rings, index, exteriors);
    if (parent !== null && !safe.has(parent)) safe.delete(index);
  }
  return safe;
}

export function hasProperSelfIntersection(ring: number[][]): boolean {
  const points = openRing(ring);
  const n = points.length;
  if (n < 4) return false;
  const epsilon = 1e-10;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const r: [number, number] = [b[0] - a[0], b[1] - a[1]];
    for (let j = i + 1; j < n; j += 1) {
      if (j === i || j === i + 1 || (i === 0 && j === n - 1)) continue;
      const c = points[j];
      const d = points[(j + 1) % n];
      const s: [number, number] = [d[0] - c[0], d[1] - c[1]];
      const denominator = r[0] * s[1] - r[1] * s[0];
      if (Math.abs(denominator) <= epsilon) continue;
      const qmp: [number, number] = [c[0] - a[0], c[1] - a[1]];
      const t = (qmp[0] * s[1] - qmp[1] * s[0]) / denominator;
      const u = (qmp[0] * r[1] - qmp[1] * r[0]) / denominator;
      if (t > epsilon && t < 1 - epsilon && u > epsilon && u < 1 - epsilon)
        return true;
    }
  }
  return false;
}

type IdentifierAllocator = {
  cloneForExtra: (
    attributes: AutofixPolygonRecord["attributes"]
  ) => AutofixPolygonRecord["attributes"];
  generatedCount: () => number;
};

export function createIdentifierAllocator(
  records: AutofixPolygonRecord[],
  schema: DbfFieldDef[]
): IdentifierAllocator {
  const fieldByUpper = new Map(
    schema.map(field => [field.name.toUpperCase(), field])
  );
  const preferred = ["ID", "FID", "OBJECTID"]
    .map(name => fieldByUpper.get(name))
    .filter((field): field is DbfFieldDef => Boolean(field));
  const numericIdentific = fieldByUpper.get("IDENTIFIC");
  if (
    numericIdentific &&
    records.some(record =>
      String(record.attributes[numericIdentific.name] ?? "").trim()
    ) &&
    records.every(record =>
      /^\d+$/.test(
        String(record.attributes[numericIdentific.name] ?? "").trim()
      )
    )
  ) {
    preferred.push(numericIdentific);
  }

  const states = preferred.map(field => {
    const values = records
      .map(record => String(record.attributes[field.name] ?? "").trim())
      .filter(Boolean);
    const numeric =
      values.length > 0 && values.every(value => /^\d+$/.test(value));
    return {
      field,
      numeric,
      next: numeric ? Math.max(...values.map(Number)) + 1 : 1,
      used: new Set(values),
    };
  });
  let generated = 0;

  return {
    cloneForExtra(attributes) {
      if (!states.length) {
        throw new Error(
          "Autofix recusado: a divisão criaria linha DBF duplicada e a camada não possui ID/FID/OBJECTID utilizável."
        );
      }
      const next = { ...attributes };
      for (const state of states) {
        if (state.numeric) {
          let value = String(state.next++);
          while (state.used.has(value)) value = String(state.next++);
          if (value.length > state.field.length) {
            throw new Error(
              `Autofix recusado: novo ${state.field.name} não cabe no schema DBF.`
            );
          }
          state.used.add(value);
          next[state.field.name] = value;
          continue;
        }
        const original =
          String(attributes[state.field.name] ?? "ID").trim() || "ID";
        let value = "";
        do {
          const suffix = `-${state.next++}`;
          value = `${original.slice(0, Math.max(0, state.field.length - suffix.length))}${suffix}`;
        } while (state.used.has(value));
        state.used.add(value);
        next[state.field.name] = value;
      }
      generated += 1;
      return next;
    },
    generatedCount: () => generated,
  };
}

export function cloneRecord(
  record: AutofixPolygonRecord
): AutofixPolygonRecord {
  return {
    sourceFeature: record.sourceFeature,
    rings: record.rings.map(ring => ring.map(point => [...point])),
    attributes: { ...record.attributes },
  };
}
