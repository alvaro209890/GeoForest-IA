import PDFDocument from "pdfkit";
import type { MultiPolygon, Polygon, Position } from "geojson";
import { ylwPushpinPng } from "./assets/ylw-pushpin-data";
import { bboxOfPositions, fetchBasemapImage, pickScaleBar, resolveMapFrame } from "./basemap";
import type { BasemapProvider, MapFrame } from "./basemap";
import { formatDmsLabel } from "./coords";
import { sedesNaBbox } from "./landmarks";
import type { PlaceLabel } from "./landmarks";
import type { CroquiRoute } from "./routing";

/**
 * Layout dos croquis modelo (pasta `Croquis/`): A4 paisagem com o mapa ocupando
 * a página inteira, caixa branca do roteiro sobreposta no topo-esquerdo, caixa
 * "Legenda" no topo-direito, seta N e barra de escala no canto inferior direito.
 */

const PAGE_W = 842;
const PAGE_H = 595;
const MAP_MARGIN = 8;
const MAP_X = MAP_MARGIN;
const MAP_Y = MAP_MARGIN;
const MAP_W = PAGE_W - MAP_MARGIN * 2;
const MAP_H = PAGE_H - MAP_MARGIN * 2;

const BOX_INSET = 6;
const BOX_PAD = 8;
const LEGEND_W = 118;
const LEGEND_H = 56;

const ROUTE_COLOR = "#ff5500";
const POLYGON_COLOR = "#ff0000";

/** Ícone oficial `ylw-pushpin.png` do Google Earth (64×64). */
const PIN_ICON_PX = 64;
/** Hotspot KML: x=20, y=2 a partir da base — mesma âncora do `render-kml.ts`. */
const PIN_HOTSPOT_X_PX = 20;
const PIN_HOTSPOT_Y_FROM_BOTTOM_PX = 2;
/** Tamanho do pin no mapa (pt). Casado visualmente com os croquis exportados do GE Pro. */
const PIN_SIZE_PT = 24;
const PIN_LEGEND_SIZE_PT = 14;

type Doc = InstanceType<typeof PDFDocument>;
type Rect = { x: number; y: number; w: number; h: number };

let pushpinBuffer: Buffer | null = null;

/** Preferência: bytes embutidos (bundle esbuild). Fallback: PNG em disco. */
function loadPushpinPng(): Buffer {
  if (pushpinBuffer) return pushpinBuffer;
  pushpinBuffer = ylwPushpinPng();
  return pushpinBuffer;
}

function polygonRings(geometry: Polygon | MultiPolygon): Position[][] {
  if (geometry.type === "Polygon") return geometry.coordinates;
  return geometry.coordinates.flat();
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function insideMap(rect: Rect): boolean {
  return (
    rect.x >= MAP_X &&
    rect.y >= MAP_Y &&
    rect.x + rect.w <= MAP_X + MAP_W &&
    rect.y + rect.h <= MAP_Y + MAP_H
  );
}

/** Texto branco com contorno escuro, como os rótulos do Google Earth. */
function haloText(doc: Doc, text: string, x: number, y: number): void {
  doc.save();
  doc.fillColor("#1a1a1a");
  for (const [dx, dy] of [
    [-0.7, 0],
    [0.7, 0],
    [0, -0.7],
    [0, 0.7],
  ]) {
    doc.text(text, x + dx, y + dy, { lineBreak: false });
  }
  doc.fillColor("#ffffff");
  doc.text(text, x, y, { lineBreak: false });
  doc.restore();
}

/**
 * Pushpin amarelo oficial do Google Earth (`ylw-pushpin.png`), ancorado na
 * ponta da agulha — o mesmo ícone e hotspot do KML.
 */
function drawPushpin(doc: Doc, x: number, y: number, sizePt = PIN_SIZE_PT): void {
  const scale = sizePt / PIN_ICON_PX;
  const drawX = x - PIN_HOTSPOT_X_PX * scale;
  const drawY = y - (PIN_ICON_PX - PIN_HOTSPOT_Y_FROM_BOTTOM_PX) * scale;
  doc.save();
  doc.image(loadPushpinPng(), drawX, drawY, { width: sizePt, height: sizePt });
  doc.restore();
}

function drawWhiteBox(doc: Doc, rect: Rect): void {
  doc.save();
  doc.fillOpacity(0.93).fillColor("#ffffff");
  doc.rect(rect.x, rect.y, rect.w, rect.h).fill();
  doc.fillOpacity(1).lineWidth(0.6).strokeColor("#8c8c8c");
  doc.rect(rect.x, rect.y, rect.w, rect.h).stroke();
  doc.restore();
}

function drawLegend(doc: Doc, rect: Rect): void {
  drawWhiteBox(doc, rect);
  doc.save();
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#000000");
  doc.text("Legenda", rect.x, rect.y + 7, { width: rect.w, align: "center", lineBreak: false });

  const iconX = rect.x + 14;
  const pathY = rect.y + 27;
  doc.lineWidth(1.6).strokeColor(ROUTE_COLOR);
  doc.moveTo(iconX - 5, pathY + 3).lineTo(iconX, pathY - 2).lineTo(iconX + 5, pathY + 2).stroke();
  doc.fillColor(ROUTE_COLOR);
  for (const [cx, cy] of [
    [iconX - 5, pathY + 3],
    [iconX, pathY - 2],
    [iconX + 5, pathY + 2],
  ]) {
    doc.circle(cx, cy, 1.5).fill();
  }
  doc.font("Helvetica").fontSize(9).fillColor("#000000");
  doc.text("Caminho", rect.x + 28, pathY - 3.5, { lineBreak: false });

  const pinY = rect.y + 46;
  drawPushpin(doc, iconX, pinY + 2, PIN_LEGEND_SIZE_PT);
  doc.font("Helvetica").fontSize(9).fillColor("#000000");
  doc.text("Coordenadas", rect.x + 28, pinY - 3.5, { lineBreak: false });
  doc.restore();
}

function drawNorthArrow(doc: Doc, cx: number, baseY: number): void {
  doc.save();
  doc.lineJoin("round");
  const tipY = baseY - 26;
  const path = () => {
    doc.moveTo(cx - 7, baseY - 12);
    doc.lineTo(cx, tipY);
    doc.lineTo(cx + 7, baseY - 12);
    doc.lineTo(cx, baseY - 17);
    doc.closePath();
  };
  path();
  doc.lineWidth(2.6).strokeColor("#ffffff").stroke();
  path();
  doc.fillColor("#000000").fill();

  doc.font("Helvetica-Bold").fontSize(14);
  doc.fillColor("#ffffff");
  for (const [dx, dy] of [
    [-0.8, 0],
    [0.8, 0],
    [0, -0.8],
    [0, 0.8],
  ]) {
    doc.text("N", cx - 6 + dx, baseY - 11 + dy, { width: 12, align: "center", lineBreak: false });
  }
  doc.fillColor("#000000");
  doc.text("N", cx - 6, baseY - 11, { width: 12, align: "center", lineBreak: false });
  doc.restore();
}

function drawScaleBar(doc: Doc, frame: MapFrame, rightX: number, baseY: number): void {
  const bar = pickScaleBar(frame.metersPerPoint, 150);
  doc.save();
  doc.font("Helvetica").fontSize(8.5);
  const labelW = doc.widthOfString(bar.label) + 6;
  const boxW = bar.widthPt + labelW + 14;
  const boxH = 15;
  const boxX = rightX - boxW;
  const boxY = baseY - boxH;

  doc.fillOpacity(0.88).fillColor("#ffffff");
  doc.rect(boxX, boxY, boxW, boxH).fill();
  doc.fillOpacity(1);

  const lineY = boxY + boxH / 2;
  const lineX = boxX + 7;
  doc.lineWidth(1.2).strokeColor("#000000");
  doc.moveTo(lineX, lineY).lineTo(lineX + bar.widthPt, lineY).stroke();
  doc.moveTo(lineX, lineY - 3.5).lineTo(lineX, lineY + 3.5).stroke();
  doc.moveTo(lineX + bar.widthPt, lineY - 3.5).lineTo(lineX + bar.widthPt, lineY + 3.5).stroke();

  doc.fillColor("#000000");
  doc.text(bar.label, lineX + bar.widthPt + 6, lineY - 4.2, { lineBreak: false });
  doc.restore();
}

function measureHeaderHeight(doc: Doc, title: string, narrative: string, innerW: number): number {
  doc.font("Helvetica-Bold").fontSize(15);
  const titleH = doc.heightOfString(title, { width: innerW });
  doc.font("Helvetica").fontSize(9);
  const bodyH = doc.heightOfString(narrative, { width: innerW, lineGap: 2 });
  return BOX_PAD * 2 + titleH + 6 + bodyH;
}

function drawHeader(doc: Doc, rect: Rect, title: string, narrative: string): void {
  drawWhiteBox(doc, rect);
  doc.save();
  const innerW = rect.w - BOX_PAD * 2;
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#000000");
  doc.text(title, rect.x + BOX_PAD, rect.y + BOX_PAD, { width: innerW });
  doc.font("Helvetica").fontSize(9).fillColor("#000000");
  doc.text(narrative, rect.x + BOX_PAD, doc.y + 6, { width: innerW, lineGap: 2 });
  doc.restore();
}

/**
 * Rótulos de contexto sobre a imagem: nome das cidades e sigla das rodovias do
 * percurso, no lugar dos rótulos que a base licenciada não fornece.
 */
function drawContextLabels(
  doc: Doc,
  places: PlaceLabel[],
  route: CroquiRoute,
  frame: MapFrame,
  occupied: Rect[],
): Rect[] {
  const placed = [...occupied];

  doc.font("Helvetica-Bold").fontSize(10);
  for (const place of places) {
    const [px, py] = frame.project(place.lon, place.lat);
    const w = doc.widthOfString(place.nome);
    const rect: Rect = { x: MAP_X + px - w / 2, y: MAP_Y + py - 5, w, h: 12 };
    if (!insideMap(rect) || placed.some((other) => overlaps(rect, other))) continue;
    placed.push(rect);
    haloText(doc, place.nome, rect.x, rect.y);
  }

  doc.font("Helvetica-Bold").fontSize(8.5);
  const vistas = new Set<string>();
  for (let i = 0; i < route.waypoints.length - 1; i++) {
    const via = String(route.waypoints[i].roadName || "").trim();
    // Só sigla de rodovia, como nos modelos — nome de rua urbana polui o mapa.
    if (!/^[A-Z]{2}-\d+/.test(via) || vistas.has(via)) continue;
    const inicio = route.waypoints[i].coordIndex;
    const fim = route.waypoints[i + 1].coordIndex;
    const meio = route.coordinates[Math.floor((inicio + fim) / 2)];
    if (!meio) continue;
    const [px, py] = frame.project(meio[0], meio[1]);
    const w = doc.widthOfString(via);
    const rect: Rect = { x: MAP_X + px - w / 2, y: MAP_Y + py - 15, w, h: 11 };
    if (!insideMap(rect) || placed.some((other) => overlaps(rect, other))) continue;
    vistas.add(via);
    placed.push(rect);
    haloText(doc, via, rect.x, rect.y);
  }

  return placed;
}

/** Coloca o rótulo DMS ao lado do pin, desviando das caixas e dos outros rótulos. */
function drawWaypointLabels(
  doc: Doc,
  route: CroquiRoute,
  frame: MapFrame,
  occupied: Rect[],
): Rect[] {
  doc.font("Helvetica").fontSize(8.5);
  const placed = [...occupied];
  for (const waypoint of route.waypoints) {
    const [px, py] = frame.project(waypoint.lon, waypoint.lat);
    const x = MAP_X + px;
    const y = MAP_Y + py;
    if (!insideMap({ x, y, w: 0, h: 0 })) continue;

    const label = formatDmsLabel(waypoint.lon, waypoint.lat);
    const w = doc.widthOfString(label);
    const h = 11;
    const candidates: Rect[] = [
      { x: x + 12, y: y - 22, w, h },
      { x: x - w - 6, y: y - 22, w, h },
      { x: x + 12, y: y - 6, w, h },
      { x: x - w - 6, y: y - 6, w, h },
      { x: x - w / 2, y: y + 4, w, h },
    ];
    const spot =
      candidates.find(
        (rect) => insideMap(rect) && !placed.some((other) => overlaps(rect, other)),
      ) || candidates[0];
    placed.push(spot);
    haloText(doc, label, spot.x, spot.y);
  }
  return placed;
}

export type CroquiPdfResult = {
  buffer: Buffer;
  /** Se a imagem de satélite saiu no PDF ou se ele ficou com o fundo neutro. */
  hasBasemapImage: boolean;
  basemapProvider: BasemapProvider | null;
};

export async function buildCroquiPdfBuffer(args: {
  title: string;
  narrative: string;
  atpGeometry: Polygon | MultiPolygon;
  route: CroquiRoute;
}): Promise<CroquiPdfResult> {
  const { title, narrative, atpGeometry, route } = args;

  const allCoords: Position[] = [...route.coordinates];
  for (const ring of polygonRings(atpGeometry)) allCoords.push(...ring);

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Mede a caixa antes de enquadrar: o conteúdo tem que nascer abaixo dela.
  const legendRect: Rect = {
    x: MAP_X + MAP_W - BOX_INSET - LEGEND_W,
    y: MAP_Y + BOX_INSET,
    w: LEGEND_W,
    h: LEGEND_H,
  };
  const headerW = legendRect.x - (MAP_X + BOX_INSET) - 8;
  const headerRect: Rect = {
    x: MAP_X + BOX_INSET,
    y: MAP_Y + BOX_INSET,
    w: headerW,
    h: measureHeaderHeight(doc, title, narrative, headerW - BOX_PAD * 2),
  };

  const frame = resolveMapFrame({
    contentBbox: bboxOfPositions(allCoords),
    widthPt: MAP_W,
    heightPt: MAP_H,
    topInsetPt: Math.max(headerRect.h, LEGEND_H) + BOX_INSET * 2,
  });
  const basemap = await fetchBasemapImage(frame);

  {
    doc.addPage({ size: [PAGE_W, PAGE_H], margin: 0 });

    doc.rect(0, 0, PAGE_W, PAGE_H).fill("#ffffff");
    doc.rect(MAP_X, MAP_Y, MAP_W, MAP_H).fill("#d8dde0");
    if (basemap) {
      try {
        doc.image(basemap.buffer, MAP_X, MAP_Y, { width: MAP_W, height: MAP_H });
      } catch {
        // segue com o fundo neutro
      }
    }

    const toPage = (lon: number, lat: number): [number, number] => {
      const [px, py] = frame.project(lon, lat);
      return [MAP_X + px, MAP_Y + py];
    };

    doc.save();
    doc.rect(MAP_X, MAP_Y, MAP_W, MAP_H).clip();

    if (route.coordinates.length >= 2) {
      doc.lineWidth(3).strokeColor(ROUTE_COLOR).lineJoin("round").lineCap("round");
      const [x0, y0] = toPage(route.coordinates[0][0], route.coordinates[0][1]);
      doc.moveTo(x0, y0);
      for (let i = 1; i < route.coordinates.length; i++) {
        const [x, y] = toPage(route.coordinates[i][0], route.coordinates[i][1]);
        doc.lineTo(x, y);
      }
      doc.stroke();
    }

    doc.lineWidth(2).strokeColor(POLYGON_COLOR).lineJoin("round");
    for (const ring of polygonRings(atpGeometry)) {
      if (ring.length < 3) continue;
      const [fx, fy] = toPage(ring[0][0], ring[0][1]);
      doc.moveTo(fx, fy);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = toPage(ring[i][0], ring[i][1]);
        doc.lineTo(x, y);
      }
      doc.closePath().stroke();
    }

    for (const waypoint of route.waypoints) {
      const [x, y] = toPage(waypoint.lon, waypoint.lat);
      drawPushpin(doc, x, y);
    }
    doc.restore();

    const scaleRect: Rect = { x: MAP_X + MAP_W - 230, y: MAP_Y + MAP_H - 62, w: 230, h: 62 };
    // Os DMS dos pontos vêm primeiro: são o conteúdo do croqui e têm prioridade
    // sobre os rótulos de contexto. Com a base do Google os rótulos já vêm na imagem.
    const ocupado = drawWaypointLabels(doc, route, frame, [headerRect, legendRect, scaleRect]);
    if (basemap?.provider !== "google") {
      drawContextLabels(doc, sedesNaBbox(frame.bboxLonLat), route, frame, ocupado);
    }

    drawHeader(doc, headerRect, title, narrative);
    drawLegend(doc, legendRect);
    drawNorthArrow(doc, MAP_X + MAP_W - 26, MAP_Y + MAP_H - 30);
    drawScaleBar(doc, frame, MAP_X + MAP_W - 8, MAP_Y + MAP_H - 8);

    if (basemap?.attribution) {
      doc.save();
      doc.font("Helvetica").fontSize(7).fillColor("#ffffff");
      haloText(doc, basemap.attribution, MAP_X + 6, MAP_Y + MAP_H - 13);
      doc.restore();
    }

    doc.end();
  }

  const buffer = await finished;
  return { buffer, hasBasemapImage: !!basemap, basemapProvider: basemap?.provider ?? null };
}
