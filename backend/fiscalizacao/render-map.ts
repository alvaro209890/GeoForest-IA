/**
 * Mapa PDF de uma fonte de fiscalização sobre a ATP.
 *
 * Reaproveita o motor de enquadramento e a base de satélite do Croqui
 * (`../croqui/basemap`), então o resultado sai no mesmo padrão visual dos
 * demais produtos do app: A4 paisagem, seta norte, barra de escala e legenda.
 */
import PDFDocument from "pdfkit";
import type { MultiPolygon, Polygon, Position } from "geojson";
import {
  bboxOfPositions,
  fetchBasemapImage,
  resolveMapFrame,
  type BasemapProvider,
} from "../croqui/basemap";
import { drawNorthArrow, drawScaleBar, haloText } from "../croqui/render-pdf";
import { relacaoLabel } from "./analysis";
import { ATP_COLOR, KIND_COLORS, KIND_LABELS, SOURCE_LABELS } from "./constants";
import type { AtpFeature, FiscalizacaoKind, FiscalizacaoRecord, FiscalizacaoSource } from "./types";

const PAGE_W = 842;
const PAGE_H = 595;
const MAP_MARGIN = 8;
const MAP_X = MAP_MARGIN;
const MAP_Y = MAP_MARGIN;
const MAP_W = PAGE_W - MAP_MARGIN * 2;
const MAP_H = PAGE_H - MAP_MARGIN * 2;

const BOX_INSET = 6;
const BOX_PAD = 8;
const HEADER_W = 330;
const LEGEND_W = 176;

/** Quantas ocorrências ganham ficha no rodapé do mapa. */
const MAX_FICHAS = 4;
/**
 * Altura de uma ficha: três linhas (nome / camada / relação) mais o respiro.
 * Medido contra o avanço real do PDFKit — subestimar aqui corta a última linha
 * para fora do painel branco.
 */
const FICHA_H = 34;
const FICHAS_TITULO_H = 15;

/** Raio, em metros, que uma feição precisa estar para puxar o enquadramento. */
const FRAME_RADIUS_M = 1000;

type Doc = InstanceType<typeof PDFDocument>;
type Rect = { x: number; y: number; w: number; h: number };

function polygonRings(geometry: Polygon | MultiPolygon): Position[][] {
  return geometry.type === "Polygon" ? geometry.coordinates : geometry.coordinates.flat();
}

function recordPositions(record: FiscalizacaoRecord): Position[] {
  const geom = record.geometry;
  if (geom.type === "Point") return [geom.coordinates as Position];
  return polygonRings(geom as Polygon | MultiPolygon).flat();
}

function drawPanel(doc: Doc, rect: Rect, opacity = 0.9): void {
  doc.save();
  doc.fillOpacity(opacity).fillColor("#ffffff");
  doc.roundedRect(rect.x, rect.y, rect.w, rect.h, 4).fill();
  doc.fillOpacity(1).lineWidth(0.8).strokeColor("#9aa5ad");
  doc.roundedRect(rect.x, rect.y, rect.w, rect.h, 4).stroke();
  doc.restore();
}

function drawHeader(
  doc: Doc,
  rect: Rect,
  source: FiscalizacaoSource,
  atpNome: string,
  incidentes: number,
  total: number,
): void {
  drawPanel(doc, rect);
  doc.save();
  const x = rect.x + BOX_PAD;
  let y = rect.y + BOX_PAD;

  doc.font("Helvetica-Bold").fontSize(12).fillColor("#0b2f26");
  doc.text(SOURCE_LABELS[source], x, y, { width: rect.w - BOX_PAD * 2, lineBreak: true });
  y = doc.y + 2;

  doc.font("Helvetica").fontSize(8.5).fillColor("#333333");
  doc.text(`Imóvel (ATP): ${atpNome}`, x, y, { width: rect.w - BOX_PAD * 2 });
  y = doc.y + 3;

  const cor = incidentes > 0 ? "#b71c1c" : "#1b5e20";
  const texto =
    incidentes > 0
      ? `${incidentes} ocorrência(s) INCIDENTE(S) na ATP`
      : "Nenhuma ocorrência incidente na ATP";
  doc.font("Helvetica-Bold").fontSize(9.5).fillColor(cor);
  doc.text(texto, x, y, { width: rect.w - BOX_PAD * 2 });
  y = doc.y + 1;

  doc.font("Helvetica").fontSize(7.5).fillColor("#555555");
  doc.text(
    `${total} feição(ões) no raio de busca · consulta em ${new Date().toLocaleDateString("pt-BR")}`,
    x,
    y,
    { width: rect.w - BOX_PAD * 2 },
  );
  doc.restore();
}

function drawLegend(doc: Doc, rect: Rect, kinds: FiscalizacaoKind[]): void {
  drawPanel(doc, rect);
  doc.save();
  const x = rect.x + BOX_PAD;
  let y = rect.y + BOX_PAD;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0b2f26");
  doc.text("Legenda", x, y, { lineBreak: false });
  y += 13;

  doc.lineWidth(1.8).strokeColor(ATP_COLOR);
  doc.rect(x, y + 1, 14, 8).stroke();
  doc.font("Helvetica").fontSize(8).fillColor("#333333");
  doc.text("ATP (imóvel)", x + 20, y + 1, { lineBreak: false });
  y += 14;

  for (const kind of kinds) {
    doc.save();
    doc.fillOpacity(0.55).fillColor(KIND_COLORS[kind]);
    doc.rect(x, y + 1, 14, 8).fill();
    doc.fillOpacity(1).lineWidth(1).strokeColor(KIND_COLORS[kind]);
    doc.rect(x, y + 1, 14, 8).stroke();
    doc.restore();
    doc.font("Helvetica").fontSize(8).fillColor("#333333");
    doc.text(KIND_LABELS[kind], x + 20, y + 1, { lineBreak: false });
    y += 14;
  }
  doc.restore();
}

/** Fichas com nome, CPF e ano — o que o usuário precisa ler sem abrir a tabela. */
function drawFichas(doc: Doc, rect: Rect, records: FiscalizacaoRecord[]): void {
  if (!records.length) return;
  drawPanel(doc, rect);
  doc.save();
  const x = rect.x + BOX_PAD;
  let y = rect.y + BOX_PAD;
  const w = rect.w - BOX_PAD * 2;

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor("#0b2f26");
  doc.text("Ocorrências mais relevantes", x, y, { width: w });
  y = doc.y + 4;

  for (const record of records) {
    doc.save();
    doc.fillColor(KIND_COLORS[record.kind]);
    doc.rect(x, y + 1.5, 3, 22).fill();
    doc.restore();

    doc.font("Helvetica-Bold").fontSize(8).fillColor("#111111");
    doc.text(`${record.nome || "Sem nome"}${record.cpfCnpj ? ` — ${record.cpfCnpj}` : ""}`, x + 8, y, {
      width: w - 8,
      lineBreak: false,
      ellipsis: true,
    });
    y = doc.y + 1;

    doc.font("Helvetica").fontSize(7.5).fillColor("#444444");
    const linha2 = [
      record.layerLabel,
      record.ano ? `ano ${record.ano}` : "",
      record.documento ? `nº ${record.documento}` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    doc.text(linha2, x + 8, y, { width: w - 8, lineBreak: false, ellipsis: true });
    y = doc.y + 1;

    doc.font("Helvetica-Bold").fontSize(7.5).fillColor(record.incidente ? "#b71c1c" : "#1b5e20");
    doc.text(relacaoLabel(record), x + 8, y, { width: w - 8, lineBreak: false, ellipsis: true });
    y = doc.y + 5;
  }
  doc.restore();
}

export type FiscalizacaoMapResult = {
  buffer: Buffer;
  hasBasemapImage: boolean;
  basemapProvider: BasemapProvider | null;
};

export async function buildFiscalizacaoMapPdf(args: {
  source: FiscalizacaoSource;
  atp: AtpFeature;
  atpNome: string;
  records: FiscalizacaoRecord[];
}): Promise<FiscalizacaoMapResult> {
  const { source, atp, atpNome, records } = args;

  // Enquadra a ATP mais as feições incidentes e as bem próximas. Feições além
  // do raio continuam sendo desenhadas (só ficam recortadas na borda) — deixá-las
  // mandar no enquadramento espremia a ATP até virar um risco no mapa.
  const relevantes = records.filter((r) => r.incidente || r.distanciaM <= FRAME_RADIUS_M);
  const coords: Position[] = polygonRings(atp.geometry).flat();
  for (const record of relevantes) coords.push(...recordPositions(record));

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: [PAGE_W, PAGE_H], margin: 0, autoFirstPage: false });
  const finished = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const headerRect: Rect = { x: MAP_X + BOX_INSET, y: MAP_Y + BOX_INSET, w: HEADER_W, h: 66 };
  const kinds = Array.from(new Set(records.map((r) => r.kind)));
  const legendRect: Rect = {
    x: MAP_X + MAP_W - BOX_INSET - LEGEND_W,
    y: MAP_Y + BOX_INSET,
    w: LEGEND_W,
    h: 26 + 14 * (kinds.length + 1),
  };

  const fichas = records.slice(0, MAX_FICHAS);
  const fichasH = fichas.length
    ? BOX_PAD + FICHAS_TITULO_H + fichas.length * FICHA_H + BOX_PAD
    : 0;
  const fichasRect: Rect = {
    x: MAP_X + BOX_INSET,
    y: MAP_Y + MAP_H - BOX_INSET - fichasH,
    w: HEADER_W,
    h: fichasH,
  };

  const frame = resolveMapFrame({
    contentBbox: bboxOfPositions(coords),
    widthPt: MAP_W,
    heightPt: MAP_H,
    topInsetPt: Math.max(headerRect.h, legendRect.h) + BOX_INSET * 2,
  });
  const basemap = await fetchBasemapImage(frame);

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

  // Feições de fiscalização primeiro, ATP por cima — o contorno do imóvel nunca
  // pode ficar escondido atrás de um polígono de embargo.
  for (const record of records) {
    const cor = KIND_COLORS[record.kind];
    if (record.geometry.type === "Point") {
      const [x, y] = toPage(
        (record.geometry.coordinates as Position)[0],
        (record.geometry.coordinates as Position)[1],
      );
      doc.save();
      doc.lineWidth(1.4).strokeColor("#ffffff").fillColor(cor);
      doc.circle(x, y, 4.5).fillAndStroke(cor, "#ffffff");
      doc.restore();
      continue;
    }
    doc.save();
    doc.fillOpacity(record.incidente ? 0.55 : 0.32).fillColor(cor);
    doc.lineWidth(record.incidente ? 1.8 : 1).strokeColor(cor);
    for (const ring of polygonRings(record.geometry as Polygon | MultiPolygon)) {
      if (ring.length < 3) continue;
      const [fx, fy] = toPage(ring[0][0], ring[0][1]);
      doc.moveTo(fx, fy);
      for (let i = 1; i < ring.length; i++) {
        const [x, y] = toPage(ring[i][0], ring[i][1]);
        doc.lineTo(x, y);
      }
      doc.closePath().fillAndStroke();
    }
    doc.restore();
  }

  doc.lineWidth(2.4).strokeColor(ATP_COLOR).lineJoin("round");
  for (const ring of polygonRings(atp.geometry)) {
    if (ring.length < 3) continue;
    const [fx, fy] = toPage(ring[0][0], ring[0][1]);
    doc.moveTo(fx, fy);
    for (let i = 1; i < ring.length; i++) {
      const [x, y] = toPage(ring[i][0], ring[i][1]);
      doc.lineTo(x, y);
    }
    doc.closePath().stroke();
  }
  doc.restore();

  drawHeader(doc, headerRect, source, atpNome, records.filter((r) => r.incidente).length, records.length);
  drawLegend(doc, legendRect, kinds);
  drawFichas(doc, fichasRect, fichas);
  drawNorthArrow(doc, MAP_X + MAP_W - 26, MAP_Y + MAP_H - 30);
  drawScaleBar(doc, frame, MAP_X + MAP_W - 8, MAP_Y + MAP_H - 8);

  if (basemap?.attribution) {
    doc.save();
    doc.font("Helvetica").fontSize(7).fillColor("#ffffff");
    haloText(doc, basemap.attribution, MAP_X + HEADER_W + 16, MAP_Y + MAP_H - 13);
    doc.restore();
  }

  doc.end();
  const buffer = await finished;
  return { buffer, hasBasemapImage: !!basemap, basemapProvider: basemap?.provider ?? null };
}
