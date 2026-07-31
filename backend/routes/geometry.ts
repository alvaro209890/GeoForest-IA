import { Express, Request, Response } from "express";
import { decodeDataUrl, parseKmlBbox } from "../lib/map-utils";
import {
  extractZipEntries,
  isLatLonBbox,
  detectUtmProj,
  reprojectPolygon,
  reprojectBbox,
} from "../geo-utils";
import { parseShapefileFirstPolygon } from "../lib/map-utils";

export function registerGeometryRoutes(app: Express) {

  app.post("/api/geometry/bbox", async (req, res) => {
    try {
      const { dataUrl, filename } = req.body as { dataUrl?: string; filename?: string };
      if (!dataUrl || typeof dataUrl !== "string") {
        res.status(400).json({ error: "dataUrl Ã© obrigatÃ³rio." });
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
        const prj = entries.find((e) => e.name.toLowerCase().endsWith(".prj"));
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
          res.status(400).json({ error: "Arquivo .shp invÃ¡lido." });
          return;
        }
        // Shapefile main header bbox (bytes 36..67 little endian)
        const minX = shp.data.readDoubleLE(36);
        const minY = shp.data.readDoubleLE(44);
        const maxX = shp.data.readDoubleLE(52);
        const maxY = shp.data.readDoubleLE(60);
        if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
          res.status(400).json({ error: "NÃ£o foi possÃ­vel extrair bbox do shapefile." });
          return;
        }
        const polygon = parseShapefileFirstPolygon(shp.data) || undefined;
        let bbox: [number, number, number, number] = [minX, minY, maxX, maxY];
        let polygonOut = polygon;
        let crs = "EPSG:4326";
        if (!isLatLonBbox(bbox) && prj?.data) {
          const projDef = detectUtmProj(prj.data.toString("utf8"));
          if (projDef) {
            bbox = reprojectBbox(bbox, projDef);
            if (polygonOut) {
              polygonOut = reprojectPolygon(polygonOut, projDef);
            }
            crs = "EPSG:4326";
          }
        }
        res.json({
          bbox,
          polygon: polygonOut,
          crs,
          source: "shapefile_zip_header",
        });
        return;
      }
  
      res.status(400).json({ error: "Formato nÃ£o suportado. Envie .kml ou .zip (shapefile)." });
    } catch (error: any) {
      console.error("Erro no /api/geometry/bbox:", error);
      res.status(500).json({ error: error?.message || "Erro interno" });
    }
  });
}