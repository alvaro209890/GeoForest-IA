import express from "express";
import { createServer } from "http";
import path from "path";
import crypto from "crypto";
import { inflateRawSync } from "zlib";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  app.use(express.json({ limit: "12mb" }));

  // Basic CORS for local development
  app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  });

  const MODEL_CATALOG = [
    {
      id: "meta-llama/llama-3.3-70b-versatile",
      label: "Llama 3.3 70B",
      capabilities: ["text"],
    },
    {
      id: "meta-llama/llama-4-maverick-17b-128e-instruct",
      label: "Llama 4 Maverick",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-4-scout-17b-16e-instruct",
      label: "Llama 4 Scout",
      capabilities: ["text", "vision"],
    },
    {
      id: "meta-llama/llama-guard-4-12b",
      label: "Llama Guard 4 12B",
      capabilities: ["text", "vision"],
    },
    {
      id: "qwen/qwen3-32b",
      label: "Qwen 3 32B",
      capabilities: ["text"],
    },
    {
      id: "moonshotai/kimi-k2-instruct-0905",
      label: "Kimi K2 Instruct (0905)",
      capabilities: ["text"],
    },
    {
      id: "openai/gpt-oss-20b",
      label: "GPT-OSS 20B",
      capabilities: ["text"],
    },
  ] as const;

  const MODEL_IDS = new Set(MODEL_CATALOG.map((model) => model.id));
  const SEMA_WMS_BASE =
    process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
  const SEMA_WMS_AUTHKEY =
    process.env.SEMA_WMS_AUTHKEY ||
    "541085de-9a2e-454e-bdba-eb3d57a2f492";

  const parseLayersFromCapabilities = (xml: string) => {
    type Node = {
      name?: string;
      title?: string;
      crs: string[];
      children: number;
    };
    const tokenRegex =
      /<Layer\b[^>]*>|<\/Layer>|<Name>\s*([^<]+)\s*<\/Name>|<Title>\s*([^<]+)\s*<\/Title>|<(?:CRS|SRS)>\s*([^<]+)\s*<\/(?:CRS|SRS)>/gi;
    const stack: Node[] = [];
    const out: Array<{
      name: string;
      title: string;
      crs: string[];
      inferredYear?: string;
      group: "spot" | "landsat" | "sentinel" | "other";
      isLeaf: boolean;
      isRenderable: boolean;
      year?: number;
    }> = [];

    let match: RegExpExecArray | null;
    while ((match = tokenRegex.exec(xml)) !== null) {
      const token = match[0];
      if (/^<Layer\b/i.test(token)) {
        const parent = stack[stack.length - 1];
        if (parent) parent.children += 1;
        stack.push({
          crs: parent ? [...parent.crs] : [],
          children: 0,
        });
        continue;
      }
      if (/^<\/Layer>/i.test(token)) {
        const node = stack.pop();
        if (!node || !node.name) continue;
        const name = node.name.trim();
        if (!name) continue;
        const title = (node.title || name).trim();
        const combined = `${name} ${title}`.toLowerCase();
        const yearMatch = combined.match(/\b(19|20)\d{2}\b/);
        const inferredYear = yearMatch?.[0];
        const year = inferredYear ? Number(inferredYear) : undefined;
        const group = /spot/.test(combined)
          ? "spot"
          : /landsat/.test(combined)
            ? "landsat"
            : /sentinel/.test(combined)
              ? "sentinel"
              : "other";
        const isLeaf = node.children === 0;
        const isRenderable = !!name.includes(":") && isLeaf;
        out.push({
          name,
          title,
          crs: node.crs,
          inferredYear,
          group,
          isLeaf,
          isRenderable,
          year,
        });
        continue;
      }
      const current = stack[stack.length - 1];
      if (!current) continue;
      if (match[1]) {
        current.name = String(match[1] || "").trim();
      } else if (match[2]) {
        current.title = String(match[2] || "").trim();
      } else if (match[3]) {
        const code = String(match[3] || "").trim();
        if (code && !current.crs.includes(code)) current.crs.push(code);
      }
    }

    const uniq = new Map<string, (typeof out)[number]>();
    for (const item of out) {
      if (!uniq.has(item.name)) uniq.set(item.name, item);
    }
    return [...uniq.values()];
  };

  const toImageryLayers = (
    layers: ReturnType<typeof parseLayersFromCapabilities>
  ) => {
    const preferredOrder = [
      "SEMAMT:ALOS_PALSAR_DEM",
      "Geoportal:DECLIVIDADE_GEOPORTAL",
      "Mosaicos:LANDSAT_5_1984",
      "semamt:LANDSAT_5",
      "Mosaicos:LANDSAT_5_1985",
      "Mosaicos:LANDSAT_5_1986",
      "Mosaicos:LANDSAT_5_1987",
      "Mosaicos:LANDSAT_5_1988",
      "Mosaicos:LANDSAT_5_1989",
      "Mosaicos:LANDSAT_5_1990",
      "Mosaicos:LANDSAT_5_1991",
      "Mosaicos:LANDSAT_5_1992",
      "Mosaicos:LANDSAT_5_1993",
      "Mosaicos:LANDSAT_5_1994",
      "Mosaicos:LANDSAT_5_1995",
      "Mosaicos:LANDSAT_5_1996",
      "Mosaicos:LANDSAT_5_1997",
      "Mosaicos:LANDSAT_5_1998",
      "Mosaicos:LANDSAT_5_1999",
      "Mosaicos:LANDSAT_5_2000",
      "Mosaicos:LANDSAT_5_2003",
      "Mosaicos:LANDSAT_5_2004",
      "Mosaicos:LANDSAT_5_2005",
      "Mosaicos:LANDSAT_5_2006",
      "Mosaicos:LANDSAT_5_2007",
      "Mosaicos:LANDSAT_5_2008",
      "Mosaicos:LANDSAT_5_2009",
      "Mosaicos:LANDSAT_5_2010",
      "Mosaicos:LANDSAT_5_2011",
      "Mosaicos:LANDSAT_7_2002",
      "Mosaicos:LANDSAT_8_2013",
      "Mosaicos:LANDSAT_8_2014",
      "Mosaicos:LANDSAT_8_2015",
      "Mosaicos:LANDSAT_8_2016",
      "Mosaicos:LANDSAT_8_2017",
      "Mosaicos:LANDSAT_8_2018",
      "Mosaicos:MOSAICO_SPOT_SEPLAN",
      "Mosaicos:RESOURCESAT_2012",
      "Mosaicos:SENTINEL_2_2016",
      "Mosaicos:Geoportal_Sentinel_2_2016_NIR",
      "Mosaicos:SENTINEL_2_2017",
      "Mosaicos:Geoportal_Sentinel_2_2017_NIR",
      "Mosaicos:SENTINEL_2_2018",
      "Mosaicos:Geoportal_Sentinel_2_2018_NIR",
      "Mosaicos:SENTINEL_2_2019",
      "Mosaicos:SENTINEL_2_2020",
      "Mosaicos:Geoportal_Sentinel_2_2020_NIR",
      "Mosaicos:SENTINEL_2_2021",
      "Mosaicos:Geoportal_Sentinel_2_2021_NIR",
      "Mosaicos:SENTINEL_2_2022",
      "Mosaicos:SENTINEL_2_2023",
      "Mosaicos:SENTINEL_2_2024",
    ];
    const preferredOrderMap = new Map<string, number>();
    for (const name of preferredOrder) {
      const key = name.toLowerCase();
      if (!preferredOrderMap.has(key)) {
        preferredOrderMap.set(key, preferredOrderMap.size);
      }
    }
    const workspaceRank = (name: string) => {
      const ws = name.split(":")[0]?.toLowerCase() || "";
      if (ws === "semamt") return 0;
      if (ws === "geoportal") return 1;
      if (ws === "mosaicos") return 2;
      return 3;
    };

    return layers
      .filter((l) => l.isRenderable)
      .filter((l) => {
        const low = l.name.toLowerCase();
        const txt = `${l.name} ${l.title}`.toLowerCase();
        const hasKnownWorkspace =
          low.startsWith("mosaicos:") || low.startsWith("semamt:") || low.startsWith("geoportal:");
        if (!hasKnownWorkspace) return false;
        return /(landsat|sentinel|spot|resourcesat|mosaico|alos|palsar|dem|declividade)/.test(txt);
      })
      .sort((a, b) => {
        const aOrder = preferredOrderMap.get(a.name.toLowerCase());
        const bOrder = preferredOrderMap.get(b.name.toLowerCase());
        if (aOrder !== undefined || bOrder !== undefined) {
          if (aOrder === undefined) return 1;
          if (bOrder === undefined) return -1;
          if (aOrder !== bOrder) return aOrder - bOrder;
        }

        const ws = workspaceRank(a.name) - workspaceRank(b.name);
        if (ws !== 0) return ws;

        const score = (x: (typeof layers)[number]) => {
          let s = 0;
          if (x.name === "Mosaicos:LANDSAT_5_2008") s += 1000;
          if (x.group === "landsat") s += 120;
          if (x.group === "spot") s += 100;
          if (x.group === "sentinel") s += 80;
          if (x.year === 2008) s += 400;
          if (x.year) s += Math.max(0, 2100 - x.year);
          return s;
        };
        return score(b) - score(a) || a.name.localeCompare(b.name);
      });
  };

  const toShapeLayers = (layers: ReturnType<typeof parseLayersFromCapabilities>) => {
    return layers
      .filter((l) => l.isRenderable)
      .filter((l) => !l.name.toLowerCase().startsWith("mosaicos:"))
      .filter((l) => {
        const txt = `${l.name} ${l.title}`.toLowerCase();
        return !/(landsat|sentinel|spot|resourcesat|mosaico|alos|palsar|dem|declividade)/.test(txt);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  };

  let cachedPdfParser: null | ((buffer: Buffer) => Promise<any>) = null;
  const getPdfParser = async () => {
    if (cachedPdfParser) return cachedPdfParser;
    try {
      const mod: any = await import("pdf-parse");
      const parser = (mod?.default || mod) as (buffer: Buffer) => Promise<any>;
      if (typeof parser === "function") {
        cachedPdfParser = parser;
        return cachedPdfParser;
      }
      return null;
    } catch {
      return null;
    }
  };

  const parsePdfSafe = async (buffer: Buffer) => {
    const parser = await getPdfParser();
    if (!parser) return null;
    try {
      return await parser(buffer);
    } catch {
      return null;
    }
  };

  const fetchSemamtCapabilitiesXml = async () => {
    const capUrl = new URL(SEMA_WMS_BASE);
    capUrl.searchParams.set("service", "WMS");
    capUrl.searchParams.set("request", "GetCapabilities");
    capUrl.searchParams.set("version", "1.3.0");
    if (SEMA_WMS_AUTHKEY) {
      capUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
    }

    const response = await fetch(capUrl.toString());
    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Falha ao carregar capabilities da SEMA (${response.status}): ${text.slice(0, 220)}`
      );
    }
    return response.text();
  };

  const fetchSemamtImageryLayers = async () => {
    const xml = await fetchSemamtCapabilitiesXml();
    const parsedLayers = parseLayersFromCapabilities(xml);
    return toImageryLayers(parsedLayers);
  };

  const decodeDataUrl = (dataUrl: string) => {
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("dataUrl inválido.");
    const mimeType = match[1] || "application/octet-stream";
    const payload = match[2];
    return { mimeType, buffer: Buffer.from(payload, "base64") };
  };

  const parseKmlBbox = (kml: string) => {
    const coordBlocks = [...kml.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
    if (!coordBlocks.length) {
      throw new Error("KML sem bloco <coordinates>.");
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const block of coordBlocks) {
      const raw = String(block[1] || "").trim();
      if (!raw) continue;
      const tuples = raw.split(/\s+/);
      for (const t of tuples) {
        const [xStr, yStr] = t.split(",");
        const x = Number(xStr);
        const y = Number(yStr);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
      throw new Error("Não foi possível extrair coordenadas válidas do KML.");
    }
    return [minX, minY, maxX, maxY] as [number, number, number, number];
  };

  const parseShapefileFirstPolygon = (shpBuffer: Buffer) => {
    // Returns first polygon ring found (lon/lat), limited to avoid oversized payloads.
    if (shpBuffer.length < 120) return null;
    const pointsLimit = 6000;
    let offset = 100; // skip .shp header
    while (offset + 12 <= shpBuffer.length) {
      const contentLengthWords = shpBuffer.readInt32BE(offset + 4);
      const contentLengthBytes = contentLengthWords * 2;
      const recStart = offset + 8;
      const recEnd = recStart + contentLengthBytes;
      if (recEnd > shpBuffer.length || contentLengthBytes < 4) break;

      const shapeType = shpBuffer.readInt32LE(recStart);
      if ((shapeType === 5 || shapeType === 15) && contentLengthBytes >= 44) {
        const numParts = shpBuffer.readInt32LE(recStart + 36);
        const numPoints = shpBuffer.readInt32LE(recStart + 40);
        if (numParts > 0 && numPoints > 2) {
          const partsOffset = recStart + 44;
          const pointsOffset = partsOffset + numParts * 4;
          if (pointsOffset + numPoints * 16 <= recEnd) {
            const partStart = shpBuffer.readInt32LE(partsOffset);
            const partEnd = numParts > 1 ? shpBuffer.readInt32LE(partsOffset + 4) : numPoints;
            const end = Math.min(partEnd, numPoints, partStart + pointsLimit);
            const ring: Array<[number, number]> = [];
            for (let i = partStart; i < end; i += 1) {
              const pOff = pointsOffset + i * 16;
              const x = shpBuffer.readDoubleLE(pOff);
              const y = shpBuffer.readDoubleLE(pOff + 8);
              if (Number.isFinite(x) && Number.isFinite(y)) ring.push([x, y]);
            }
            if (ring.length >= 3) return ring;
          }
        }
      }

      offset = recEnd;
    }
    return null;
  };

  const extractZipEntries = (zipBuffer: Buffer) => {
    // ZIP parser using central directory (supports local headers with data descriptors).
    const entries: Array<{ name: string; data: Buffer }> = [];
    const EOCD_SIG = 0x06054b50;
    const CEN_SIG = 0x02014b50;
    const LOC_SIG = 0x04034b50;
    const maxScan = Math.min(zipBuffer.length, 65557);

    let eocdOffset = -1;
    for (let i = zipBuffer.length - 22; i >= zipBuffer.length - maxScan; i -= 1) {
      if (i < 0) break;
      if (zipBuffer.readUInt32LE(i) === EOCD_SIG) {
        eocdOffset = i;
        break;
      }
    }
    if (eocdOffset < 0) return entries;

    const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
    let cenOffset = centralDirOffset;

    for (let i = 0; i < totalEntries; i += 1) {
      if (cenOffset + 46 > zipBuffer.length) break;
      if (zipBuffer.readUInt32LE(cenOffset) !== CEN_SIG) break;

      const method = zipBuffer.readUInt16LE(cenOffset + 10);
      const compressedSize = zipBuffer.readUInt32LE(cenOffset + 20);
      const fileNameLength = zipBuffer.readUInt16LE(cenOffset + 28);
      const extraLength = zipBuffer.readUInt16LE(cenOffset + 30);
      const commentLength = zipBuffer.readUInt16LE(cenOffset + 32);
      const localHeaderOffset = zipBuffer.readUInt32LE(cenOffset + 42);

      const fileNameStart = cenOffset + 46;
      const fileNameEnd = fileNameStart + fileNameLength;
      if (fileNameEnd > zipBuffer.length) break;
      const fileName = zipBuffer.subarray(fileNameStart, fileNameEnd).toString("utf8");

      if (localHeaderOffset + 30 > zipBuffer.length) {
        cenOffset = fileNameEnd + extraLength + commentLength;
        continue;
      }
      if (zipBuffer.readUInt32LE(localHeaderOffset) !== LOC_SIG) {
        cenOffset = fileNameEnd + extraLength + commentLength;
        continue;
      }
      const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + compressedSize;
      if (dataEnd > zipBuffer.length) {
        cenOffset = fileNameEnd + extraLength + commentLength;
        continue;
      }

      const compressed = zipBuffer.subarray(dataStart, dataEnd);
      let data: Buffer;
      if (method === 0) {
        data = Buffer.from(compressed);
      } else if (method === 8) {
        try {
          data = Buffer.from(inflateRawSync(compressed));
        } catch {
          cenOffset = fileNameEnd + extraLength + commentLength;
          continue;
        }
      } else {
        cenOffset = fileNameEnd + extraLength + commentLength;
        continue;
      }

      entries.push({ name: fileName, data });
      cenOffset = fileNameEnd + extraLength + commentLength;
    }

    return entries;
  };

  app.get("/api/models", (_req, res) => {
    const defaultModel = process.env.GROQ_MODEL || "meta-llama/llama-3.3-70b-versatile";
    res.json({ models: MODEL_CATALOG, defaultModel });
  });

  app.get("/api/map/capabilities", async (_req, res) => {
    try {
      const xml = await fetchSemamtCapabilitiesXml();
      const parsed = parseLayersFromCapabilities(xml);
      const imagery = toImageryLayers(parsed).map((l) => ({
        name: l.name,
        title: l.title,
        crs: l.crs,
        inferredYear: l.inferredYear,
        group: l.group,
      }));
      const shapeLayers = toShapeLayers(parsed).map((l) => ({
        name: l.name,
        title: l.title,
        crs: l.crs,
      }));

      const defaultLayer =
        imagery.find((l) => l.name === "Mosaicos:LANDSAT_5_2008")?.name ||
        imagery.find((l) => l.group === "landsat")?.name ||
        imagery.find((l) => l.group === "spot")?.name ||
        imagery.find((l) => l.group === "sentinel")?.name ||
        imagery[0]?.name;

      res.json({
        serviceTitle: "SEMA WMS",
        layers: imagery,
        imageLayers: imagery,
        shapeLayers,
        defaultLayer,
        recommended: {
          legalMarco2008: "Mosaicos:LANDSAT_5_2008",
        },
      });
    } catch (error: any) {
      console.error("Erro no /api/map/capabilities:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/map/snapshot", async (req, res) => {
    try {
      const {
        layerName,
        overlayLayers = [],
        bbox,
        crs = "EPSG:4326",
        width = 1200,
        height = 800,
        format = "image/png",
      } = req.body as {
        layerName?: string;
        overlayLayers?: string[];
        bbox?: [number, number, number, number];
        crs?: string;
        width?: number;
        height?: number;
        format?: "image/png" | "image/jpeg";
      };

      if (!layerName || !bbox || !Array.isArray(bbox) || bbox.length !== 4) {
        res.status(400).json({ error: "Parâmetros inválidos para snapshot de mapa." });
        return;
      }

      const [minX, minY, maxX, maxY] = bbox.map(Number);
      if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
        res.status(400).json({ error: "BBox inválida." });
        return;
      }

      let availableImagery: Awaited<ReturnType<typeof fetchSemamtImageryLayers>> = [];
      try {
        availableImagery = await fetchSemamtImageryLayers();
      } catch (capErr) {
        console.warn("[/api/map/snapshot] capabilities check failed:", capErr);
      }

      if (availableImagery.length) {
        const allowed = new Set(availableImagery.map((l) => l.name));
        if (!allowed.has(layerName)) {
          res.status(400).json({
            error: `Layer '${layerName}' não é uma camada de mosaico disponível.`,
            availableLayers: availableImagery.slice(0, 50).map((l) => l.name),
          });
          return;
        }
      }

      const safeOverlayLayers = Array.isArray(overlayLayers)
        ? overlayLayers.filter((x) => typeof x === "string" && x.trim().length > 0).slice(0, 8)
        : [];

      const mapUrl = new URL(SEMA_WMS_BASE);
      mapUrl.searchParams.set("service", "WMS");
      mapUrl.searchParams.set("request", "GetMap");
      mapUrl.searchParams.set("version", "1.1.1");
      const allLayers = [layerName, ...safeOverlayLayers];
      mapUrl.searchParams.set("layers", allLayers.join(","));
      mapUrl.searchParams.set("styles", new Array(allLayers.length).fill("").join(","));
      mapUrl.searchParams.set("format", format);
      mapUrl.searchParams.set("transparent", "false");
      mapUrl.searchParams.set("srs", crs);
      mapUrl.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY}`);
      mapUrl.searchParams.set("width", String(Math.max(256, Math.min(4096, Math.floor(width)))));
      mapUrl.searchParams.set("height", String(Math.max(256, Math.min(4096, Math.floor(height)))));
      if (SEMA_WMS_AUTHKEY) {
        mapUrl.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
      }

      const response = await fetch(mapUrl.toString());
      if (!response.ok) {
        const text = await response.text();
        res.status(response.status).json({
          error: "Falha ao obter imagem WMS da SEMA.",
          details: text.slice(0, 500),
        });
        return;
      }

      const contentType = response.headers.get("content-type") || "image/png";
      if (!contentType.includes("image")) {
        const text = await response.text();
        const layerNotDefined = /LayerNotDefined|Could not find layer/i.test(text);
        if (layerNotDefined) {
          const available = availableImagery.slice(0, 50).map((l) => l.name);
          res.status(400).json({
            error: `Layer '${layerName}' não existe no WMS da SEMA.`,
            availableLayers: available,
          });
          return;
        }
        res.status(502).json({
          error: "Resposta do WMS não retornou imagem.",
          details: text.slice(0, 500),
        });
        return;
      }

      const arr = await response.arrayBuffer();
      const base64 = Buffer.from(arr).toString("base64");
      const dataUrl = `data:${contentType};base64,${base64}`;

      res.json({
        dataUrl,
        mimeType: contentType,
        sourceUrl: mapUrl.toString(),
        mapContext: {
          layerName,
          bbox: [minX, minY, maxX, maxY],
          crs,
          width,
          height,
          source: "SEMA_WMS",
        },
      });
    } catch (error: any) {
      console.error("Erro no /api/map/snapshot:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/geometry/bbox", async (req, res) => {
    try {
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }
      const name = String(filename || "").toLowerCase();
      const { mimeType, buffer } = decodeDataUrl(dataUrl);

      if (name.endsWith(".kml") || mimeType.includes("kml") || mimeType.includes("xml")) {
        const text = buffer.toString("utf8");
        const bbox = parseKmlBbox(text);
        res.json({ bbox, crs: "EPSG:4326", source: "kml" });
        return;
      }

      if (name.endsWith(".zip") || mimeType.includes("zip")) {
        const entries = extractZipEntries(buffer);
        const shp = entries.find((e) => e.name.toLowerCase().endsWith(".shp"));
        if (!shp) {
          const kmlInside = entries.find((e) => e.name.toLowerCase().endsWith(".kml"));
          if (kmlInside) {
            const bbox = parseKmlBbox(kmlInside.data.toString("utf8"));
            res.json({ bbox, crs: "EPSG:4326", source: "kml_zip" });
            return;
          }
          res.status(400).json({ error: "ZIP sem .shp ou .kml." });
          return;
        }
        if (shp.data.length < 100) {
          res.status(400).json({ error: "Arquivo .shp inválido." });
          return;
        }
        // Shapefile main header bbox (bytes 36..67 little endian)
        const minX = shp.data.readDoubleLE(36);
        const minY = shp.data.readDoubleLE(44);
        const maxX = shp.data.readDoubleLE(52);
        const maxY = shp.data.readDoubleLE(60);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
          res.status(400).json({ error: "Não foi possível extrair bbox do shapefile." });
          return;
        }
        const polygon = parseShapefileFirstPolygon(shp.data) || undefined;
        res.json({
          bbox: [minX, minY, maxX, maxY],
          polygon,
          crs: "EPSG:4326",
          source: "shapefile_zip_header",
        });
        return;
      }

      res.status(400).json({ error: "Formato não suportado. Envie .kml ou .zip (shapefile)." });
    } catch (error: any) {
      console.error("Erro no /api/geometry/bbox:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  const autoSelectModel = (messages: Array<{ role: string; content: any }>) => {
    let hasImage = false;
    const text = messages
      .map((m) => {
        const content = m.content;
        if (typeof content === "string") return content;
        if (Array.isArray(content)) {
          return content
            .map((part) => {
              if (part?.type === "image_url") hasImage = true;
              if (part?.type === "text") return String(part?.text ?? "");
              return "";
            })
            .join(" ");
        }
        return "";
      })
      .join(" ")
      .toLowerCase();

    const hasVisionCue =
      /(imagem|foto|sat[eé]lite|ortomosaico|drone|a[eé]reo|mapa|png|jpg|jpeg|tif|tiff)/.test(text);
    if (hasImage || hasVisionCue) return "meta-llama/llama-4-maverick-17b-128e-instruct";

    const hasDataCue =
      /(shapefile|shape|geojson|csv|xlsx|planilha|tabela|dados|estat[ií]stica|an[áa]lise)/.test(text);
    if (hasDataCue) return "meta-llama/llama-3.3-70b-versatile";

    return "meta-llama/llama-3.3-70b-versatile";
  };

  const DEFAULT_MODEL = "meta-llama/llama-3.3-70b-versatile";
  const TEMPERATURE = 0.1;
  const MAX_TOKENS = 800;
  const AUTO_MODEL = true;
  const splitThinkProgress = (raw: string) => {
    let visible = "";
    const thinkParts: string[] = [];
    let cursor = 0;

    while (cursor < raw.length) {
      const start = raw.indexOf("<think>", cursor);
      if (start === -1) {
        visible += raw.slice(cursor);
        break;
      }
      visible += raw.slice(cursor, start);
      const thinkStart = start + "<think>".length;
      const end = raw.indexOf("</think>", thinkStart);
      if (end === -1) {
        thinkParts.push(raw.slice(thinkStart));
        break;
      }
      thinkParts.push(raw.slice(thinkStart, end));
      cursor = end + "</think>".length;
    }

    return {
      thinkingText: thinkParts.join("\n\n").trim(),
      answerText: visible.trim(),
    };
  };

  const injectPendingPdfContext = async (
    messages: Array<{ role: string; content: any }>,
    pendingPdf?: { dataUrl?: string; filename?: string }
  ) => {
    if (!pendingPdf?.dataUrl || typeof pendingPdf.dataUrl !== "string") return messages;
    const parts = pendingPdf.dataUrl.split(",");
    if (parts.length !== 2) return messages;

    let extractedText = "";
    try {
      const raw = Buffer.from(parts[1], "base64");
      const parsed = await parsePdfSafe(raw);
      if (parsed?.text) {
        extractedText = (parsed.text || "")
          .replace(/\r/g, "\n")
          .replace(/[ \t]+\n/g, "\n")
          .replace(/\n{3,}/g, "\n\n")
          .trim()
          .slice(0, 25000);
      }
    } catch (err) {
      console.warn("[/api/chat-stream] pendingPdf parse failed:", err);
    }

    const next = [...messages];
    for (let i = next.length - 1; i >= 0; i -= 1) {
      const msg = next[i];
      if (msg.role !== "user") continue;
      const baseText =
        typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content
                .map((part) => (part?.type === "text" ? String(part?.text || "") : ""))
                .join("\n")
            : "";
      const context =
        `\n\nDocumento PDF anexado pelo usuário (${pendingPdf.filename || "documento.pdf"}).` +
        (extractedText
          ? `\nUse o conteúdo extraído abaixo como base:\n${extractedText}`
          : "\nNão foi possível extrair texto automaticamente; informe essa limitação.");
      next[i] = { ...msg, content: `${baseText}${context}`.trim() };
      break;
    }

    return next;
  };

  app.post("/api/chat", async (req, res) => {
    try {
      console.log("[/api/chat] request received");
      const apiKey = process.env.GROQ_API_KEY;
      const defaultModel = DEFAULT_MODEL;
      const temperature = TEMPERATURE;
      const maxTokens = MAX_TOKENS;
      const autoModel = AUTO_MODEL;
      if (!apiKey) {
        console.error("[/api/chat] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY não configurada no servidor." });
        return;
      }

      const { messages, model, pendingPdf } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        console.error("[/api/chat] invalid messages payload");
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }

      const useAuto = model === "auto" || (!model && autoModel);
      const resolvedModel = useAuto ? autoSelectModel(messages) : model || defaultModel;
      if (!MODEL_IDS.has(resolvedModel)) {
        console.error("[/api/chat] model not allowed:", resolvedModel);
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      console.log("[/api/chat] model:", resolvedModel);

      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          temperature,
          max_tokens: maxTokens,
          messages,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/chat] groq error:", response.status, text);
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "";
      console.log("[/api/chat] success");
      res.json({ content, model: resolvedModel });
    } catch (error: any) {
      console.error("Erro no /api/chat:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/chat-stream", async (req, res) => {
    try {
      console.log("[/api/chat-stream] request received");
      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        console.error("[/api/chat-stream] GROQ_API_KEY missing");
        res.status(500).json({ error: "GROQ_API_KEY não configurada no servidor." });
        return;
      }

      const { messages, model, pendingPdf } = req.body as {
        messages?: Array<{ role: string; content: any }>;
        model?: string;
        pendingPdf?: { dataUrl?: string; filename?: string };
      };
      if (!messages || !Array.isArray(messages) || messages.length === 0) {
        res.status(400).json({ error: "Mensagens inválidas." });
        return;
      }

      const messagesForModel = await injectPendingPdfContext(messages, pendingPdf);

      const useAuto = model === "auto" || (!model && AUTO_MODEL);
      const resolvedModel = useAuto ? autoSelectModel(messagesForModel) : model || DEFAULT_MODEL;
      if (!MODEL_IDS.has(resolvedModel)) {
        res.status(400).json({ error: "Modelo não permitido." });
        return;
      }

      const upstream = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: resolvedModel,
          temperature: TEMPERATURE,
          max_tokens: MAX_TOKENS,
          stream: true,
          messages: messagesForModel,
        }),
      });

      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        console.error("[/api/chat-stream] groq error:", upstream.status, text);
        res.status(upstream.status || 500).json({ error: text || "Erro no streaming da IA." });
        return;
      }

      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();

      const writeChunk = (payload: Record<string, any>) => {
        res.write(`${JSON.stringify(payload)}\n`);
      };

      let rawModelText = "";
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data) continue;
          if (data === "[DONE]") {
            const finalSplit = splitThinkProgress(rawModelText);
            writeChunk({
              type: "done",
              model: resolvedModel,
              thinkingText: finalSplit.thinkingText,
              content: finalSplit.answerText,
            });
            res.end();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const delta = parsed?.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              rawModelText += delta;
              const split = splitThinkProgress(rawModelText);
              writeChunk({
                type: "delta",
                model: resolvedModel,
                thinkingText: split.thinkingText,
                content: split.answerText,
              });
            }
          } catch {
            // Ignore malformed data chunks from upstream
          }
        }
      }

      const finalSplit = splitThinkProgress(rawModelText);
      res.write(
        encoder.encode(
          `${JSON.stringify({
            type: "done",
            model: resolvedModel,
            thinkingText: finalSplit.thinkingText,
            content: finalSplit.answerText,
          })}\n`
        )
      );
      res.end();
    } catch (error: any) {
      console.error("Erro no /api/chat-stream:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: error?.message || "Erro interno" });
      } else {
        res.end();
      }
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, ts: Date.now() });
  });

  app.get("/api/runtime/version", (_req, res) => {
    res.json({
      ok: true,
      ts: Date.now(),
      node: process.version,
      env: process.env.NODE_ENV || "development",
      hasChatStream: true,
      hasGeometryBbox: true,
      hasMapSnapshot: true,
      hasMapCapabilities: true,
    });
  });

  app.post("/api/upload-image", async (req, res) => {
    try {
      console.log("[/api/upload-image] request received");
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        console.error("[/api/upload-image] Cloudinary missing keys");
        res.status(500).json({ error: "Cloudinary não configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        console.error("[/api/upload-image] dataUrl missing");
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = filename
        ? `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_")
        : undefined;

      const paramsToSign: Record<string, string> = { timestamp: String(timestamp) };
      if (folder) paramsToSign.folder = folder;
      if (publicId) paramsToSign.public_id = publicId;

      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = crypto
        .createHash("sha1")
        .update(signatureBase + apiSecret)
        .digest("hex");

      const form = new FormData();
      form.append("file", dataUrl);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      if (folder) form.append("folder", folder);
      if (publicId) form.append("public_id", publicId);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
      const response = await fetch(uploadUrl, { method: "POST", body: form });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/upload-image] cloudinary error:", response.status, text);
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      console.log("[/api/upload-image] success:", data?.public_id);
      res.json({
        public_id: data.public_id,
        secure_url: data.secure_url,
        width: data.width,
        height: data.height,
        format: data.format,
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-image:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.post("/api/upload-file", async (req, res) => {
    try {
      console.log("[/api/upload-file] request received");
      const cloudName = "da19dwpgk";
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      const folder = process.env.CLOUDINARY_FOLDER;

      if (!apiKey || !apiSecret) {
        console.error("[/api/upload-file] Cloudinary missing keys");
        res.status(500).json({ error: "Cloudinary não configurado." });
        return;
      }

      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        console.error("[/api/upload-file] dataUrl missing");
        res.status(400).json({ error: "dataUrl é obrigatório." });
        return;
      }

      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (!match) {
        res.status(400).json({ error: "dataUrl de PDF inválido." });
        return;
      }
      const mimeType = match[1] || "application/pdf";
      const base64Payload = match[2];
      const fileBuffer = Buffer.from(base64Payload, "base64");

      let extractedText = "";
      let pageCount = 0;
      try {
        const parsed = await parsePdfSafe(fileBuffer);
        if (parsed?.text) {
          extractedText = (parsed.text || "")
            .replace(/\r/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
          pageCount = Number(parsed?.numpages || 0);
        }
      } catch (err) {
        console.warn("[/api/upload-file] failed to parse PDF text:", err);
      }

      const timestamp = Math.floor(Date.now() / 1000);
      const publicId = filename
        ? `${Date.now()}-${filename}`.replace(/[^a-zA-Z0-9-_]/g, "_")
        : undefined;

      const paramsToSign: Record<string, string> = { timestamp: String(timestamp) };
      if (folder) paramsToSign.folder = folder;
      if (publicId) paramsToSign.public_id = publicId;

      const signatureBase = Object.keys(paramsToSign)
        .sort()
        .map((key) => `${key}=${paramsToSign[key]}`)
        .join("&");
      const signature = crypto
        .createHash("sha1")
        .update(signatureBase + apiSecret)
        .digest("hex");

      const form = new FormData();
      const blob = new Blob([fileBuffer], { type: mimeType });
      const uploadFilename = filename && filename.toLowerCase().endsWith(".pdf")
        ? filename
        : `${filename || "documento"}.pdf`;
      form.append("file", blob, uploadFilename);
      form.append("api_key", apiKey);
      form.append("timestamp", String(timestamp));
      form.append("signature", signature);
      form.append("resource_type", "raw");
      if (folder) form.append("folder", folder);
      if (publicId) form.append("public_id", publicId);

      const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`;
      const response = await fetch(uploadUrl, { method: "POST", body: form });

      if (!response.ok) {
        const text = await response.text();
        console.error("[/api/upload-file] cloudinary error:", response.status, text);
        res.status(response.status).json({ error: text });
        return;
      }

      const data = await response.json();
      console.log("[/api/upload-file] success:", data?.public_id);
      const secureUrl = String(data?.secure_url || "");
      const fallbackExt = String(data?.format || "pdf").toLowerCase();
      const safeAttachmentName = String(filename || `arquivo.${fallbackExt}`).replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      const downloadUrl = secureUrl.includes("/upload/")
        ? secureUrl.replace(
            "/upload/",
            `/upload/fl_attachment:${encodeURIComponent(safeAttachmentName)}/`
          )
        : secureUrl;
      res.json({
        public_id: data.public_id,
        secure_url: secureUrl,
        download_url: downloadUrl,
        original_filename: safeAttachmentName,
        format: data.format,
        bytes: data.bytes,
        pages: pageCount,
        extracted_text: extractedText.slice(0, 25000),
      });
    } catch (error: any) {
      console.error("Erro no /api/upload-file:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  app.get("/api/file-proxy", async (req, res) => {
    try {
      const mode = String(req.query.mode || "inline");
      const remoteUrl = String(req.query.url || "");
      const name = String(req.query.name || "arquivo.pdf").replace(/[^a-zA-Z0-9._-]/g, "_");

      if (!remoteUrl || !remoteUrl.startsWith("https://res.cloudinary.com/da19dwpgk/")) {
        res.status(400).json({ error: "URL de arquivo inválida." });
        return;
      }

      const upstream = await fetch(remoteUrl);
      if (!upstream.ok || !upstream.body) {
        const text = await upstream.text();
        res.status(upstream.status || 502).send(text || "Falha ao obter arquivo.");
        return;
      }

      const isAttachment = mode === "download";
      const contentType = name.toLowerCase().endsWith(".pdf")
        ? "application/pdf"
        : upstream.headers.get("content-type") || "application/octet-stream";
      res.setHeader("Content-Type", contentType);
      res.setHeader(
        "Content-Disposition",
        `${isAttachment ? "attachment" : "inline"}; filename="${name}"`
      );
      res.setHeader("Cache-Control", "private, max-age=300");

      const reader = upstream.body.getReader();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
      res.end();
    } catch (error: any) {
      console.error("Erro no /api/file-proxy:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });

  // Serve static files from dist/public in production
  const staticPath =
    process.env.NODE_ENV === "production"
      ? path.resolve(__dirname, "public")
      : path.resolve(__dirname, "..", "dist", "public");

  app.use(express.static(staticPath));

  // Handle client-side routing - serve index.html for all routes
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port =
    process.env.PORT || (process.env.NODE_ENV === "production" ? 3000 : 3001);

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  const keepAliveUrl = process.env.KEEP_ALIVE_URL;
  const keepAliveInterval = Number(process.env.KEEP_ALIVE_INTERVAL_MS ?? "840000"); // 14 min
  if (keepAliveUrl) {
    setInterval(async () => {
      try {
        await fetch(keepAliveUrl, { method: "GET" });
      } catch (err) {
        console.warn("Keep-alive falhou:", err);
      }
    }, keepAliveInterval).unref();
  }
}

startServer().catch(console.error);
