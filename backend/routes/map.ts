import { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import {
  getMapCapabilitiesData,
  getCachedMapSnapshot,
  storeMapSnapshot,
  SEMA_WMS_BASE,
  SEMA_WMS_AUTHKEY,
} from "../lib/map-utils";
import type { MapSnapshotPayload } from "../lib/map-utils";
import { chargeMapSnapshot } from "../billing";
import { createRequestId } from "../billing";

export function registerMapRoutes(app: Express) {

  app.get("/api/map/capabilities", async (_req, res) => {
    try {
      console.log("[API] GET /api/map/capabilities â€” iniciando...");
      const capabilities = await getMapCapabilitiesData();
      const payload = capabilities.payload;
      if (!payload) {
        throw new Error("Falha ao montar payload de capabilities.");
      }
      console.log(`[API] Default layer: ${payload.defaultLayer}`);
      console.log("[API] GET /api/map/capabilities â€” sucesso");
      res.setHeader("Cache-Control", "public, max-age=120");
      res.json(payload);
    } catch (error: any) {
      console.error("Erro no /api/map/capabilities:", error?.message || error);
      console.error("Stack:", error?.stack);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });
  
  app.post("/api/map/snapshot", requireAuth, async (req, res) => {
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
  
      console.log(`[API] POST /api/map/snapshot â€” layer=${layerName}, bbox=${JSON.stringify(bbox)}, overlays=${JSON.stringify(overlayLayers)}, size=${width}x${height}`);
  
      if (!layerName || !bbox || !Array.isArray(bbox) || bbox.length !== 4) {
        res.status(400).json({ error: "ParÃ¢metros invÃ¡lidos para snapshot de mapa." });
        return;
      }
  
      const [minX, minY, maxX, maxY] = bbox.map(Number);
      if (![minX, minY, maxX, maxY].every(Number.isFinite) || minX >= maxX || minY >= maxY) {
        res.status(400).json({ error: "BBox invÃ¡lida." });
        return;
      }
  
      const safeWidth = Math.max(256, Math.min(4096, Math.floor(Number(width) || 1200)));
      const safeHeight = Math.max(256, Math.min(4096, Math.floor(Number(height) || 800)));
      const safeFormat = format === "image/jpeg" ? "image/jpeg" : "image/png";
      const safeCrs = typeof crs === "string" && crs.trim().length ? crs.trim() : "EPSG:4326";
      const normalizedLayerName = String(layerName);
      const safeOverlayLayers = Array.isArray(overlayLayers)
        ? [...new Set(overlayLayers.map((x) => String(x).trim()).filter((x) => x.length > 0))].slice(
          0,
          8,
        )
        : [];
      const snapshotCacheKey = [
        normalizedLayerName,
        safeOverlayLayers.join(","),
        `${minX},${minY},${maxX},${maxY}`,
        safeCrs,
        `${safeWidth}x${safeHeight}`,
        safeFormat,
      ].join("|");
      const cachedSnapshot = getCachedMapSnapshot(snapshotCacheKey);
      if (cachedSnapshot) {
        res.setHeader("Cache-Control", "public, max-age=60");
        res.setHeader("x-map-cache", "hit");
        res.json(cachedSnapshot);
        return;
      }
  
      let capabilities: Awaited<ReturnType<typeof getMapCapabilitiesData>> | null = null;
      try {
        capabilities = await getMapCapabilitiesData();
      } catch (capErr) {
        console.warn("[/api/map/snapshot] capabilities check failed:", capErr);
      }
      if (
        capabilities?.allowedLayerNames &&
        !capabilities.allowedLayerNames.has(normalizedLayerName.toLowerCase())
      ) {
        res.status(400).json({
          error: `Layer '${normalizedLayerName}' nÃ£o Ã© uma camada disponÃ­vel.`,
          availableLayers: capabilities.payload?.imageLayers.slice(0, 50).map((l) => l.name) || [],
        });
        return;
      }
  
      const mapUrl = new URL(SEMA_WMS_BASE);
      mapUrl.searchParams.set("service", "WMS");
      mapUrl.searchParams.set("request", "GetMap");
      mapUrl.searchParams.set("version", "1.1.1");
      const allLayers = [normalizedLayerName, ...safeOverlayLayers];
      mapUrl.searchParams.set("layers", allLayers.join(","));
      mapUrl.searchParams.set("styles", new Array(allLayers.length).fill("").join(","));
      mapUrl.searchParams.set("format", safeFormat);
      mapUrl.searchParams.set("transparent", "false");
      mapUrl.searchParams.set("srs", safeCrs);
      mapUrl.searchParams.set("bbox", `${minX},${minY},${maxX},${maxY}`);
      mapUrl.searchParams.set("width", String(safeWidth));
      mapUrl.searchParams.set("height", String(safeHeight));
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
          const available =
            capabilities?.payload?.imageLayers.slice(0, 50).map((l) => l.name) || [];
          res.status(400).json({
            error: `Layer '${normalizedLayerName}' nÃ£o existe no WMS da SEMA.`,
            availableLayers: available,
          });
          return;
        }
        res.status(502).json({
          error: "Resposta do WMS nÃ£o retornou imagem.",
          details: text.slice(0, 500),
        });
        return;
      }
  
      const arr = await response.arrayBuffer();
      const base64 = Buffer.from(arr).toString("base64");
      const dataUrl = `data:${contentType};base64,${base64}`;
      const payload: MapSnapshotPayload = {
        dataUrl,
        mimeType: contentType,
        sourceUrl: mapUrl.toString(),
        mapContext: {
          layerName: normalizedLayerName,
          bbox: [minX, minY, maxX, maxY],
          crs: safeCrs,
          width: safeWidth,
          height: safeHeight,
          source: "SEMA_WMS",
        },
      };
      storeMapSnapshot(snapshotCacheKey, payload);
  
      // Cobrar pelo processamento de mapa em background para não travar a UI
      if (req.authUid) {
        chargeMapSnapshot({
          uid: req.authUid,
          requestId: createRequestId("mapsnap"),
          endpoint: "/api/map/snapshot",
          feeBrl: 0.05
        }).catch(err => console.warn("[BILLING] Erro ao cobrar snapshot de mapa do usuário", req.authUid, err));
      }
  
      res.setHeader("Cache-Control", "public, max-age=60");
      res.setHeader("x-map-cache", "miss");
      res.json(payload);
    } catch (error: any) {
      console.error("Erro no /api/map/snapshot:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });
}