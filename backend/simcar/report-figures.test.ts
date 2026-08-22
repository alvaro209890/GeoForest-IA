/**
 * Seleção das cenas do Anexo Fotográfico.
 *
 * Regressão real, achada no laudo de um job de produção (`8d67f503`,
 * 21/08/2026): o anexo saiu com 2003, 2004, 2005 e 2006 — **sem o SPOT 2008**,
 * que é a cena de maior peso probatório (2,5 m, base da Nota Técnica 001/2017
 * da SEMA-MT).
 *
 * Causa: a pontuação era por PALAVRA na legenda (+5 "Visão Geral", +3 citar
 * AC/AVN/AUAS, +1 citar o sensor). Isso discriminava quando cada satélite
 * gerava 3 vistas com legendas distintas. Desde `0e429b3b` cada satélite gera
 * um composite rotulado "<sensor> — Visão Geral (AC + AVN + AUAS)": as três
 * regras passaram a valer para todas as imagens, todas empataram em 9 pontos, o
 * sort virou no-op e o corte manteve as 4 primeiras por ordem de array — os
 * anos mais antigos.
 *
 * Ficou invisível enquanto a janela tinha 4 cenas (o corte de 4 não cortava
 * nada). Abrir a janela para 2003–2008 expôs o furo.
 */
import { describe, expect, it } from "vitest";

import { selectPrincipalReportImages } from "./report";

/** Legendas exatas do job de produção que motivou o teste. */
const JANELA_REAL = [
    "Landsat 5 (2003) — Visão Geral (AC + AVN + AUAS)",
    "Landsat 5 (2004) — Visão Geral (AC + AVN + AUAS)",
    "Landsat 5 (2005) — Visão Geral (AC + AVN + AUAS)",
    "Landsat 5 (2006) — Visão Geral (AC + AVN + AUAS)",
    "Landsat 5 (2007) — Visão Geral (AC + AVN + AUAS)",
    "Landsat 5 (2008) — Visão Geral (AC + AVN + AUAS)",
    "SPOT 2008 — Visão Geral (AC + AVN + AUAS)",
].map((caption, i) => ({ url: `/img/ac-${i}.png`, caption }));

describe("selectPrincipalReportImages", () => {
    it("o SPOT 2008 entra no anexo — foi ele que sumia", () => {
        const escolhidas = selectPrincipalReportImages(JANELA_REAL, []);
        expect(escolhidas.some((img) => /spot/i.test(img.caption))).toBe(true);
    });

    it("o SPOT 2008 vem primeiro, por peso probatório", () => {
        expect(selectPrincipalReportImages(JANELA_REAL, [])[0].caption).toContain("SPOT");
    });

    it("a janela AC/AVN inteira cabe — cortar cena esconde a datação", () => {
        const escolhidas = selectPrincipalReportImages(JANELA_REAL, []);
        expect(escolhidas).toHaveLength(JANELA_REAL.length);
        for (const ano of [2003, 2004, 2005, 2006, 2007, 2008]) {
            expect(
                escolhidas.some((img) => img.caption.includes(String(ano))),
                `ano ${ano} fora do anexo`,
            ).toBe(true);
        }
    });

    it("depois do SPOT vêm o marco de 2008 e o marco do pousio de 2003", () => {
        const ordem = selectPrincipalReportImages(JANELA_REAL, []).map((img) => img.caption);
        expect(ordem[1]).toContain("2008");
        expect(ordem[2]).toContain("2003");
    });

    it("a imagem de Destaque AVN fica ANTES das demais cenas (regressão achado 21/08/2026)", () => {
        const comDestaque = [
            ...JANELA_REAL,
            { url: "/img/destaque-avn.png", caption: "SPOT 2008 — Destaque AVN (Área Consolidada dentro do polígono AVN) · Acervo" },
        ];
        const escolhidas = selectPrincipalReportImages(comDestaque, []);
        expect(escolhidas[0].caption).toContain("Destaque AVN");
        expect(escolhidas[0].caption).toContain("SPOT");
        // as demais cenas continuam presentes (janela inteira)
        expect(escolhidas).toHaveLength(comDestaque.length);
    });

    it("a imagem de Destaque Reservatório fica ANTES das demais cenas (regressão Lote 81)", () => {
        const comReserv = [
            ...JANELA_REAL,
            { url: "/img/destaque-reserv.png", caption: "SPOT 2008 — Destaque Reservatório Artificial (lâmina d'água do recorte) · Acervo" },
        ];
        const escolhidas = selectPrincipalReportImages(comReserv, []);
        expect(escolhidas[0].caption).toContain("Destaque Reservatório");
        // janela AC/AVN continua completa após o destaque
        expect(escolhidas).toHaveLength(comReserv.length);
        expect(escolhidas.some((img) => /spot/i.test(img.caption) && !/destaque/i.test(img.caption))).toBe(true);
    });

    it("quando precisa cortar, corta o ano mais distante do marco", () => {
        // 12 cenas AC/AVN estouram o teto; o SPOT e os marcos têm que sobreviver.
        const muitas = Array.from({ length: 12 }, (_, i) => ({
            url: `/img/x-${i}.png`,
            caption: `Landsat 5 (${1996 + i}) — Visão Geral (AC + AVN + AUAS)`,
        }));
        const comSpot = [...muitas, { url: "/img/spot.png", caption: "SPOT 2008 — Visão Geral (AC + AVN + AUAS)" }];
        const escolhidas = selectPrincipalReportImages(comSpot, []);
        expect(escolhidas.some((img) => /spot/i.test(img.caption))).toBe(true);
        expect(escolhidas.some((img) => img.caption.includes("2003"))).toBe(true);
        // 1996 é o mais distante do marco — é o primeiro a cair.
        expect(escolhidas.some((img) => img.caption.includes("1996"))).toBe(false);
    });

    it("as cenas da AUAS entram depois das de AC/AVN, sem disputar vaga", () => {
        const auas = [
            { url: "/img/auas-1.png", caption: "Sentinel-2 (2019) — Visão Geral (AUAS)" },
            { url: "/img/auas-2.png", caption: "Landsat 8 (2015) — Visão Geral (AUAS)" },
        ];
        const escolhidas = selectPrincipalReportImages(JANELA_REAL, auas);
        expect(escolhidas).toHaveLength(JANELA_REAL.length + auas.length);
        expect(escolhidas[0].caption).toContain("SPOT");
        expect(escolhidas.slice(-2).every((img) => img.caption.includes("AUAS)"))).toBe(true);
    });

    it("descarta URL repetida e imagem sem URL", () => {
        const comLixo = [
            ...JANELA_REAL,
            { url: JANELA_REAL[0].url, caption: "duplicata" },
            { url: "", caption: "sem url" },
        ];
        expect(selectPrincipalReportImages(comLixo, [])).toHaveLength(JANELA_REAL.length);
    });

    it("lista vazia não quebra", () => {
        expect(selectPrincipalReportImages([], [])).toEqual([]);
    });
});

/**
 * Regressão da proveniência (21/08/2026).
 *
 * A legenda passou a carregar a origem da cena — `· cena 20/07/2008,
 * órbita/ponto 224/069, acervo IMAP`. Como a seleção do anexo lê texto da
 * legenda, esses casos travam a garantia de que o sufixo não desloca nada.
 */
describe("selectPrincipalReportImages com proveniência na legenda", () => {
    const COM_ORIGEM = [
        "Landsat 5 (2003) — Visão Geral (AC + AVN + AUAS) · cena 07/07/2003, órbita/ponto 224/069, acervo IMAP",
        "Landsat 5 (2004) — Visão Geral (AC + AVN + AUAS) · cena 23/06/2004, órbita/ponto 224/069, acervo IMAP",
        "Landsat 5 (2005) — Visão Geral (AC + AVN + AUAS) · mosaico SEMA-MT",
        "Landsat 5 (2008) — Visão Geral (AC + AVN + AUAS) · cena 20/07/2008, órbita/ponto 224/069, acervo IMAP",
        "SPOT 2008 — Visão Geral (AC + AVN + AUAS) · mosaico de Querencia, acervo IMAP",
    ].map((caption, i) => ({ url: `/img/p-${i}.png`, caption }));

    it("o SPOT continua vindo primeiro mesmo com o sufixo de origem", () => {
        expect(selectPrincipalReportImages(COM_ORIGEM, [])[0].caption).toContain("SPOT");
    });

    it("a data no sufixo não rouba o ano do rótulo", () => {
        // `cena 07/07/2003` traz outro '2003'; a ordem tem que sair pelo rótulo.
        const ordem = selectPrincipalReportImages(COM_ORIGEM, []).map((img) => img.caption);
        expect(ordem[1]).toContain("Landsat 5 (2008)");
        expect(ordem[2]).toContain("Landsat 5 (2003)");
    });

    it("cena de 2004 com data de junho no sufixo não vira cena de 2006", () => {
        const ordem = selectPrincipalReportImages(COM_ORIGEM, []).map((img) => img.caption);
        expect(ordem[ordem.length - 1]).toContain("Landsat 5 (2004)");
    });

    it("nenhuma figura se perde por causa do sufixo", () => {
        expect(selectPrincipalReportImages(COM_ORIGEM, [])).toHaveLength(COM_ORIGEM.length);
    });
});
