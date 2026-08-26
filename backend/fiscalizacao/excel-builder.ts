/**
 * Planilha das ocorrências de fiscalização: um resumo + uma aba por fonte.
 */
import ExcelJS from "exceljs";
import { relacaoLabel } from "./analysis";
import { KIND_LABELS, SOURCE_LABELS } from "./constants";
import { FONT_HEADER, styleHeader } from "../overlap/excel-builder";
import { round4 } from "../overlap/utils";
import type { FiscalizacaoSourceResult } from "./types";

const FILL_INCIDENTE: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFC7CE" },
};
const FILL_CONFRONTANTE: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFFFEB9C" },
};

const COLUNAS = [
  { header: "Relacao com a ATP", width: 34 },
  { header: "Camada / fonte", width: 30 },
  { header: "Natureza", width: 16 },
  { header: "Nome / razao social", width: 34 },
  { header: "CPF / CNPJ", width: 20 },
  { header: "Documento (TAD / auto)", width: 22 },
  { header: "Processo", width: 20 },
  { header: "Data", width: 12 },
  { header: "Ano", width: 8 },
  { header: "Municipio", width: 18 },
  { header: "Imovel", width: 30 },
  { header: "Situacao", width: 22 },
  { header: "Area declarada (ha)", width: 18 },
  { header: "Area do poligono (ha)", width: 18 },
  { header: "Sobreposicao c/ ATP (ha)", width: 20 },
  { header: "% da ATP", width: 11 },
  { header: "Distancia ate a ATP (m)", width: 20 },
  { header: "Descricao", width: 70 },
];

export async function buildFiscalizacaoXlsx(args: {
  atpNome: string;
  atpAreaHa: number;
  results: FiscalizacaoSourceResult[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GeoForest-IA";
  wb.created = new Date();

  /* ── Resumo ───────────────────────────────────────────── */
  const resumo = wb.addWorksheet("Resumo");
  resumo.addRow(["Analise de fiscalizacao — GeoForest IA"]).font = { bold: true, size: 14 };
  resumo.addRow([]);
  resumo.addRow(["Imovel (ATP)", args.atpNome]);
  resumo.addRow(["Area da ATP (ha)", round4(args.atpAreaHa)]);
  resumo.addRow(["Consulta em", new Date().toLocaleString("pt-BR")]);
  resumo.addRow([]);

  const cabecalho = resumo.addRow([
    "Fonte",
    "Feicoes na regiao",
    "Incidentes na ATP",
    "Area total sobreposta (ha)",
    "Observacao",
  ]);
  styleHeader(cabecalho);

  for (const result of args.results) {
    const incidentes = result.records.filter((r) => r.incidente);
    const somaHa = incidentes.reduce((acc, r) => acc + r.sobreposicaoHa, 0);
    const confrontantes = result.records.filter((r) => !r.incidente && r.distanciaM >= 0 && r.distanciaM <= 1);
    const observacao = result.error
      ? `FALHA NA CONSULTA: ${result.error}`
      : incidentes.length
        ? `${incidentes.length} ocorrencia(s) incidente(s)`
        : confrontantes.length
          ? `Sem incidencia, mas ${confrontantes.length} confrontante(s) na divisa`
          : "Nenhuma ocorrencia incidente";

    const row = resumo.addRow([
      SOURCE_LABELS[result.source],
      result.records.length,
      incidentes.length,
      round4(somaHa),
      observacao,
    ]);
    if (result.error) row.getCell(5).font = { bold: true, color: { argb: "FFB71C1C" } };
    else if (incidentes.length) row.eachCell((c) => (c.fill = FILL_INCIDENTE));
    else if (confrontantes.length) row.eachCell((c) => (c.fill = FILL_CONFRONTANTE));
  }

  resumo.getColumn(1).width = 32;
  resumo.getColumn(2).width = 18;
  resumo.getColumn(3).width = 18;
  resumo.getColumn(4).width = 24;
  resumo.getColumn(5).width = 52;

  const nota = resumo.addRow([]);
  nota.getCell(1).value =
    "Legenda: vermelho = ha sobreposicao de area com a ATP; amarelo = feicao confrontante (divisa encostada, sem area comum).";
  nota.getCell(1).font = { italic: true, size: 9, color: { argb: "FF595959" } };

  /* ── Uma aba por fonte ────────────────────────────────── */
  for (const result of args.results) {
    const ws = wb.addWorksheet(result.source.toUpperCase());
    const header = ws.addRow(COLUNAS.map((c) => c.header));
    styleHeader(header);
    COLUNAS.forEach((c, i) => (ws.getColumn(i + 1).width = c.width));

    if (result.error) {
      const row = ws.addRow([`FALHA NA CONSULTA: ${result.error}`]);
      row.getCell(1).font = { bold: true, color: { argb: "FFB71C1C" } };
      continue;
    }
    if (!result.records.length) {
      ws.addRow(["Nenhuma feicao encontrada no raio de busca."]).getCell(1).font = {
        italic: true,
        color: { argb: "FF595959" },
      };
      continue;
    }

    for (const record of result.records) {
      const row = ws.addRow([
        relacaoLabel(record),
        record.layerLabel,
        KIND_LABELS[record.kind],
        record.nome,
        record.cpfCnpj,
        record.documento,
        record.numeroProcesso,
        record.data,
        record.ano,
        record.municipio,
        record.imovel,
        record.situacao,
        round4(record.areaDeclaradaHa),
        round4(record.areaGeomHa),
        round4(record.sobreposicaoHa),
        record.percentualAtp,
        record.distanciaM < 0 ? "" : Math.round(record.distanciaM),
        record.descricao,
      ]);
      if (record.incidente) row.eachCell((c) => (c.fill = FILL_INCIDENTE));
      else if (record.distanciaM >= 0 && record.distanciaM <= 1) {
        row.eachCell((c) => (c.fill = FILL_CONFRONTANTE));
      }
      row.getCell(18).alignment = { wrapText: true, vertical: "top" };
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLUNAS.length } };
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}

export { FONT_HEADER };
