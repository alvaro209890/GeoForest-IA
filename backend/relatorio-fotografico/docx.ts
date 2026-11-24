/**
 * Word do relatório fotográfico no modelo IMAP.
 * O .docx de capa/cabeçalho/rodapé veio do Painel_Gerencial_IMAP. As fotos
 * entram na segunda seção, antes do sectPr final — o mesmo ponto do painel.
 *
 * Medidas, legenda e paginação vêm de `shared/relatorio-fotografico/layout.ts`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import {
  FLUXO_WORD_CM,
  IMAP_LAYOUT,
  PAGINA_CM,
  planPhotoPages,
  textoFigura,
  type BlocoFigura,
} from "../../shared/relatorio-fotografico/layout";
import { RelatorioFotoError, type FotoPronta } from "./types";

const CM_POR_POLEGADA = 2.54;

const TEMPLATE_NAME = "modelo-relatorio-fotografico.docx";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function templateCandidates(): string[] {
  return [
    path.resolve(__dirname, "assets", TEMPLATE_NAME),
    path.resolve(__dirname, "..", "backend", "relatorio-fotografico", "assets", TEMPLATE_NAME),
    path.resolve(process.cwd(), "backend", "relatorio-fotografico", "assets", TEMPLATE_NAME),
  ];
}

let templateCache: Buffer | null = null;

export function loadTemplateDocx(): Buffer {
  if (templateCache) return templateCache;
  const found = templateCandidates().find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new RelatorioFotoError(
      "Modelo Word da IMAP não encontrado no servidor.",
      500,
      "MODELO_AUSENTE",
    );
  }
  templateCache = fs.readFileSync(found);
  return templateCache;
}

export function resetTemplateCacheForTests(): void {
  templateCache = null;
}

export function relatorioFilename(projeto: string): string {
  const clean = String(projeto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${clean || "Relatorio_Fotografico"}.docx`;
}

function escapeXml(value: string): string {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function emTwips(cm: number): number {
  return Math.round(cm / CM_POR_POLEGADA * 1440);
}

function spacerMarkup(cm: number, novaPagina: boolean): string {
  const quebra = novaPagina ? "<w:pageBreakBefore/>" : "";
  return `<w:p><w:pPr>${quebra}<w:spacing w:before="0" w:after="0" w:line="${emTwips(cm)}" w:lineRule="exact"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:sz w:val="2"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r></w:p>`;
}

function photoMarkup(relation: string, id: number, widthIn: number, heightIn: number): string {
  const cx = Math.round(widthIn * 914400);
  const cy = Math.round(heightIn * 914400);
  return `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Fotografia ${id}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${id}" name="Fotografia ${id}.jpg"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relation}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function captionMarkup(text: string, recuo: number): string {
  const spacing = `w:before="${emTwips(IMAP_LAYOUT.captionGap)}" w:after="0" w:line="${IMAP_LAYOUT.captionLinePt * 20}" w:lineRule="exact"`;
  return `<w:p><w:pPr><w:keepLines/><w:snapToGrid w:val="0"/><w:spacing ${spacing}/><w:ind w:left="${recuo}" w:right="${recuo}" w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial"/><w:sz w:val="${IMAP_LAYOUT.captionFontPt * 2}"/><w:color w:val="242424"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function rowMarkup(
  block: BlocoFigura<FotoPronta>,
  relIds: Map<FotoPronta, string>,
  docIds: Map<FotoPronta, number>,
  folgaAbaixo: boolean,
): string {
  const pair = block.items.length === 2;
  const cellWidth = pair ? IMAP_LAYOUT.tableW / 2 : IMAP_LAYOUT.tableW;
  const altura = emTwips(block.heightCm + (folgaAbaixo ? IMAP_LAYOUT.gap : 0));
  const cells = block.items.map((item) => {
    const relation = relIds.get(item.photo);
    const id = docIds.get(item.photo);
    if (!relation || !id) throw new RelatorioFotoError("Fotografia sem vínculo no Word.", 500, "DOCX_REL");
    const image = photoMarkup(relation, id, item.fit.w / CM_POR_POLEGADA, item.fit.h / CM_POR_POLEGADA);
    const imageP = `<w:p><w:pPr><w:keepNext/><w:keepLines/><w:snapToGrid w:val="0"/><w:spacing w:before="0" w:after="0" w:line="${emTwips(item.fit.h)}" w:lineRule="atLeast"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="center"/><w:rPr><w:sz w:val="2"/></w:rPr></w:pPr><w:r><w:rPr><w:noProof/><w:sz w:val="2"/></w:rPr>${image}</w:r></w:p>`;
    const recuo = emTwips((cellWidth - item.columnCm) / 2);
    return `<w:tc><w:tcPr><w:tcW w:w="${emTwips(cellWidth)}" w:type="dxa"/>${pair ? "" : '<w:gridSpan w:val="2"/>'}<w:vAlign w:val="top"/></w:tcPr>${imageP}${captionMarkup(textoFigura(item.number, item.caption), recuo)}</w:tc>`;
  });
  return `<w:tr><w:trPr><w:cantSplit/><w:trHeight w:val="${altura}" w:hRule="atLeast"/></w:trPr>${cells.join("")}</w:tr>`;
}

function imgTable(
  blocks: BlocoFigura<FotoPronta>[],
  relIds: Map<FotoPronta, string>,
  docIds: Map<FotoPronta, number>,
): string {
  const col = emTwips(IMAP_LAYOUT.tableW / 2);
  const indent = emTwips((PAGINA_CM.w - IMAP_LAYOUT.tableW) / 2 - FLUXO_WORD_CM.margemEsquerda);
  const grid = `<w:tblGrid><w:gridCol w:w="${col}"/><w:gridCol w:w="${col}"/></w:tblGrid>`;
  const borders =
    '<w:tblBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/><w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders>';
  const margins =
    '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
  const rows = blocks
    .map((block, index) => rowMarkup(block, relIds, docIds, index < blocks.length - 1))
    .join("");
  return `<w:tbl><w:tblPr><w:tblW w:w="${2 * col}" w:type="dxa"/><w:jc w:val="left"/><w:tblInd w:w="${indent}" w:type="dxa"/>${borders}<w:tblLayout w:type="fixed"/>${margins}</w:tblPr>${grid}${rows}</w:tbl>`;
}

export async function buildRelatorioFotograficoDocx(partials: Array<{ caption: string; photos: FotoPronta[] }>): Promise<Buffer> {
  const usable = partials
    .map((partial) => ({
      caption: String(partial.caption || "").trim(),
      photos: (partial.photos || []).filter((photo) => photo?.jpeg?.length),
    }))
    .filter((partial) => partial.caption && partial.photos.length);
  if (!usable.length) {
    throw new RelatorioFotoError(
      "Inclua ao menos uma parcial com legenda e fotografia.",
      400,
      "DOCX_VAZIO",
    );
  }

  const zip = await JSZip.loadAsync(loadTemplateDocx());
  const relIds = new Map<FotoPronta, string>();
  const docIds = new Map<FotoPronta, number>();
  const rels: string[] = [];
  let docId = 100;
  const photos = usable.flatMap((partial) => partial.photos);
  photos.forEach((photo, index) => {
    const rel = `rIdReportPhoto${index + 1}`;
    relIds.set(photo, rel);
    docIds.set(photo, docId);
    docId += 1;
    const file = `report_photo_${String(index + 1).padStart(4, "0")}.jpg`;
    zip.file(`word/media/${file}`, photo.jpeg);
    rels.push(
      `<Relationship Id="${rel}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${file}"/>`,
    );
  });

  const pages = planPhotoPages(usable);
  const elements = pages.map((page, pageIndex) => {
    const inicio = pageIndex === 0 ? FLUXO_WORD_CM.topoPrimeiraPagina : FLUXO_WORD_CM.topoAposQuebra;
    const spacer = spacerMarkup(page.blocks[0].topCm - inicio, pageIndex > 0);
    return spacer + imgTable(page.blocks, relIds, docIds);
  });

  const documentFile = zip.file("word/document.xml");
  if (!documentFile) {
    throw new RelatorioFotoError("O modelo Word não tem document.xml.", 500, "MODELO_INVALIDO");
  }
  let xml = await documentFile.async("string");
  const position = xml.lastIndexOf("<w:sectPr");
  if (position < 0) {
    throw new RelatorioFotoError("O modelo Word não tem seção de páginas.", 500, "MODELO_SEM_SECAO");
  }
  xml = xml.slice(0, position) + elements.join("") + xml.slice(position);
  zip.file("word/document.xml", xml);

  const relName = "word/_rels/document.xml.rels";
  const relFile = zip.file(relName);
  if (!relFile) {
    throw new RelatorioFotoError("O modelo Word não tem os relacionamentos.", 500, "MODELO_SEM_RELS");
  }
  const relText = (await relFile.async("string")).replace("</Relationships>", `${rels.join("")}</Relationships>`);
  zip.file(relName, relText);

  const appName = "docProps/app.xml";
  const appFile = zip.file(appName);
  if (appFile) {
    const app = (await appFile.async("string")).replace(
      /<Pages>[^<]*<\/Pages>/,
      `<Pages>${pages.length + 1}</Pages>`,
    );
    zip.file(appName, app);
  }

  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
