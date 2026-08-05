import { describe, expect, it } from "vitest";
import { extractZipEntries } from "../geo-utils";
import {
  desambiguarPastas,
  montarRelatorioTxt,
  montarZipLotes,
  nomePastaLote,
  nomeZipLotes,
  safeFilename,
} from "./zip-builder";
import type { RelatorioLote } from "./types";

const ZIP = Buffer.from("PK\u0003\u0004conteudo", "latin1");
const PDF = Buffer.from("%PDF-1.5 recibo", "latin1");

describe("nomePastaLote", () => {
  it("monta <CAR sem barra> - <propriedade sanitizada>", () => {
    expect(nomePastaLote("MT10005/2019", "LOTE RURAL 81")).toBe("MT10005-2019 - LOTE_RURAL_81");
  });

  it("remove acentos da propriedade (evita mojibake no Windows)", () => {
    expect(nomePastaLote("MT319367/2025", "Fazenda São João")).toBe("MT319367-2025 - Fazenda_Sao_Joao");
  });

  it("usa só o CAR quando não há propriedade", () => {
    expect(nomePastaLote("MT10005/2019", null)).toBe("MT10005-2019");
  });

  it("tem fallback quando o CAR é desconhecido", () => {
    expect(nomePastaLote(null, null)).toBe("CAR_SEM_NUMERO");
  });
});

describe("safeFilename / desambiguarPastas", () => {
  it("sanitiza e trunca", () => {
    expect(safeFilename("a/b\\c:d*e", "x")).toBe("a_b_c_d_e");
    expect(safeFilename("", "fallback")).toBe("fallback");
  });

  it("numera pastas repetidas", () => {
    expect(desambiguarPastas(["A", "B", "A", "A"])).toEqual(["A", "B", "A (2)", "A (3)"]);
  });
});

describe("montarZipLotes", () => {
  it("cria uma pasta por lote com os artefatos dentro", async () => {
    const zip = await montarZipLotes([
      {
        nomePasta: "MT10005-2019 - LOTE_RURAL_81",
        arquivos: [
          { nome: "Arquivo Enviado.zip", buffer: ZIP },
          { nome: "Arquivo Processado.zip", buffer: ZIP },
          { nome: "Recibo de Inscricao.pdf", buffer: PDF },
        ],
      },
      {
        nomePasta: "MT319367-2025 - FAZENDA_X",
        arquivos: [{ nome: "Arquivo Enviado.zip", buffer: ZIP }],
      },
    ]);

    const nomes = extractZipEntries(zip).map((entry) => entry.name).sort();
    expect(nomes).toEqual([
      "MT10005-2019 - LOTE_RURAL_81/Arquivo Enviado.zip",
      "MT10005-2019 - LOTE_RURAL_81/Arquivo Processado.zip",
      "MT10005-2019 - LOTE_RURAL_81/Recibo de Inscricao.pdf",
      "MT319367-2025 - FAZENDA_X/Arquivo Enviado.zip",
    ]);
  });

  it("preserva o conteúdo dos artefatos", async () => {
    const zip = await montarZipLotes([
      { nomePasta: "LOTE", arquivos: [{ nome: "Recibo de Inscricao.pdf", buffer: PDF }] },
    ]);
    const entry = extractZipEntries(zip).find((e) => e.name.endsWith(".pdf"));
    expect(entry?.data.equals(PDF)).toBe(true);
  });

  it("desambigua pastas de mesmo nome", async () => {
    const zip = await montarZipLotes([
      { nomePasta: "LOTE", arquivos: [{ nome: "a.pdf", buffer: PDF }] },
      { nomePasta: "LOTE", arquivos: [{ nome: "a.pdf", buffer: PDF }] },
    ]);
    const nomes = extractZipEntries(zip).map((e) => e.name).sort();
    expect(nomes).toEqual(["LOTE (2)/a.pdf", "LOTE/a.pdf"]);
  });

  it("inclui o RELATORIO.txt na raiz quando há relatório", async () => {
    const relatorio: RelatorioLote[] = [
      {
        filename: "recibo.pdf",
        car: "MT10005/2019",
        propriedade: "LOTE RURAL 81",
        municipio: "Querência",
        pasta: "MT10005-2019 - LOTE_RURAL_81",
        baixados: ["Arquivo Enviado.zip"],
        faltantes: ["Arquivo Processado.zip"],
        erro: null,
      },
    ];
    const zip = await montarZipLotes(
      [{ nomePasta: "MT10005-2019 - LOTE_RURAL_81", arquivos: [{ nome: "Arquivo Enviado.zip", buffer: ZIP }] }],
      relatorio,
    );
    const entry = extractZipEntries(zip).find((e) => e.name === "RELATORIO.txt");
    const texto = entry?.data.toString("utf8") || "";
    expect(texto).toContain("MT10005/2019");
    expect(texto).toContain("Faltantes na SEMA: Arquivo Processado.zip");
  });
});

describe("montarRelatorioTxt", () => {
  const base: RelatorioLote = {
    filename: "recibo.pdf",
    car: null,
    propriedade: null,
    municipio: null,
    pasta: null,
    baixados: [],
    faltantes: [],
    erro: "CAR não localizado na conta SIMCAR informada.",
  };

  it("registra o erro do lote sem quebrar o relatório", () => {
    const texto = montarRelatorioTxt([base]);
    expect(texto).toContain("ERRO: CAR não localizado");
    expect(texto).toContain("Baixados: (nenhum)");
  });

  it("avisa quando o ZIP é parcial por cancelamento", () => {
    expect(montarRelatorioTxt([base], true)).toContain("CANCELADO");
  });
});

describe("nomeZipLotes", () => {
  it("usa carimbo de data/hora local", () => {
    expect(nomeZipLotes(new Date(2026, 7, 5, 14, 2, 33))).toBe("lotes_simcar_20260805-140233.zip");
  });
});
