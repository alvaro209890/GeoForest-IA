import { describe, expect, it } from "vitest";
import { normalizarCarEstadual, parseReciboText } from "./recibo-parse";

/**
 * Layout REAL do "Recibo de Inscrição CAR – MT" extraído por pdf-parse
 * (capturado ao vivo em 2026-08-05 via `Publico/DownloadReciboCar`).
 * Rótulos e valores ficam em linhas separadas, com as colunas coladas.
 * Nome/CPF do proprietário substituídos por dados fictícios.
 */
const RECIBO_ESTADUAL = `

Palácio Paiaguás, Rua C, CEP: 78.049-913 - Cuiabá - Mato GrossoPágina 1 de 2
CNPJ: 03.507.415/0023-5005/08/2026 13:09:16
Recibo de Inscrição CAR – MT
Proprietários
Nome/Razão SocialCPF/CNPJ
Maria Aparecida Teste000.000.000-00
Dados Gerais
Nº CAR EstadualSituação EstadualTipo
MT10005/2019AtivoDeclarado
Data de CadastroData da Situação
09/10/202513/01/2026
Nº Recibo Federal
MT-5107065-AEC311BDEA79437099F3D97F9D599345
Dados da Propriedade
PropriedadeUFMunicípio
LOTE RURAL 81MTQuerência
Dados das Áreas dos Imóveis Rurais
DocumentoTipoÁrea (ha)
Certidão de registro: 6884Matrícula59,5260
`;

describe("normalizarCarEstadual", () => {
  it.each([
    ["MT10005/2019", "MT10005/2019"],
    ["MT-10005/2019", "MT10005/2019"],
    ["MT 10005 / 2019", "MT10005/2019"],
    ["mt319367/2025", "MT319367/2025"],
  ])("%s → %s", (entrada, esperado) => {
    expect(normalizarCarEstadual(entrada)).toBe(esperado);
  });

  it("devolve null quando não há número de CAR", () => {
    expect(normalizarCarEstadual("documento qualquer")).toBeNull();
    expect(normalizarCarEstadual(null)).toBeNull();
  });
});

describe("parseReciboText — recibo estadual (layout real)", () => {
  const parsed = parseReciboText(RECIBO_ESTADUAL, "CAR - Recibo de Inscricao.pdf");

  it("extrai o CAR estadual da linha seguinte ao rótulo", () => {
    expect(parsed.carEstadual).toBe("MT10005/2019");
  });

  it("extrai o recibo federal", () => {
    expect(parsed.reciboFederal).toBe("MT-5107065-AEC311BDEA79437099F3D97F9D599345");
  });

  it("separa propriedade e município da linha colada com a UF", () => {
    expect(parsed.propriedade).toBe("LOTE RURAL 81");
    expect(parsed.municipio).toBe("Querência");
  });

  it("extrai o proprietário sem o CPF colado", () => {
    expect(parsed.proprietario).toBe("Maria Aparecida Teste");
  });

  it("não reporta erro quando identificou o CAR", () => {
    expect(parsed.erro).toBeNull();
    expect(parsed.filename).toBe("CAR - Recibo de Inscricao.pdf");
  });

  it("não confunde o CNPJ da SEMA com o número do CAR", () => {
    expect(parsed.carEstadual).not.toContain("03");
  });
});

describe("parseReciboText — variações", () => {
  it("aceita propriedade cujo nome termina em MT (UF é o último MT da linha)", () => {
    const texto = [
      "Nº CAR EstadualSituação EstadualTipo",
      "MT319367/2025AtivoDeclarado",
      "PropriedadeUFMunicípio",
      "FAZENDA MTMTSorriso",
    ].join("\n");
    const parsed = parseReciboText(texto, "x.pdf");
    expect(parsed.propriedade).toBe("FAZENDA MT");
    expect(parsed.municipio).toBe("Sorriso");
  });

  it("cai no layout 'rótulo: valor' quando o recibo é federal/SICAR", () => {
    const texto = [
      "Recibo de Inscrição no CAR",
      "Registro no CAR: MT-5107065-AEC311BDEA79437099F3D97F9D599345",
      "Propriedade: SITIO BOA VISTA",
      "Município: Nova Xavantina",
    ].join("\n");
    const parsed = parseReciboText(texto, "federal.pdf");
    expect(parsed.carEstadual).toBeNull();
    expect(parsed.reciboFederal).toBe("MT-5107065-AEC311BDEA79437099F3D97F9D599345");
    expect(parsed.propriedade).toBe("SITIO BOA VISTA");
    expect(parsed.municipio).toBe("Nova Xavantina");
    expect(parsed.erro).toBeNull();
  });

  it("marca erro quando o PDF não tem CAR nem recibo federal", () => {
    const parsed = parseReciboText("Contrato de arrendamento\nsem numeros relevantes", "outro.pdf");
    expect(parsed.carEstadual).toBeNull();
    expect(parsed.reciboFederal).toBeNull();
    expect(parsed.erro).toContain("outro.pdf");
  });
});
