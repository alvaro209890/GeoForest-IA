/**
 * Geração das planilhas ExcelJS (SIGEF×CAR estadual, SIGEF×CAR federal e CAR×CAR).
 */
import ExcelJS from "exceljs";
import { OverlapDetailEstadual, OverlapDetailFederal, TargetParcel } from "./types";
import { round4 } from "./utils";

export const FILL_HEADER: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E79" } };
export const FILL_GREEN: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFC6EFCE" } };
export const FILL_YELLOW: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
export const FILL_BLUE: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFBDD7EE" } };
export const FONT_HEADER: Partial<ExcelJS.Font> = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

export function styleHeader(row: ExcelJS.Row): void {
  row.eachCell((cell) => {
    cell.fill = FILL_HEADER;
    cell.font = FONT_HEADER;
    cell.alignment = { wrapText: true, vertical: "middle" };
  });
  row.height = 28;
}

export function detailFill(row: {
  isOwn?: boolean;
  isCancelled?: boolean;
  overlapPct: number;
}): ExcelJS.Fill | undefined {
  if (row.isOwn) return FILL_BLUE;
  if (row.isCancelled) return FILL_YELLOW;
  if (row.overlapPct < 1) return FILL_GREEN;
  return undefined;
}

export async function buildSigefCarEstadualXlsx(args: {
  targets: TargetParcel[];
  details: OverlapDetailEstadual[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GeoForest-IA";

  const resumo = wb.addWorksheet("Resumo por imovel");
  resumo.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Qtd CARs estaduais sobrepostos",
    "Situacao dos CARs estaduais sobrepostos",
    "Area total sobreposta c/ CAR estadual (ha)",
    "% da area sobreposta c/ CAR estadual",
    "Area livre de CAR estadual (ha)",
    "% area livre",
  ]);
  styleHeader(resumo.getRow(1));

  for (const t of args.targets) {
    const rows = args.details.filter((d) => d.targetId === t.id);
    const situacaoCounts = new Map<string, number>();
    for (const r of rows) {
      situacaoCounts.set(r.situacao, (situacaoCounts.get(r.situacao) || 0) + 1);
    }
    const situacaoTxt = Array.from(situacaoCounts.entries())
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    // Approximate union of overlaps via sum capped at target area (conservative for summary)
    const overlapSum = Math.min(
      t.areaHa,
      rows.reduce((acc, r) => acc + r.overlapHa, 0),
    );
    const pct = t.areaHa > 0 ? (overlapSum / t.areaHa) * 100 : 0;
    const livre = Math.max(0, t.areaHa - overlapSum);
    resumo.addRow([
      t.label,
      round4(t.areaHa),
      rows.length,
      situacaoTxt,
      round4(overlapSum),
      round4(pct),
      round4(livre),
      round4(t.areaHa > 0 ? (livre / t.areaHa) * 100 : 0),
    ]);
  }

  const det = wb.addWorksheet("Detalhe sobreposicao Estadual");
  det.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Numero estadual (CAR)",
    "Nome da propriedade (CAR estadual)",
    "CAR federal vinculado",
    "Situacao",
    "Encontrado em",
    "Area total do CAR estadual (ha)",
    "Area de sobreposicao (ha)",
    "% da area do imovel sobreposta",
    "Protocolo",
  ]);
  styleHeader(det.getRow(1));
  for (const d of args.details) {
    const row = det.addRow([
      d.targetLabel,
      round4(d.targetAreaHa),
      d.numeroEstadual,
      d.nomePropriedade,
      d.carFederal,
      d.situacao,
      d.encontradoEm,
      round4(d.carAreaHa),
      round4(d.overlapHa),
      round4(d.overlapPct),
      d.protocolo,
    ]);
    const fill = detailFill(d);
    if (fill) row.eachCell((c) => (c.fill = fill));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildSigefCarFederalXlsx(args: {
  targets: TargetParcel[];
  details: OverlapDetailFederal[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const resumo = wb.addWorksheet("Resumo por imovel");
  resumo.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Qtd CARs sobrepostos",
    "Situacao dos CARs sobrepostos",
    "Area total sobreposta c/ CAR (ha)",
    "% da area sobreposta c/ CAR",
    "Area livre de CAR (ha)",
    "% area livre",
  ]);
  styleHeader(resumo.getRow(1));

  for (const t of args.targets) {
    const rows = args.details.filter((d) => d.targetId === t.id);
    const situacaoCounts = new Map<string, number>();
    for (const r of rows) {
      situacaoCounts.set(r.status, (situacaoCounts.get(r.status) || 0) + 1);
    }
    const situacaoTxt = Array.from(situacaoCounts.entries())
      .map(([k, n]) => `${k} (${n})`)
      .join(", ");
    const overlapSum = Math.min(
      t.areaHa,
      rows.reduce((acc, r) => acc + r.overlapHa, 0),
    );
    const pct = t.areaHa > 0 ? (overlapSum / t.areaHa) * 100 : 0;
    const livre = Math.max(0, t.areaHa - overlapSum);
    resumo.addRow([
      t.label,
      round4(t.areaHa),
      rows.length,
      situacaoTxt,
      round4(overlapSum),
      round4(pct),
      round4(livre),
      round4(t.areaHa > 0 ? (livre / t.areaHa) * 100 : 0),
    ]);
  }

  const det = wb.addWorksheet("Detalhe sobreposicoes CAR");
  det.addRow([
    "Imovel (SIGEF)",
    "Area do imovel (ha)",
    "Codigo do CAR",
    "Situacao do CAR",
    "Condicao (analise)",
    "Area total do CAR (ha)",
    "Area de sobreposicao (ha)",
    "% da area do imovel sobreposta",
  ]);
  styleHeader(det.getRow(1));
  for (const d of args.details) {
    const row = det.addRow([
      d.targetLabel,
      round4(d.targetAreaHa),
      d.codImovel,
      d.status,
      d.condicao,
      round4(d.carAreaHa),
      round4(d.overlapHa),
      round4(d.overlapPct),
    ]);
    const fill = detailFill({ isCancelled: d.isCancelled, overlapPct: d.overlapPct });
    if (fill) row.eachCell((c) => (c.fill = fill));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildCarEstadualVsCarEstadualXlsx(args: {
  targets: Array<TargetParcel & { numeroEstadual?: string; situacao?: string }>;
  details: OverlapDetailEstadual[];
  ourNumeros: Set<string>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const intro = wb.addWorksheet("1. Leia primeiro");
  intro.getColumn(1).width = 3;
  intro.getColumn(2).width = 100;
  intro.getCell("B2").value = "ANALISE DE SOBREPOSICAO — CAR ESTADUAL x CAR ESTADUAL";
  intro.getCell("B2").font = { bold: true, size: 14, color: { argb: "FF1F4E79" } };
  intro.getCell("B3").value = "Fonte: SEMA-MT (geoportal.sema.mt.gov.br) • Gerado pelo GeoForest-IA";
  intro.getCell("B3").font = { italic: true, size: 10, color: { argb: "FF808080" } };
  intro.getCell("B5").value = "O QUE FOI FEITO";
  intro.getCell("B5").font = { bold: true, color: { argb: "FF1F4E79" } };
  intro.getCell("B6").value =
    "Comparei cada CAR estadual das suas propriedades contra todos os outros CARs estaduais " +
    "na região (incluindo vizinhos). Para cada par calculei a área exata de sobreposição.";
  intro.getCell("B6").alignment = { wrapText: true };
  intro.getRow(6).height = 40;

  const meaningful = args.details.filter((d) => d.overlapPct >= 1 || d.isCancelled);
  intro.getCell("B8").value = "RESULTADO — EM UMA FRASE";
  intro.getCell("B8").font = { bold: true, color: { argb: "FF1F4E79" } };
  intro.getCell("B9").value = meaningful.length
    ? `${meaningful.length} sobreposição(ões) merecem atenção (ver aba 2 e 3).`
    : "Nenhuma propriedade tem sobreposição real com CAR de terceiros — só frestas de divisa.";
  intro.getCell("B9").fill = meaningful.length ? FILL_YELLOW : FILL_GREEN;
  intro.getCell("B9").font = { bold: true };

  intro.getCell("B11").value = "LEGENDA DE CORES (aba de detalhe)";
  intro.getCell("B11").font = { bold: true, color: { argb: "FF1F4E79" } };
  intro.getCell("B12").value = "Azul = CAR da sua propriedade  |  Amarelo = CAR cancelado  |  Verde = sobreposição < 1% (fresta de divisa)";

  const res = wb.addWorksheet("2. Resultado por imovel");
  res.addRow(["RESULTADO POR IMOVEL"]);
  res.addRow(["Um olhar rápido: cada propriedade sua e o veredito"]);
  res.addRow(["Sua propriedade", "CAR estadual", "Situacao do seu CAR", "Area (ha)", "RESULTADO", "Explicacao"]);
  styleHeader(res.getRow(3));

  for (const t of args.targets) {
    const rows = args.details.filter((d) => d.targetId === t.id && !args.ourNumeros.has(d.numeroEstadual));
    const big = rows.filter((d) => d.overlapPct >= 1);
    const cancelled = rows.filter((d) => d.isCancelled && d.overlapPct >= 1);
    let resultado = "OK";
    let explicacao = "Nenhuma sobreposicao real. So encostos de divisa.";
    if (cancelled.length) {
      resultado = "CONFERIR";
      explicacao = `Sobreposição relevante com CAR cancelado (${cancelled.map((c) => c.numeroEstadual).join(", ")}).`;
    } else if (big.length) {
      resultado = "CONFERIR";
      explicacao = `Sobreposição ≥1% com ${big.map((c) => c.numeroEstadual).join(", ")}.`;
    }
    const row = res.addRow([
      t.label,
      t.numeroEstadual || "",
      t.situacao || "",
      round4(t.areaHa),
      resultado,
      explicacao,
    ]);
    if (resultado === "OK") row.getCell(5).fill = FILL_GREEN;
    else row.getCell(5).fill = FILL_YELLOW;
  }

  const det = wb.addWorksheet("3. Detalhe completo");
  det.addRow(["DETALHE DE CADA SOBREPOSICAO ENCONTRADA"]);
  det.addRow(["Ordenado do mais importante para o menos."]);
  det.addRow([
    "Sua propriedade",
    "Seu CAR",
    "CAR que sobrepoe",
    "Nome no CAR que sobrepoe",
    "Situacao dele",
    "De quem e",
    "Sobreposicao",
    "% do seu imovel",
    "O QUE SIGNIFICA",
    "Precisa fazer algo?",
  ]);
  styleHeader(det.getRow(3));

  const sorted = [...args.details].sort((a, b) => b.overlapHa - a.overlapHa);
  for (const d of sorted) {
    if (args.ourNumeros.has(d.numeroEstadual) && d.overlapPct < 0.01) continue;
    const deQuem = args.ourNumeros.has(d.numeroEstadual) ? "SUA propriedade" : "Terceiro";
    const overlapTxt =
      d.overlapHa >= 0.01 ? `${round4(d.overlapHa)} ha` : `${Math.round(d.overlapHa * 10000)} m2`;
    const pctTxt = d.overlapPct < 0.01 ? "menos de 0,01%" : `${round4(d.overlapPct)}%`;
    let significa = "Divisa normal / fresta de mapa.";
    let acao = "Nao.";
    if (d.isCancelled && d.overlapPct >= 1) {
      significa = "Possível registro antigo cancelado sobre a mesma terra.";
      acao = "Confirmar cancelamento na SEMA.";
    } else if (d.overlapPct >= 1 && deQuem === "Terceiro") {
      significa = "Sobreposição relevante com CAR de terceiro.";
      acao = "Analisar no geoportal.";
    } else if (deQuem === "SUA propriedade") {
      significa = "Divisa com outra propriedade sua do mesmo grupo.";
      acao = "Nao.";
    }
    const row = det.addRow([
      d.targetLabel,
      args.targets.find((t) => t.id === d.targetId)?.numeroEstadual || "",
      d.numeroEstadual,
      d.nomePropriedade,
      d.situacao,
      deQuem,
      overlapTxt,
      pctTxt,
      significa,
      acao,
    ]);
    const fill = detailFill(d);
    if (fill) row.eachCell((c) => (c.fill = fill));
  }

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

/* ─────────────────────────── core job ─────────────────────────── */
