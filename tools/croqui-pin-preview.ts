/**
 * Preview visual do pushpin do croqui PDF, lado a lado com o ícone oficial
 * do Google Earth. Não precisa de rede.
 *
 *   npx tsx tools/croqui-pin-preview.ts [pasta-de-saida]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";
import { formatDmsLabel } from "../backend/croqui/coords";

const ROOT = path.resolve(import.meta.dirname, "..");
const ASSET = path.join(ROOT, "backend", "croqui", "assets", "ylw-pushpin.png");
const saida = path.resolve(process.argv[2] || path.join(os.tmpdir(), "croqui-pin-preview"));

const PIN_ICON_PX = 64;
const PIN_HOTSPOT_X_PX = 20;
const PIN_HOTSPOT_Y_FROM_BOTTOM_PX = 2;
const PIN_SIZE_PT = 24;

function drawPushpin(
  doc: InstanceType<typeof PDFDocument>,
  x: number,
  y: number,
  sizePt = PIN_SIZE_PT,
): void {
  const scale = sizePt / PIN_ICON_PX;
  const drawX = x - PIN_HOTSPOT_X_PX * scale;
  const drawY = y - (PIN_ICON_PX - PIN_HOTSPOT_Y_FROM_BOTTOM_PX) * scale;
  doc.image(fs.readFileSync(ASSET), drawX, drawY, { width: sizePt, height: sizePt });
}

function haloText(doc: InstanceType<typeof PDFDocument>, text: string, x: number, y: number): void {
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
}

async function main() {
  fs.mkdirSync(saida, { recursive: true });
  fs.copyFileSync(ASSET, path.join(saida, "ylw-pushpin-source.png"));

  const chunks: Buffer[] = [];
  const doc = new PDFDocument({ size: [842, 595], margin: 0 });
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  doc.rect(0, 0, 842, 595).fill("#2a4a2a");
  doc.font("Helvetica-Bold").fontSize(16).fillColor("#ffffff");
  doc.text("Preview — pushpin ylw-pushpin.png (Google Earth)", 40, 30);

  doc.font("Helvetica").fontSize(10).fillColor("#dddddd");
  doc.text(
    "Cruz vermelha = coordenada. A ponta da agulha deve cair exatamente no cruzamento.",
    40,
    55,
  );

  const points: Array<{ x: number; y: number; lon: number; lat: number }> = [
    { x: 180, y: 220, lon: -52.2196222, lat: -12.5900389 },
    { x: 360, y: 280, lon: -51.7, lat: -13.1 },
    { x: 540, y: 200, lon: -51.2, lat: -12.8 },
    { x: 700, y: 340, lon: -52.0, lat: -12.5 },
  ];

  for (const p of points) {
    doc.save();
    doc.strokeColor("#ff2222").lineWidth(1);
    doc.moveTo(p.x - 10, p.y).lineTo(p.x + 10, p.y).stroke();
    doc.moveTo(p.x, p.y - 10).lineTo(p.x, p.y + 10).stroke();
    doc.restore();
    drawPushpin(doc, p.x, p.y);
    doc.font("Helvetica").fontSize(8.5);
    haloText(doc, formatDmsLabel(p.lon, p.lat), p.x + 14, p.y - 20);
  }

  // Legenda-sample
  doc.fillOpacity(0.93).fillColor("#ffffff");
  doc.rect(640, 40, 160, 70).fill();
  doc.fillOpacity(1).strokeColor("#8c8c8c").lineWidth(0.6);
  doc.rect(640, 40, 160, 70).stroke();
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000000");
  doc.text("Legenda", 640, 48, { width: 160, align: "center" });
  drawPushpin(doc, 660, 92, 14);
  doc.font("Helvetica").fontSize(9).fillColor("#000000");
  doc.text("Coordenadas", 678, 82);

  // Referência do PNG em tamanho natural
  doc.image(ASSET, 40, 420, { width: 64, height: 64 });
  doc.font("Helvetica").fontSize(9).fillColor("#ffffff");
  doc.text("Fonte: maps.google.com/mapfiles/kml/pushpin/ylw-pushpin.png (64×64)", 120, 445);

  doc.end();
  const pdf = await done;
  const pdfPath = path.join(saida, "pin-preview.pdf");
  fs.writeFileSync(pdfPath, pdf);
  console.log(`PDF:  ${pdfPath}`);
  console.log(`PNG:  ${path.join(saida, "ylw-pushpin-source.png")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
