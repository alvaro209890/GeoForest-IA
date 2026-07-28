import PDFDocument from "pdfkit";
import type { MultiPolygon, Polygon, Position } from "geojson";
import type { CroquiRoute } from "./routing";

const PAGE_W = 842;
const PAGE_H = 595;
const HEADER_H = 92;

function expandBbox(
  coords: Position[],
  paddingRatio = 0.1,
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
  const x = ((lon - minX) / (maxX - minX)) * PAGE_W;
  const y = PAGE_H - ((lat - minY) / (maxY - minY)) * PAGE_H;
  return [x, y];
}

async function fetchMapImage(bbox: [number, number, number, number]): Promise<Buffer | null> {
  const [minX, minY, maxX, maxY] = bbox;
  const url =
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
    `?bbox=${minX},${minY},${maxX},${maxY}&bboxSR=4326&imageSR=4326&size=1684,1190&format=jpg&f=image`;
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

function drawYellowPin(doc: InstanceType<typeof PDFDocument>, x: number, y: number): void {
  doc.save();
  doc.fillColor("#ffff00").strokeColor("#333333").lineWidth(0.6);
  doc.circle(x, y - 4, 4).fillAndStroke();
  doc.moveTo(x, y).lineTo(x - 3, y + 8).lineTo(x + 3, y + 8).closePath().fillAndStroke();
  doc.restore();
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

    doc.rect(0, 0, PAGE_W, PAGE_H).fill("#d8dde0");
    if (mapImage) {
      try {
        doc.image(mapImage, 0, 0, { width: PAGE_W, height: PAGE_H });
      } catch {
        // fallback sem imagem
      }
    }

    doc.save();
    doc.lineWidth(3.5).strokeColor("#ff0000");
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

    doc.lineWidth(2.5).strokeColor("#00ffff");
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

    for (const w of route.waypoints) {
      const [x, y] = project(w.lon, w.lat, bbox);
      drawYellowPin(doc, x, y);
    }
    doc.restore();

    doc.save();
    doc.fillColor("#ffffff").fillOpacity(0.9);
    doc.rect(0, 0, PAGE_W, HEADER_H).fill();
    doc.fillOpacity(1);
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000000");
    doc.text(title, 21, 24, { width: 480, lineBreak: false });

    doc.font("Helvetica-Bold").fontSize(10);
    doc.text("Legenda", 726, 21, { width: 100, align: "left", lineBreak: false });
    doc.text("Caminho", 749, 41, { width: 80, align: "left", lineBreak: false });
    doc.text("Coordenadas", 749, 58, { width: 80, align: "left", lineBreak: false });

    doc.font("Helvetica").fontSize(9).fillColor("#000000");
    doc.text(narrative.replace(/\s+/g, " "), 21, 49, {
      width: 500,
      lineGap: 1.5,
    });

    doc.font("Helvetica").fontSize(7.5);
    doc.text(coordinateLines.join("\n"), 580, 72, {
      width: 240,
      lineGap: 0.5,
      align: "left",
    });

    const northX = PAGE_W - 42;
    const northY = PAGE_H - 58;
    doc.font("Helvetica-Bold").fontSize(13).fillColor("#000");
    doc.text("N", northX, northY, { lineBreak: false });
    doc.lineWidth(1.5).strokeColor("#000");
    doc.moveTo(northX + 5, northY + 14).lineTo(northX + 5, northY + 32).stroke();
    doc.moveTo(northX + 5, northY + 14).lineTo(northX + 1, northY + 20).stroke();
    doc.moveTo(northX + 5, northY + 14).lineTo(northX + 9, northY + 20).stroke();

    const scaleX = 24;
    const scaleY = PAGE_H - 28;
    const scaleBarW = 72;
    doc.lineWidth(2).strokeColor("#000");
    doc.moveTo(scaleX, scaleY).lineTo(scaleX + scaleBarW, scaleY).stroke();
    doc.font("Helvetica").fontSize(8).fillColor("#000");
    doc.text(`${scaleKm} km`, scaleX, scaleY + 3, { lineBreak: false });

    doc.font("Helvetica").fontSize(7).fillColor("#ffffff");
    doc.text("Image Airbus", PAGE_W - 120, PAGE_H - 14, { width: 110, align: "right", lineBreak: false });

    doc.end();
  });
}
