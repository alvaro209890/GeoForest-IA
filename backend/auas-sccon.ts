/**
 * AUAS × Alertas SCCON (SEMA-MT)
 * ------------------------------------------------------------------
 * Porta para Node/TS a automação de datação de AUAS a partir dos
 * alertas públicos de desmate da plataforma SCCON (SEMA-MT).
 *
 * Fluxo:
 *   1) Token público (login anônimo do dashboard público).
 *   2) WFS GetFeature no bbox da AUAS → ids `idt_local_alert`.
 *   3) localAlerts/{id} em paralelo → geometria + alertDetectedDate.
 *   4) Spatial join (intersects) → ABERTURA = MIN(data) (ou MAX).
 *   5) Saídas: AUAS.shp datado + pontos sem alerta + relatório JSON (ZIP).
 *
 * Estratégia de escrita: a geometria da AUAS NÃO é reconstruída — os
 * bytes de .shp/.shx/.prj são preservados e apenas o .dbf é reescrito
 * com a coluna ABERTURA atualizada. Assim a geometria fica idêntica.
 *
 * Registra:
 *   POST /api/auas-sccon/process         — SSE (progresso + resultado)
 *   GET  /api/auas-sccon/download/:jobId — download do ZIP final
 *   GET  /api/auas-sccon/config          — constantes públicas
 */
import type { Express, Request, Response } from "express";
import crypto from "node:crypto";
import archiver from "archiver";
import proj4 from "proj4";
import {
    area as turfArea,
    bbox as turfBbox,
    booleanIntersects as turfBooleanIntersects,
    multiPolygon as turfMultiPolygon,
    pointOnFeature as turfPointOnFeature,
    polygon as turfPolygon,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";

import {
    detectCrs,
    getZipLayerGroups,
    parsePolygonRecords,
    SIRGAS_2000_PRJ,
    type ParsedPolygonRecord,
    type ZipEntry,
} from "./vertices-proximas";
import {
    buildDbfBuffer,
    buildPointShpAndShx,
    parseDbfSchema,
    readDbfRows,
    type DbfFieldDef,
} from "./shapefile-writer";

proj4.defs("EPSG:4674", "+proj=longlat +ellps=GRS80 +no_defs +type=crs");
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs +type=crs");

/* ─── Constantes SCCON (config.example.json) ─────────────────── */

export const SCCON_ORG_UUID =
    process.env.SCCON_ORG_UUID || "597953b9-ee78-4113-80f9-803dbbaa60a0";
export const SCCON_START_DATE = process.env.SCCON_START_DATE || "2019-07-22";

const UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TOKEN_URL =
    process.env.SCCON_TOKEN_URL ||
    "https://plataforma.sccon.com.br/gama-api/auth/token-public-layer";
const USER_URL =
    process.env.SCCON_USER_URL ||
    "https://plataforma-alertas.sccon.com.br/gama-api/users/user";
const WFS_URL =
    process.env.SCCON_WFS_URL ||
    "https://geoserver-dashboard-mt.sccon.com.br/geoserver/dashboards/wfs";
const WFS_LAYER =
    process.env.SCCON_WFS_LAYER ||
    "dashboards:vw_v2_dashboard_alerts_all_defo-data_prod-mt";
const LOCAL_ALERT_URL =
    process.env.SCCON_LOCAL_ALERT_URL ||
    "https://deforestation-data-mt.sccon.com.br/api-v2/localAlerts/{id}";

// Classes de desmate/degradação relevantes para data de abertura de AUAS.
export const DEFAULT_CLASSES = [
    "CUT",
    "SELECTIVE_EXTRACTION",
    "DEGRADATION_SELECTIVE_CUT",
    "BURN_SCAR",
    "MINERAL_EXTRACTION",
    "DEGRADATION_CHEMICAL_AGENT",
    "FOCUS_OF_BURN",
    "LANDSLIDES",
    "BLOW_DOWN",
];

const HTTP_CONCURRENCY = Number(process.env.SCCON_HTTP_CONCURRENCY || 12);
const HTTP_TIMEOUT_MS = Number(process.env.SCCON_HTTP_TIMEOUT_MS || 60000);
const BBOX_PAD_DEG = 0.001; // ~100 m

/* ─── Tipos ───────────────────────────────────────────────────── */

export type DateRule = "min" | "max";

export type ScconAlert = {
    localId: number;
    classType: string;
    /** data de detecção (UTC/local ISO da API) */
    date: Date;
    feature: Feature<Polygon | MultiPolygon>;
    bbox: [number, number, number, number];
};

export type AuasLayer = {
    name: string;
    basename: string;
    shp: Buffer;
    shx: Buffer;
    prj?: Buffer;
    dbf: Buffer;
    records: ParsedPolygonRecord[];
    rows: Array<Record<string, string>>;
    fields: DbfFieldDef[];
    projDef: string | null;
    crsLabel: string;
    missingCrs: boolean;
};

export type PolygonDetail = {
    index: number;
    ID: number | string | null;
    ABERTURA_antes: string | null;
    ABERTURA_depois: string | null;
    n_alertas_intersect: number;
    data_alerta_min: string | null;
    data_alerta_max: string | null;
    classes: string;
    atualizado: boolean;
};

export type UpdateResult = {
    dbf: Buffer;
    updated: number;
    semIntersecao: number;
    details: PolygonDetail[];
    /** feições (feature 1-based) sem qualquer alerta que intersecta */
    semAlertaFeatures: number[];
};

/* ─── HTTP helper (headers de browser p/ Cloudflare) ─────────── */

async function scconFetch(
    url: string,
    opts: { method?: string; body?: unknown; token?: string; timeoutMs?: number } = {},
): Promise<any> {
    const { method = "GET", body, token, timeoutMs = HTTP_TIMEOUT_MS } = opts;
    const headers: Record<string, string> = {
        "User-Agent": UA,
        Accept: "application/json, text/plain, */*",
        Origin: "https://alertas.sccon.com.br",
        Referer: "https://alertas.sccon.com.br/matogrosso/",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let payload: string | undefined;
    if (body !== undefined) {
        payload = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetch(url, {
            method,
            headers,
            body: payload,
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`SCCON ${res.status} em ${url.split("?")[0]}: ${text.slice(0, 200)}`);
        }
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

/* ─── Cliente SCCON ───────────────────────────────────────────── */

export async function getPublicToken(): Promise<string> {
    const url = `${TOKEN_URL}?organizationUUID=${SCCON_ORG_UUID}`;
    const data = await scconFetch(url);
    const token = data?.access_token;
    if (!token) throw new Error("Token público SCCON não retornado.");
    return String(token);
}

async function getUserId(token: string): Promise<string> {
    const data = await scconFetch(USER_URL, { token });
    return String(data?.id || "");
}

function buildViewparams(userId: string, classes: string[], toDate: string): string {
    // Formato GeoServer SCCON: classes:'CUT'\,'SELECTIVE_EXTRACTION'\,...
    const classesParam = classes.map((c) => `'${c}'`).join("\\,");
    return (
        `userToken:'${userId}';` +
        `orgToken:'${SCCON_ORG_UUID}';` +
        `fromDate:'${SCCON_START_DATE}';` +
        `toDate:'${toDate}';` +
        `parentLocalType1:'STATE';` +
        `classes:${classesParam};` +
        `inspectionFilter:'ALL'`
    );
}

export async function fetchWfsAlertIds(
    bbox: [number, number, number, number],
    classes: string[],
    token: string,
    userId: string,
): Promise<number[]> {
    const toDate = new Date().toISOString().slice(0, 10);
    const viewparams = buildViewparams(userId, classes, toDate);
    const [minx, miny, maxx, maxy] = bbox;
    const params = new URLSearchParams({
        service: "WFS",
        version: "1.1.0",
        request: "GetFeature",
        typeName: WFS_LAYER,
        outputFormat: "application/json",
        srsName: "EPSG:4674",
        bbox: `${minx},${miny},${maxx},${maxy},EPSG:4674`,
        viewparams,
        maxFeatures: "10000",
    });
    const url = `${WFS_URL}?${params.toString()}`;
    const fc = await scconFetch(url, { timeoutMs: 120000 });
    const features: any[] = fc?.features || [];
    const ids = new Set<number>();
    for (const f of features) {
        const raw = f?.properties?.idt_local_alert;
        if (raw !== null && raw !== undefined && Number.isFinite(Number(raw))) {
            ids.add(Number(raw));
        }
    }
    return [...ids].sort((a, b) => a - b);
}

/** Busca detalhes (geometria + data) de cada alerta, com pool paralelo. */
export async function fetchAlertDetails(
    ids: number[],
    token: string,
    onProgress?: (done: number, total: number) => void,
): Promise<{ alerts: ScconAlert[]; fails: number }> {
    const alerts: ScconAlert[] = [];
    let fails = 0;
    let done = 0;
    let cursor = 0;

    async function worker() {
        while (cursor < ids.length) {
            const id = ids[cursor++];
            try {
                const d = await scconFetch(LOCAL_ALERT_URL.replace("{id}", String(id)), {
                    token,
                    timeoutMs: 45000,
                });
                const alert = d?.alert || d;
                const geom = alert?.geometry;
                const dateStr = alert?.alertDetectedDate;
                const parsed = dateStr ? new Date(dateStr) : null;
                if (geom && parsed && !Number.isNaN(parsed.getTime())) {
                    const feature = geometryToFeature(geom);
                    if (feature) {
                        alerts.push({
                            localId: Number(d?.id ?? id),
                            classType: String(alert?.classType || ""),
                            date: parsed,
                            feature,
                            bbox: turfBbox(feature) as [number, number, number, number],
                        });
                    } else {
                        fails += 1;
                    }
                } else {
                    fails += 1;
                }
            } catch {
                fails += 1;
            } finally {
                done += 1;
                if (onProgress && (done % 10 === 0 || done === ids.length)) {
                    onProgress(done, ids.length);
                }
            }
        }
    }

    const workers = Array.from({ length: Math.min(HTTP_CONCURRENCY, ids.length) }, () => worker());
    await Promise.all(workers);
    return { alerts, fails };
}

function geometryToFeature(geom: any): Feature<Polygon | MultiPolygon> | null {
    try {
        if (geom?.type === "Polygon") return turfPolygon(geom.coordinates);
        if (geom?.type === "MultiPolygon") return turfMultiPolygon(geom.coordinates);
    } catch {
        return null;
    }
    return null;
}

/* ─── Leitura da AUAS ─────────────────────────────────────────── */

/** Reprojeta um par [x,y] do CRS da AUAS para EPSG:4674 (lon/lat). */
function toWgs84(projDef: string | null, x: number, y: number): [number, number] {
    if (!projDef || projDef === "EPSG:4674" || projDef === "EPSG:4326") {
        return [x, y];
    }
    try {
        const [lon, lat] = proj4(projDef, "EPSG:4674", [x, y]);
        return [lon, lat];
    } catch {
        return [x, y];
    }
}

/** Converte anéis (no CRS da AUAS) em Feature Polygon EPSG:4674, fechando anéis. */
function ringsToWgsFeature(rings: number[][][], projDef: string | null): Feature<Polygon> | null {
    const outRings: number[][][] = [];
    for (const ring of rings) {
        if (ring.length < 3) continue;
        const r = ring.map(([x, y]) => toWgs84(projDef, x, y));
        const first = r[0];
        const last = r[r.length - 1];
        if (first[0] !== last[0] || first[1] !== last[1]) r.push([first[0], first[1]]);
        if (r.length >= 4) outRings.push(r);
    }
    if (!outRings.length) return null;
    try {
        return turfPolygon(outRings);
    } catch {
        return null;
    }
}

/**
 * Seleciona a camada AUAS do ZIP: prefere nome contendo "AUAS", senão a
 * camada poligonal com mais feições. Exige .shp + .dbf com coluna ABERTURA.
 */
export function pickAuasLayer(zipBuffer: Buffer): AuasLayer {
    const groups = getZipLayerGroups(zipBuffer);
    const candidates = groups
        .filter((g) => g.shp && g.dbf)
        .map((g) => {
            const records = parsePolygonRecords(g.shp!.data);
            const fields = parseDbfSchema(g.dbf!.data);
            const hasAbertura = fields.some((f) => f.name.toUpperCase() === "ABERTURA");
            return { g, records, fields, hasAbertura };
        })
        .filter((c) => c.records.length > 0 && c.hasAbertura);

    if (!candidates.length) {
        throw new Error(
            "Nenhuma camada poligonal com coluna ABERTURA encontrada no ZIP. " +
                "Envie o shapefile AUAS (com .shp, .dbf e o campo ABERTURA).",
        );
    }
    candidates.sort((a, b) => {
        const aA = a.g.name.toUpperCase().includes("AUAS") ? 1 : 0;
        const bA = b.g.name.toUpperCase().includes("AUAS") ? 1 : 0;
        if (aA !== bA) return bA - aA;
        return b.records.length - a.records.length;
    });

    const { g, records, fields } = candidates[0];
    const rows = readDbfRows(g.dbf!.data);
    const crs = detectCrs(g.prj?.data.toString("utf8"));
    // Heurística: se coordenadas parecem lon/lat (|x|<=180), tratar como 4674.
    let projDef = crs.projDef || null;
    if ((!projDef || crs.kind === "unknown") && records[0]?.rings?.[0]?.[0]) {
        const [x, y] = records[0].rings[0][0];
        if (Math.abs(x) <= 180 && Math.abs(y) <= 90) projDef = "EPSG:4674";
    }
    return {
        name: g.name,
        basename: g.name,
        shp: g.shp!.data,
        shx: reconstructShxFromShp(g.shp!.data),
        prj: g.prj?.data,
        dbf: g.dbf!.data,
        records,
        rows,
        fields,
        projDef,
        crsLabel: crs.label,
        missingCrs: crs.missing,
    };
}

/**
 * Reconstrói o índice .shx a partir do .shp (percorrendo os cabeçalhos de
 * registro), já que o ZIP nem sempre traz .shx e ele precisa ir na saída.
 */
function reconstructShxFromShp(shp: Buffer): Buffer {
    const offsets: Array<[number, number]> = []; // [offsetWords, contentLenWords]
    let offset = 100;
    while (offset + 8 <= shp.length) {
        const contentLenWords = shp.readInt32BE(offset + 4);
        const contentBytes = contentLenWords * 2;
        if (contentBytes < 4 || offset + 8 + contentBytes > shp.length) break;
        offsets.push([offset / 2, contentLenWords]);
        offset += 8 + contentBytes;
    }
    const shx = Buffer.alloc(100 + offsets.length * 8, 0);
    // header: copia os 100 bytes do .shp e ajusta o file length
    shp.copy(shx, 0, 0, 100);
    shx.writeInt32BE((100 + offsets.length * 8) / 2, 24);
    let o = 100;
    for (const [offW, lenW] of offsets) {
        shx.writeInt32BE(offW, o);
        shx.writeInt32BE(lenW, o + 4);
        o += 8;
    }
    return shx;
}

/* ─── Spatial join + regra de data ────────────────────────────── */

function bboxOverlap(
    a: [number, number, number, number],
    b: [number, number, number, number],
): boolean {
    return !(a[2] < b[0] || a[0] > b[2] || a[3] < b[1] || a[1] > b[3]);
}

function fmtBr(d: Date | null): string | null {
    if (!d || Number.isNaN(d.getTime())) return null;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${d.getFullYear()}`;
}

/**
 * Interpreta o valor bruto de ABERTURA em qualquer um dos formatos que aparecem
 * na prática: DBF Date `YYYYMMDD`, brasileiro `DD/MM/YYYY` ou ISO `YYYY-MM-DD`.
 * Data local (sem UTC) para casar 1:1 com `fmtBr`.
 */
function parseAberturaToDate(raw: unknown): Date | null {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    let m = s.match(/^(\d{4})(\d{2})(\d{2})$/); // DBF Date YYYYMMDD
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); // DD/MM/YYYY
    if (m) {
        const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO YYYY-MM-DD[...]
    if (m) {
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
        return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
}

/** Normaliza qualquer ABERTURA para o texto brasileiro DD/MM/YYYY (ou "" se ilegível). */
function normalizeAberturaBr(raw: unknown): string {
    return fmtBr(parseAberturaToDate(raw)) || "";
}

/**
 * ABERTURA é sempre gravada como texto DD/MM/YYYY (Char, largura ≥10). Se o
 * shapefile original trouxer o campo como Date (`D`, largura 8, `YYYYMMDD`), o
 * `buildDbfBuffer` colapsaria os dígitos e corromperia a data — por isso o campo
 * é coagido para Char na saída, alinhado ao comportamento do script Python.
 */
function coerceAberturaFieldToChar(
    fields: DbfFieldDef[],
    aberturaField: string,
): DbfFieldDef[] {
    return fields.map((f) =>
        f.name === aberturaField
            ? { name: f.name, type: "C", length: Math.max(10, f.length), decimals: 0 }
            : f,
    );
}

/**
 * Faz o join espacial e devolve o DBF atualizado (coluna ABERTURA) mais o
 * relatório por polígono. Função pura (testável sem rede).
 */
export function updateAuasWithAlerts(
    layer: AuasLayer,
    alerts: ScconAlert[],
    opts: { dateRule?: DateRule } = {},
): UpdateResult {
    const useMin = (opts.dateRule || "min") === "min";
    const aberturaField =
        layer.fields.find((f) => f.name.toUpperCase() === "ABERTURA")?.name || "ABERTURA";
    const idField = layer.fields.find((f) => f.name.toUpperCase() === "ID")?.name;

    // Pré-computa bbox de cada AUAS (em 4674) + feature turf.
    const auasFeatures = new Map<number, Feature<Polygon>>();
    const auasBboxes = new Map<number, [number, number, number, number]>();
    for (const rec of layer.records) {
        const feat = ringsToWgsFeature(rec.rings, layer.projDef);
        if (feat) {
            auasFeatures.set(rec.feature, feat);
            auasBboxes.set(rec.feature, turfBbox(feat) as [number, number, number, number]);
        }
    }

    const rows = layer.rows.map((r) => ({ ...r }));
    const details: PolygonDetail[] = [];
    const semAlertaFeatures: number[] = [];
    let updated = 0;

    for (const rec of layer.records) {
        const rowIdx = rec.feature - 1;
        const row = rows[rowIdx] || {};
        const auasFeat = auasFeatures.get(rec.feature);
        const auasBox = auasBboxes.get(rec.feature);

        const hits: ScconAlert[] = [];
        if (auasFeat && auasBox) {
            for (const alert of alerts) {
                if (!bboxOverlap(auasBox, alert.bbox)) continue;
                try {
                    if (turfBooleanIntersects(auasFeat, alert.feature)) hits.push(alert);
                } catch {
                    /* geometria problemática: ignora este par */
                }
            }
        }

        const oldRaw = (row[aberturaField] ?? "").trim();
        const oldStr = normalizeAberturaBr(oldRaw) || oldRaw || null;
        let newDate: Date | null = null;
        let dataMin: Date | null = null;
        let dataMax: Date | null = null;
        const classes = new Set<string>();

        if (hits.length) {
            for (const h of hits) {
                if (!dataMin || h.date < dataMin) dataMin = h.date;
                if (!dataMax || h.date > dataMax) dataMax = h.date;
                if (h.classType) classes.add(h.classType);
            }
            newDate = useMin ? dataMin : dataMax;
            if (newDate) {
                row[aberturaField] = fmtBr(newDate) || "";
                updated += 1;
            }
        } else {
            semAlertaFeatures.push(rec.feature);
        }
        // Mesmo sem alerta, reescreve a data original como texto DD/MM/YYYY para
        // que o campo (coagido para Char) fique consistente em todas as feições.
        if (newDate === null) {
            row[aberturaField] = normalizeAberturaBr(oldRaw);
        }

        details.push({
            index: rowIdx,
            ID: idField ? row[idField] ?? null : null,
            ABERTURA_antes: oldStr,
            ABERTURA_depois: newDate ? fmtBr(newDate) : oldStr,
            n_alertas_intersect: hits.length,
            data_alerta_min: fmtBr(dataMin),
            data_alerta_max: fmtBr(dataMax),
            classes: [...classes].sort().join(","),
            atualizado: Boolean(newDate),
        });
    }

    const outputFields = coerceAberturaFieldToChar(layer.fields, aberturaField);
    const dbf = buildDbfBuffer(rows as Array<Record<string, string | number | null>>, outputFields);
    return {
        dbf,
        updated,
        semIntersecao: layer.records.length - updated,
        details,
        semAlertaFeatures,
    };
}

/* ─── Pontos das AUAS sem alerta ──────────────────────────────── */

export function buildSemAlertaPoints(
    layer: AuasLayer,
    semAlertaFeatures: number[],
): { shp: Buffer; shx: Buffer; dbf: Buffer; count: number; areaHaTotal: number } {
    const aberturaField =
        layer.fields.find((f) => f.name.toUpperCase() === "ABERTURA")?.name || "ABERTURA";
    const idField = layer.fields.find((f) => f.name.toUpperCase() === "ID")?.name;
    const featSet = new Set(semAlertaFeatures);

    const pointRecords: Array<{ coordinates: [number, number]; attributes: Record<string, string | number | null> }> = [];
    let areaHaTotal = 0;

    for (const rec of layer.records) {
        if (!featSet.has(rec.feature)) continue;
        const feat = ringsToWgsFeature(rec.rings, layer.projDef);
        if (!feat) continue;
        let pt: [number, number];
        try {
            pt = turfPointOnFeature(feat).geometry.coordinates as [number, number];
        } catch {
            // fallback: primeiro vértice
            pt = feat.geometry.coordinates[0][0] as [number, number];
        }
        // area geodésica (m²) via turf (assume lon/lat) → ha
        let areaHa = 0;
        try {
            areaHa = turfArea(feat) / 10000;
        } catch {
            areaHa = 0;
        }
        areaHaTotal += areaHa;
        const row = layer.rows[rec.feature - 1] || {};
        pointRecords.push({
            coordinates: pt,
            attributes: {
                ID: idField ? row[idField] ?? null : null,
                ABERTURA: normalizeAberturaBr(row[aberturaField]) || null,
                area_ha: Number(areaHa.toFixed(6)),
                idx_auas: rec.feature - 1,
                motivo: "sem_alerta_SCCON",
            },
        });
    }

    const { shp, shx } = buildPointShpAndShx(pointRecords);
    const fields: DbfFieldDef[] = [
        { name: "ID", type: "C", length: 20, decimals: 0 },
        { name: "ABERTURA", type: "C", length: 10, decimals: 0 },
        { name: "area_ha", type: "N", length: 19, decimals: 6 },
        { name: "idx_auas", type: "N", length: 10, decimals: 0 },
        { name: "motivo", type: "C", length: 20, decimals: 0 },
    ];
    const dbf = buildDbfBuffer(
        pointRecords.map((r) => r.attributes),
        fields,
    );
    return { shp, shx, dbf, count: pointRecords.length, areaHaTotal };
}

/* ─── Orquestrador ────────────────────────────────────────────── */

export type AuasScconReport = {
    fonte: string;
    dashboard: string;
    regra_data: string;
    periodo_alertas_inicio: string;
    n_alertas_bbox: number;
    n_alertas_com_data: number;
    classes_alertas: Record<string, number>;
    n_auas: number;
    n_atualizados: number;
    n_sem_intersecao: number;
    n_pontos_sem_alerta: number;
    area_ha_sem_alerta: number;
    crs_auas: string;
    gerado_em: string;
    warnings: string[];
    detalhes: PolygonDetail[];
};

/** Teto de feições do WFS SCCON — se atingido, o bbox pode ter truncado. */
const WFS_MAX_FEATURES = 10000;

export type AuasScconResult = {
    zip: Buffer;
    filename: string;
    report: AuasScconReport;
};

type ProgressFn = (ev: { stage: string; message: string; pct?: number }) => void;

export async function runAuasSccon(
    zipBuffer: Buffer,
    opts: { dateRule?: DateRule; classes?: string[]; filename?: string } = {},
    onProgress: ProgressFn = () => {},
): Promise<AuasScconResult> {
    const dateRule: DateRule = opts.dateRule === "max" ? "max" : "min";
    const classes = opts.classes?.length ? opts.classes : DEFAULT_CLASSES;

    onProgress({ stage: "read", message: "Lendo shapefile AUAS…", pct: 5 });
    const layer = pickAuasLayer(zipBuffer);
    onProgress({
        stage: "read",
        message: `AUAS: ${layer.records.length} polígonos (${layer.crsLabel}).`,
        pct: 10,
    });

    // bbox em 4674 com margem
    let minx = Infinity,
        miny = Infinity,
        maxx = -Infinity,
        maxy = -Infinity;
    for (const rec of layer.records) {
        for (const ring of rec.rings) {
            for (const [x, y] of ring) {
                const [lon, lat] = toWgs84(layer.projDef, x, y);
                if (lon < minx) minx = lon;
                if (lat < miny) miny = lat;
                if (lon > maxx) maxx = lon;
                if (lat > maxy) maxy = lat;
            }
        }
    }
    if (!Number.isFinite(minx)) throw new Error("Não foi possível calcular o bbox da AUAS.");
    const bbox: [number, number, number, number] = [
        minx - BBOX_PAD_DEG,
        miny - BBOX_PAD_DEG,
        maxx + BBOX_PAD_DEG,
        maxy + BBOX_PAD_DEG,
    ];

    onProgress({ stage: "auth", message: "Autenticando no SCCON (token público)…", pct: 15 });
    const token = await getPublicToken();
    const userId = await getUserId(token);

    onProgress({ stage: "wfs", message: "Consultando alertas no bbox (WFS)…", pct: 25 });
    const ids = await fetchWfsAlertIds(bbox, classes, token, userId);
    onProgress({
        stage: "wfs",
        message: `WFS: ${ids.length} alertas no bbox da AUAS.`,
        pct: 35,
    });
    if (!ids.length) {
        throw new Error(
            "Nenhum alerta SCCON encontrado no bbox da AUAS. " +
                "As datas não puderam ser atualizadas (área sem alertas no período).",
        );
    }

    onProgress({ stage: "alerts", message: `Baixando ${ids.length} alertas…`, pct: 40 });
    const { alerts, fails } = await fetchAlertDetails(ids, token, (done, total) => {
        const pct = 40 + Math.round((done / total) * 35);
        onProgress({ stage: "alerts", message: `Alertas ${done}/${total}…`, pct });
    });
    if (!alerts.length) throw new Error("Nenhum alerta com geometria/data foi retornado pela API.");

    onProgress({ stage: "join", message: "Cruzando AUAS × alertas (spatial join)…", pct: 80 });
    const upd = updateAuasWithAlerts(layer, alerts, { dateRule });

    onProgress({ stage: "points", message: "Gerando pontos das AUAS sem alerta…", pct: 88 });
    const pts = buildSemAlertaPoints(layer, upd.semAlertaFeatures);

    // relatório
    const classesCount: Record<string, number> = {};
    for (const a of alerts) classesCount[a.classType] = (classesCount[a.classType] || 0) + 1;
    const warnings: string[] = [];
    if (ids.length >= WFS_MAX_FEATURES) {
        warnings.push(
            `O WFS retornou o máximo de ${WFS_MAX_FEATURES} alertas no bbox — pode haver ` +
                `truncamento. Se a AUAS cobre uma área muito grande, processe por partes.`,
        );
    }
    if (fails) {
        warnings.push(`${fails} alertas não retornaram detalhe/geometria e foram ignorados.`);
    }
    const report: AuasScconReport = {
        fonte: "SCCON Alertas Mato Grosso (SEMA-MT)",
        dashboard: "https://alertas.sccon.com.br/matogrosso/#/dashboard/view-map",
        regra_data:
            dateRule === "min"
                ? "ABERTURA = data mais antiga (min) dos alertas que intersectam o polígono"
                : "ABERTURA = data mais recente (max) dos alertas que intersectam o polígono",
        periodo_alertas_inicio: SCCON_START_DATE,
        n_alertas_bbox: ids.length,
        n_alertas_com_data: alerts.length,
        classes_alertas: classesCount,
        n_auas: layer.records.length,
        n_atualizados: upd.updated,
        n_sem_intersecao: upd.semIntersecao,
        n_pontos_sem_alerta: pts.count,
        area_ha_sem_alerta: Number(pts.areaHaTotal.toFixed(4)),
        crs_auas: layer.crsLabel,
        gerado_em: new Date().toISOString(),
        warnings,
        detalhes: upd.details,
    };

    onProgress({ stage: "zip", message: "Montando o ZIP de saída…", pct: 94 });
    const zip = await buildOutputZip(layer, upd.dbf, pts, alerts, report);
    const filename =
        (opts.filename?.replace(/\.zip$/i, "") || "AUAS") + "_SCCON_datado.zip";

    if (fails) {
        onProgress({
            stage: "done",
            message: `Concluído (com ${fails} alertas sem detalhe, ignorados).`,
            pct: 100,
        });
    }
    return { zip, filename, report };
}

async function buildOutputZip(
    layer: AuasLayer,
    updatedDbf: Buffer,
    pts: { shp: Buffer; shx: Buffer; dbf: Buffer; count: number },
    alerts: ScconAlert[],
    report: AuasScconReport,
): Promise<Buffer> {
    return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("data", (c: Buffer) => chunks.push(c));
        archive.on("error", reject);
        archive.on("end", () => resolve(Buffer.concat(chunks)));

        const base = layer.basename || "AUAS";
        const prj = layer.prj ?? Buffer.from(SIRGAS_2000_PRJ, "utf8");

        // AUAS datado — geometria original preservada, DBF reescrito.
        archive.append(layer.shp, { name: `${base}.shp` });
        archive.append(layer.shx, { name: `${base}.shx` });
        archive.append(updatedDbf, { name: `${base}.dbf` });
        archive.append(prj, { name: `${base}.prj` });

        // Pontos sem alerta (EPSG:4674 / SIRGAS 2000).
        const ptsPrj = Buffer.from(SIRGAS_2000_PRJ, "utf8");
        archive.append(pts.shp, { name: "AUAS_SEM_ALERTA_SCCON_PONTOS.shp" });
        archive.append(pts.shx, { name: "AUAS_SEM_ALERTA_SCCON_PONTOS.shx" });
        archive.append(pts.dbf, { name: "AUAS_SEM_ALERTA_SCCON_PONTOS.dbf" });
        archive.append(ptsPrj, { name: "AUAS_SEM_ALERTA_SCCON_PONTOS.prj" });

        // Relatório de auditoria.
        archive.append(JSON.stringify(report, null, 2), {
            name: "RELATORIO_ATUALIZACAO_DATAS_AUAS_SCCON.json",
        });

        // Cache dos alertas (GeoJSON) — útil para conferência/QA.
        const alertsFc = {
            type: "FeatureCollection",
            crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4674" } },
            features: alerts.map((a) => ({
                type: "Feature",
                properties: {
                    local_id: a.localId,
                    classType: a.classType,
                    alertDetectedDate: a.date.toISOString(),
                },
                geometry: a.feature.geometry,
            })),
        };
        archive.append(JSON.stringify(alertsFc), { name: "sccon_alertas.geojson" });

        archive.finalize();
    });
}

/* ─── Rotas HTTP (SSE + download) ─────────────────────────────── */

type CachedZip = { buffer: Buffer; filename: string; expiresAt: number; uid: string };
const DOWNLOAD_TTL_MS = 30 * 60 * 1000;
const downloadCache = new Map<string, CachedZip>();

function uidOf(req: Request): string {
    return String((req as any).authUid || "").trim();
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of downloadCache.entries()) if (v.expiresAt <= now) downloadCache.delete(k);
}, 5 * 60 * 1000).unref();

function sendSSE(res: Response, data: Record<string, unknown>) {
    try {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
        if (typeof (res as any).flush === "function") (res as any).flush();
    } catch {
        /* conexão fechada */
    }
}

export function registerAuasScconRoutes(app: Express) {
    app.get("/api/auas-sccon/config", (_req: Request, res: Response) => {
        res.json({
            ok: true,
            organizationUUID: SCCON_ORG_UUID,
            startDate: SCCON_START_DATE,
            classes: DEFAULT_CLASSES,
            dashboard: "https://alertas.sccon.com.br/matogrosso/#/dashboard/view-map",
        });
    });

    app.post("/api/auas-sccon/process", async (req: Request, res: Response) => {
        const uid = uidOf(req);
        if (!uid) {
            res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
            return;
        }
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        (res as any).flushHeaders?.();

        try {
            const body = (req.body || {}) as {
                auasZip?: string;
                dateRule?: DateRule;
                classes?: string[];
                filename?: string;
            };
            if (!body.auasZip) {
                sendSSE(res, { type: "error", message: "Campo auasZip (base64) é obrigatório." });
                res.end();
                return;
            }
            let zipBuffer: Buffer;
            try {
                const payload = body.auasZip.includes(",")
                    ? body.auasZip.split(",").pop() || ""
                    : body.auasZip;
                zipBuffer = Buffer.from(payload, "base64");
            } catch {
                sendSSE(res, { type: "error", message: "Base64 do ZIP inválido." });
                res.end();
                return;
            }
            if (zipBuffer.length < 22) {
                sendSSE(res, { type: "error", message: "ZIP muito pequeno para ser válido." });
                res.end();
                return;
            }

            sendSSE(res, { type: "progress", stage: "start", message: "Iniciando…", pct: 1 });
            const result = await runAuasSccon(
                zipBuffer,
                { dateRule: body.dateRule, classes: body.classes, filename: body.filename },
                (ev) => sendSSE(res, { type: "progress", ...ev }),
            );

            const jobId = crypto.randomUUID();
            downloadCache.set(jobId, {
                buffer: result.zip,
                filename: result.filename,
                expiresAt: Date.now() + DOWNLOAD_TTL_MS,
                uid,
            });

            sendSSE(res, {
                type: "done",
                jobId,
                filename: result.filename,
                downloadUrl: `/api/auas-sccon/download/${jobId}`,
                report: result.report,
            });
            res.end();
        } catch (err: any) {
            sendSSE(res, {
                type: "error",
                message: String(err?.message || err || "Falha ao processar AUAS × SCCON."),
            });
            res.end();
        }
    });

    app.get("/api/auas-sccon/download/:jobId", (req: Request, res: Response) => {
        const uid = uidOf(req);
        if (!uid) {
            res.status(401).json({ error: "Usuário não autenticado.", code: "UNAUTHENTICATED" });
            return;
        }
        const cached = downloadCache.get(String(req.params.jobId));
        if (!cached || cached.expiresAt <= Date.now()) {
            if (cached) downloadCache.delete(String(req.params.jobId));
            res.status(404).json({ error: "Download expirado ou não encontrado. Processe novamente." });
            return;
        }
        if (cached.uid !== uid) {
            // Não vaza existência do artefato de outro usuário.
            res.status(404).json({ error: "Download expirado ou não encontrado. Processe novamente." });
            return;
        }
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${cached.filename}"`);
        res.setHeader("Content-Length", cached.buffer.length.toString());
        res.send(cached.buffer);
    });
}
