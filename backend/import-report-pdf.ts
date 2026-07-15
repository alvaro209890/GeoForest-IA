/**
 * Relatório PDF de importação — estilo SEMA, identidade visual GeoForest.
 *
 * Espelha o "Relatório de importação" do Importador GEO (Situação, erros por
 * feição, inventário de geometrias), com layout moderno (header escuro,
 * accent emerald, cards de métricas).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import type { GeometryErrorRow } from "./geometry-errors";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type ImportPdfLayer = {
  name: string;
  code: string | null;
  featureCount: number;
  crsLabel: string;
};

export type ImportPdfInput = {
  filename: string;
  ok: boolean;
  rows: GeometryErrorRow[];
  camadas: ImportPdfLayer[];
  warnings?: string[];
  generatedAt?: Date;
  /** ID curto para rodapé (importId / job). */
  reportId?: string;
};

const TIPO_LABEL: Record<string, string> = {
  borda_se_cruza: "Borda do polígono se cruza",
  vertice_duplicado: "A geometria contém pontos repetidos",
  anel_degenerado: "Anel degenerado",
  nomenclatura_desconhecida: "Nomenclatura fora do padrão",
  crs_ausente: "CRS ausente",
  crs_nao_conforme: "CRS não conforme",
  dimensao_nao_2d: "Shapefile não é 2D",
  primitiva_incorreta: "Primitiva incorreta",
  atp_multipla: "ATP com várias feições",
  atributo_ausente: "Atributo obrigatório ausente",
  feicao_obrigatoria_ausente: "Feição obrigatória ausente",
  fora_do_continente: "Fora do continente (Anexo 01)",
  sobreposicao_proibida: "Sobreposição proibida (Anexo 01)",
  sobreposicao: "Sobreposição na mesma camada",
  vazio: "Vazio/gap na camada",
  air_atp_area: "Soma AIR ≠ ATP",
};

export function labelImportErrorTipo(tipo: string): string {
  return TIPO_LABEL[tipo] || tipo;
}

function safeText(value: unknown, max = 240): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function groupErrorCounts(rows: GeometryErrorRow[]): Array<{ camada: string; tipo: string; label: string; count: number }> {
  const map = new Map<string, { camada: string; tipo: string; label: string; count: number }>();
  for (const row of rows) {
    const camada = String(row.camada || "—");
    const tipo = String(row.tipo || "erro");
    const key = `${camada}\t${tipo}`;
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else map.set(key, { camada, tipo, label: labelImportErrorTipo(tipo), count: 1 });
  }
  return [...map.values()].sort((a, b) => a.camada.localeCompare(b.camada) || b.count - a.count);
}

function resolveLogoBuffer(): Buffer | null {
  const candidates = [
    path.resolve(__dirname, "..", "geoforest_app_logo.png"),
    path.resolve(process.cwd(), "geoforest_app_logo.png"),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return fs.readFileSync(p);
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Gera o PDF do relatório de importação (Buffer).
 * Função pura de layout — usada por testes e pela rota HTTP.
 */
export async function buildImportReportPdf(input: ImportPdfInput): Promise<Buffer> {
  const generatedAt = input.generatedAt || new Date();
  const when = generatedAt.toLocaleString("pt-BR", { timeZone: "America/Cuiaba" });
  const errorSummary = groupErrorCounts(input.rows);
  const logoBuffer = resolveLogoBuffer();

  const doc = new PDFDocument({
    size: "A4",
    margin: 40,
    bufferPages: true,
    info: {
      Title: `Relatório de Importação — ${safeText(input.filename, 80)}`,
      Author: "GeoForest IA",
      Subject: "Relatório de importação do Projeto Geográfico (estilo SIMCAR)",
      Keywords: "SIMCAR, importação, GeoForest, SEMA-MT",
    },
  });

  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const margin = 40;
  const contentW = pageW - margin * 2;

  const colors = {
    primary: "#059669",
    primaryLight: "#D1FAE5",
    primaryBg: "#ECFDF5",
    dark: "#0F172A",
    darkText: "#1E293B",
    text: "#334155",
    lightText: "#64748B",
    border: "#E2E8F0",
    bg: "#F8FAFC",
    danger: "#DC2626",
    dangerBg: "#FEF2F2",
    dangerBorder: "#FECACA",
    success: "#059669",
    successBg: "#ECFDF5",
    successBorder: "#A7F3D0",
    warn: "#D97706",
    white: "#FFFFFF",
  };

  const ensureSpace = (height: number) => {
    if (doc.y + height > pageH - margin - 28) {
      doc.addPage();
      doc.font("Helvetica").fillColor(colors.lightText).fontSize(8).text(
        `GeoForest IA · Relatório de Importação · ${safeText(input.reportId || input.filename, 48)}`,
        margin,
        22,
        { width: contentW, align: "right" },
      );
      doc.moveTo(margin, 36).lineTo(pageW - margin, 36).strokeColor(colors.border).lineWidth(0.6).stroke();
      doc.y = 48;
      doc.x = margin;
    }
  };

  // ── Header ──────────────────────────────────────────────
  doc.rect(0, 0, pageW, 148).fill(colors.dark);
  // accent bar
  doc.rect(0, 148, pageW, 4).fill(colors.primary);

  if (logoBuffer) {
    try {
      doc.image(logoBuffer, margin, 28, { fit: [48, 48] });
    } catch {
      /* logo opcional */
    }
  }

  const titleX = logoBuffer ? margin + 62 : margin;
  doc.font("Helvetica-Bold").fontSize(22).fillColor(colors.white).text("Relatório de Importação", titleX, 32, {
    width: contentW - (logoBuffer ? 62 : 0),
  });
  doc.font("Helvetica").fontSize(10).fillColor(colors.primaryLight).text(
    "GeoForest IA · Projeto Geográfico (estilo SIMCAR / SEMA-MT)",
    titleX,
    60,
    { width: contentW - (logoBuffer ? 62 : 0) },
  );
  doc.font("Helvetica-Bold").fontSize(11).fillColor(colors.white).text(safeText(input.filename, 90), margin, 100, {
    width: contentW,
  });
  doc.font("Helvetica").fontSize(9).fillColor("#94A3B8").text(`Gerado em ${when}`, margin, 120, {
    width: contentW,
  });

  doc.y = 172;
  doc.x = margin;

  // ── Status banner ───────────────────────────────────────
  ensureSpace(72);
  const statusBg = input.ok ? colors.successBg : colors.dangerBg;
  const statusBorder = input.ok ? colors.successBorder : colors.dangerBorder;
  const statusColor = input.ok ? colors.success : colors.danger;
  const statusTitle = input.ok
    ? "Situação da importação: Aprovado"
    : "Situação da importação: Reprovado";
  const statusSub = input.ok
    ? "Nenhuma inconsistência impeditiva. O processamento do projeto está liberado."
    : "Corrija os erros encontrados e envie novamente! O processamento não é liberado com importação reprovada.";

  const bannerY = doc.y;
  doc.roundedRect(margin, bannerY, contentW, 62, 10).fillAndStroke(statusBg, statusBorder);
  doc.font("Helvetica-Bold").fontSize(13).fillColor(statusColor).text(statusTitle, margin + 16, bannerY + 14, {
    width: contentW - 32,
  });
  doc.font("Helvetica").fontSize(9).fillColor(colors.text).text(statusSub, margin + 16, bannerY + 34, {
    width: contentW - 32,
  });
  doc.y = bannerY + 74;
  doc.x = margin;

  // ── Metrics ─────────────────────────────────────────────
  ensureSpace(80);
  const metricGap = 12;
  const metricW = (contentW - metricGap * 2) / 3;
  const metricsY = doc.y;
  const metrics = [
    { label: "Camadas no ZIP", value: String(input.camadas.length) },
    { label: "Erros encontrados", value: String(input.rows.length) },
    {
      label: "Tipos de erro",
      value: String(new Set(input.rows.map((r) => r.tipo)).size),
    },
  ];
  metrics.forEach((m, i) => {
    const x = margin + i * (metricW + metricGap);
    doc.roundedRect(x, metricsY, metricW, 58, 8).fillAndStroke(colors.primaryBg, colors.primaryLight);
    doc.font("Helvetica-Bold").fontSize(18).fillColor(colors.primary).text(m.value, x + 12, metricsY + 12, {
      width: metricW - 24,
    });
    doc.font("Helvetica").fontSize(8.5).fillColor(colors.lightText).text(m.label, x + 12, metricsY + 36, {
      width: metricW - 24,
    });
  });
  doc.y = metricsY + 72;
  doc.x = margin;

  // ── Erros encontrados (resumo estilo SEMA) ──────────────
  ensureSpace(40);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(colors.dark).text("Erros encontrados", margin, doc.y);
  doc.moveTo(margin, doc.y + 6).lineTo(pageW - margin, doc.y + 6).strokeColor(colors.primary).lineWidth(1.5).stroke();
  doc.moveDown(1.1);
  doc.x = margin;

  if (!errorSummary.length) {
    doc.font("Helvetica").fontSize(10).fillColor(colors.lightText).text(
      "Nenhum erro de importação. Estrutura e topologia do ZIP estão conformes às regras do importador.",
      margin,
      doc.y,
      { width: contentW },
    );
    doc.moveDown(1);
  } else {
    // Agrupa por camada como no PDF SEMA
    const byLayer = new Map<string, Array<{ label: string; count: number }>>();
    for (const item of errorSummary) {
      const list = byLayer.get(item.camada) || [];
      list.push({ label: item.label, count: item.count });
      byLayer.set(item.camada, list);
    }

    for (const [camada, items] of byLayer) {
      ensureSpace(28 + items.length * 18);
      doc.font("Helvetica-Bold").fontSize(11).fillColor(colors.darkText).text(camada, margin, doc.y, {
        width: contentW,
      });
      doc.moveDown(0.25);
      for (const item of items) {
        ensureSpace(18);
        const rowY = doc.y;
        doc.roundedRect(margin, rowY, contentW, 16, 4).fill(colors.bg);
        doc.font("Helvetica").fontSize(9).fillColor(colors.text).text(item.label, margin + 8, rowY + 3.5, {
          width: contentW - 56,
        });
        doc.font("Helvetica-Bold").fontSize(10).fillColor(colors.danger).text(String(item.count), margin + contentW - 40, rowY + 3, {
          width: 32,
          align: "right",
        });
        doc.y = rowY + 20;
        doc.x = margin;
      }
      doc.moveDown(0.4);
    }
  }

  // ── Detalhe dos erros (amostra) ──────────────────────────
  if (input.rows.length > 0) {
    ensureSpace(40);
    doc.font("Helvetica-Bold").fontSize(14).fillColor(colors.dark).text("Detalhamento dos erros", margin, doc.y);
    doc.moveTo(margin, doc.y + 6).lineTo(pageW - margin, doc.y + 6).strokeColor(colors.primary).lineWidth(1.5).stroke();
    doc.moveDown(1.1);
    doc.x = margin;

    const maxDetail = Math.min(input.rows.length, 80);
    // table header
    ensureSpace(22);
    const headY = doc.y;
    doc.roundedRect(margin, headY, contentW, 18, 4).fill(colors.dark);
    doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.white);
    doc.text("Camada", margin + 6, headY + 5, { width: 90 });
    doc.text("Tipo", margin + 100, headY + 5, { width: 130 });
    doc.text("Feição", margin + 234, headY + 5, { width: 40 });
    doc.text("Detalhe", margin + 280, headY + 5, { width: contentW - 290 });
    doc.y = headY + 22;

    for (let i = 0; i < maxDetail; i += 1) {
      const row = input.rows[i];
      ensureSpace(28);
      const y = doc.y;
      const bg = i % 2 === 0 ? colors.bg : colors.white;
      doc.roundedRect(margin, y, contentW, 24, 3).fill(bg);
      doc.font("Helvetica").fontSize(7.5).fillColor(colors.darkText);
      doc.text(safeText(row.camada, 28), margin + 6, y + 4, { width: 90 });
      doc.fillColor(colors.danger).text(safeText(labelImportErrorTipo(row.tipo), 40), margin + 100, y + 4, {
        width: 130,
      });
      doc.fillColor(colors.text).text(String(row.feicao ?? "—"), margin + 234, y + 4, { width: 40 });
      doc.fillColor(colors.lightText).text(safeText(row.detalhe, 90), margin + 280, y + 4, {
        width: contentW - 290,
      });
      doc.y = y + 26;
      doc.x = margin;
    }
    if (input.rows.length > maxDetail) {
      doc.font("Helvetica-Oblique").fontSize(8).fillColor(colors.lightText).text(
        `… e mais ${input.rows.length - maxDetail} erro(s) (lista completa no relatório texto / ZIP de processamento).`,
        margin,
        doc.y,
        { width: contentW },
      );
      doc.moveDown(0.8);
    }
  }

  // ── Inventário de geometrias (estilo SEMA) ──────────────
  ensureSpace(40);
  doc.font("Helvetica-Bold").fontSize(14).fillColor(colors.dark).text("Geometrias encontradas", margin, doc.y);
  doc.moveTo(margin, doc.y + 6).lineTo(pageW - margin, doc.y + 6).strokeColor(colors.primary).lineWidth(1.5).stroke();
  doc.moveDown(1.1);
  doc.x = margin;

  ensureSpace(20);
  const invHeadY = doc.y;
  doc.roundedRect(margin, invHeadY, contentW, 18, 4).fill(colors.dark);
  doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.white);
  doc.text("Feição", margin + 6, invHeadY + 5, { width: 140 });
  doc.text("Código SIMCAR", margin + 150, invHeadY + 5, { width: 120 });
  doc.text("Quantidade", margin + 280, invHeadY + 5, { width: 70 });
  doc.text("CRS", margin + 360, invHeadY + 5, { width: contentW - 370 });
  doc.y = invHeadY + 22;

  const sortedLayers = [...input.camadas].sort((a, b) => a.name.localeCompare(b.name));
  sortedLayers.forEach((layer, i) => {
    ensureSpace(18);
    const y = doc.y;
    const bg = i % 2 === 0 ? colors.bg : colors.white;
    doc.roundedRect(margin, y, contentW, 16, 3).fill(bg);
    doc.font("Helvetica").fontSize(8).fillColor(colors.darkText);
    doc.text(safeText(layer.name, 36), margin + 6, y + 4, { width: 140 });
    doc.fillColor(layer.code ? colors.primary : colors.danger).text(
      safeText(layer.code || "desconhecido", 28),
      margin + 150,
      y + 4,
      { width: 120 },
    );
    doc.fillColor(colors.text).text(String(layer.featureCount ?? 0), margin + 280, y + 4, { width: 70 });
    doc.fillColor(colors.lightText).text(safeText(layer.crsLabel, 40), margin + 360, y + 4, {
      width: contentW - 370,
    });
    doc.y = y + 18;
    doc.x = margin;
  });

  if (input.warnings?.length) {
    ensureSpace(40);
    doc.moveDown(0.6);
    doc.font("Helvetica-Bold").fontSize(12).fillColor(colors.warn).text("Avisos", margin, doc.y);
    doc.moveDown(0.4);
    for (const w of input.warnings) {
      ensureSpace(16);
      doc.font("Helvetica").fontSize(9).fillColor(colors.text).text(`• ${safeText(w, 200)}`, margin, doc.y, {
        width: contentW,
      });
      doc.moveDown(0.2);
    }
  }

  // ── Footer note ─────────────────────────────────────────
  ensureSpace(50);
  doc.moveDown(1);
  doc.font("Helvetica").fontSize(8).fillColor(colors.lightText).text(
    "Pré-validação local GeoForest alinhada ao Importador GEO do SIMCAR (SEMA-MT). " +
      "Não substitui o processamento oficial da SEMA. Tipos de erro: borda se cruza (cluster ~0,05 m), " +
      "pontos repetidos (≤ 0,1 m), conformidade estrutural (CRS, nomenclatura, atributos).",
    margin,
    doc.y,
    { width: contentW, align: "left" },
  );

  // page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.font("Helvetica").fontSize(8).fillColor(colors.lightText).text(
      `Página ${i + 1} de ${range.count}  ·  GeoForest IA  ·  ${when}`,
      margin,
      pageH - 28,
      { width: contentW, align: "center" },
    );
  }

  doc.end();
  return done;
}
