import PDFDocument from "pdfkit";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { CroquiRoute } from "./routing";

const PAGE_W = 842;
const PAGE_H = 595;
const MAP_X = 28;
const MAP_Y = 28;
const MAP_W = 500;
const MAP_H = 539;
const PANEL_X = 540;
const PANEL_W = PAGE_W - PANEL_X - 28;

function expandBbox(
  coords: Position[],
  paddingRatio = 0.12,
): [number, number, number, number] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of coords) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const padX = (maxX - minX) * paddingRatio || 0.02;
  const padY = (maxY - minY) * paddingRatio || 0.02;
  return [minX - padX, minY - padY, maxX + padX, maxY + padY];
}

function project(
  lon: number,
  lat: number,
  bbox: [number, number, number, number],
): [number, number] {
  const [minX, minY, maxX, maxY] = bbox;
  const x = MAP_X + ((lon - minX) / (maxX - minX)) * MAP_W;
  const y = MAP_Y + MAP_H - ((lat - minY) / (maxY - minY)) * MAP_H;
  return [x, y];
}

async function fetchMapImage(bbox: [number, number, number, number]): Promise<Buffer | null> {
  const [minX, minY, maxX, maxY] = bbox;
  const url =
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
    `?bbox=${minX},${minY},${maxX},${maxY}&bboxSR=4326&imageSR=4326&size=1200,900&format=png&f=image`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 1000 ? buf : null;
  } catch {
    return null;
  }
}

function pickScaleKm(bbox: [number, number, number, number]): number {
  const [minX, minY, maxX, maxY] = bbox;
  const widthDeg = maxX - minX;
  const km = widthDeg * 111 * Math.cos((((minY + maxY) / 2) * Math.PI) / 180);
  if (km <= 12) return 7;
  if (km <= 25) return 15;
  if (km <= 50) return 40;
  return Math.round(km / 4);
}

function polygonRings(geometry: Polygon | MultiPolygon): Position[][] {
  if (geometry.type === "Polygon") return [geometry.coordinates[0]];
  return geometry.coordinates.map((p) => p[0]);
}

export async function buildCroquiPdfBuffer(args: {
  title: string;
  narrative: string;
  coordinateLines: string[];
  atpGeometry: Polygon | MultiPolygon;
  route: CroquiRoute;
}): Promise<Buffer> {
  const { title, narrative, coordinateLines, atpGeometry, route } = args;
  const allCoords: Position[] = [...route.coordinates];
  for (const ring of polygonRings(atpGeometry)) allCoords.push(...ring);
  const bbox = expandBbox(allCoords);
  const mapImage = await fetchMapImage(bbox);
  const scaleKm = pickScaleKm(bbox);

  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

    doc.rect(MAP_X, MAP_Y, MAP_W, MAP_H).fill("#e8ecef");
    if (mapImage) {
      try {
        doc.image(mapImage, MAP_X, MAP_Y, { width: MAP_W, height: MAP_H });
      } catch {
        // fallback sem imagem
      }
    }

    doc.save();
    doc.lineWidth(3).strokeColor("#ff0000");
    const routePts = route.coordinates;
    if (routePts.length >= 2) {
      const [x0, y0] = project(routePts[0][0], routePts[0][1], bbox);
      doc.moveTo(x0, y0);
      for (let i = 1; i < routePts.length; i++) {
        const [x, y] = project(routePts[i][0], routePts[i][1], bbox);
        doc.lineTo(x, y);
      }
      doc.stroke();
    }

    doc.lineWidth(2).strokeColor("#00ffff");
    for (const ring of polygonRings(atpGeometry)) {
      if (ring.length < 3) continue;
      const [fx, fy] = project(ring[0][0], ring[0][1], bbox);
      doc.moveTo(fx, fy);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = project(ring[i][0], ring[i][1], bbox);
        doc.lineTo(x, y);
      }
      doc.closePath().stroke();
    }

    doc.fillColor("#ff0000");
    for (const w of args.route.waypoints) {
      const [x, y] = project(w.lon, w.lat, bbox);
      doc.circle(x, y, 3).fill();
    }
    doc.restore();

    doc.rect(PANEL_X, MAP_Y, PANEL_W, MAP_H).fill("#ffffff");
    doc.fillColor("#1f4e79").font("Helvetica-Bold").fontSize(18);
    doc.text(title, PANEL_X + 12, MAP_Y + 14, { width: PANEL_W - 24 });

    doc.font("Helvetica-Bold").fontSize(11).fillColor("#1f4e79");
    doc.text("Legenda", PANEL_X + 12, MAP_Y + 48);
    doc.font("Helvetica-Bold").fontSize(10).text("Caminho", PANEL_X + 12, MAP_Y + 64);

    doc.font("Helvetica").fontSize(8.5).fillColor("#000000");
    doc.text(narrative.replace(/\n/g, " "), PANEL_X + 12, MAP_Y + 78, {
      width: PANEL_W - 24,
      lineGap: 2,
    });

    const coordY = MAP_Y + 280;
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#1f4e79");
    doc.text("Coordenadas", PANEL_X + 12, coordY);
    doc.font("Helvetica").fontSize(8).fillColor("#000000");
    doc.text(coordinateLines.join("\n"), PANEL_X + 12, coordY + 14, {
      width: PANEL_W - 24,
      lineGap: 1,
    });

    const northX = PANEL_X + PANEL_W - 50;
    const northY = MAP_Y + MAP_H - 70;
    doc.font("Helvetica-Bold").fontSize(14).fillColor("#000").text("N", northX, northY);
    doc.moveTo(northX + 6, northY + 18).lineTo(northX + 6, northY + 38).stroke();
    doc.moveTo(northX + 6, northY + 18).lineTo(northX + 2, northY + 24).stroke();
    doc.moveTo(northX + 6, northY + 18).lineTo(northX + 10, northY + 24).stroke();

    const scaleX = PANEL_X + 12;
    const scaleY = MAP_Y + MAP_H - 36;
    const scaleBarW = 80;
    doc.lineWidth(2).strokeColor("#000");
    doc.moveTo(scaleX, scaleY).lineTo(scaleX + scaleBarW, scaleY).stroke();
    doc.font("Helvetica").fontSize(9).fillColor("#000");
    doc.text(`${scaleKm} km`, scaleX, scaleY + 4);

    doc.font("Helvetica").fontSize(7).fillColor("#666666");
    doc.text("Image Landsat / Copernicus", PANEL_X + 12, MAP_Y + MAP_H - 14, {
      width: PANEL_W - 24,
      align: "right",
    });

    doc.end();
  });
}
