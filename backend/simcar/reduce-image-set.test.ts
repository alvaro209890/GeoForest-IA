/**
 * Conjunto reduzido de imagens no retry da análise de visão.
 *
 * Desde `0e429b3b` cada satélite gera **um** composite, já rotulado
 * "Visão Geral" — o filtro antigo deixou de reduzir qualquer coisa e o retry
 * remandava o mesmo payload. Com a janela AC/AVN contígua de 2003 a 2008 são 7
 * cenas por análise, então a redução precisa acontecer de verdade e precisa
 * preservar as cenas que decidem a consolidação.
 */
import { describe, expect, it } from "vitest";

import { reduceImageSet } from "./cloudinary";
import type { AiImage } from "./types";

const img = (caption: string): AiImage => ({ dataUrl: "data:image/jpeg;base64,AAAA", caption });

/** Janela AC/AVN atual: 2003–2008 ano a ano, com SPOT e Landsat em 2008. */
const janelaAcAvn = (): AiImage[] =>
    [
        "Landsat 5 (2003) — Visão Geral (AC + AVN + AUAS)",
        "Landsat 5 (2004) — Visão Geral (AC + AVN + AUAS)",
        "Landsat 5 (2005) — Visão Geral (AC + AVN + AUAS)",
        "Landsat 5 (2006) — Visão Geral (AC + AVN + AUAS)",
        "Landsat 5 (2007) — Visão Geral (AC + AVN + AUAS)",
        "SPOT 2008 — Visão Geral (AC + AVN + AUAS)",
        "Landsat 5 (2008) — Visão Geral (AC + AVN + AUAS)",
    ].map(img);

describe("reduceImageSet", () => {
    it("reduz de verdade quando todo composite já é 'Visão Geral'", () => {
        const reduced = reduceImageSet(janelaAcAvn());
        expect(reduced.length).toBe(3);
        expect(reduced.length).toBeLessThan(janelaAcAvn().length);
    });

    it("mantém o SPOT 2008 — base da Nota Técnica 001/2017 e cena de maior peso", () => {
        const captions = reduceImageSet(janelaAcAvn()).map((i) => i.caption);
        expect(captions.some((c) => /spot/i.test(c))).toBe(true);
    });

    it("prioriza as cenas dos dois marcos legais (2008 e 2003)", () => {
        const captions = reduceImageSet(janelaAcAvn(), 3).map((i) => i.caption);
        expect(captions.some((c) => c.includes("2008") && !/spot/i.test(c))).toBe(true);
        expect(captions.some((c) => c.includes("2003"))).toBe(true);
    });

    it("respeita o teto pedido", () => {
        expect(reduceImageSet(janelaAcAvn(), 5)).toHaveLength(5);
        expect(reduceImageSet(janelaAcAvn(), 1)).toHaveLength(1);
    });

    it("não corta nada quando a janela já cabe no teto", () => {
        const curta = [img("SPOT 2008 — Visão Geral"), img("Landsat 5 (2003) — Visão Geral")];
        expect(reduceImageSet(curta, 3)).toHaveLength(2);
    });

    it("preserva o comportamento antigo: 3 vistas por satélite caem para a Visão Geral", () => {
        const legado = [
            img("SPOT 2008 — Visão Geral"),
            img("SPOT 2008 — Somente AC"),
            img("SPOT 2008 — Somente AVN"),
            img("Landsat 5 (2007) — Visão Geral"),
            img("Landsat 5 (2007) — Somente AC"),
            img("Landsat 5 (2007) — Somente AVN"),
        ];
        const reduced = reduceImageSet(legado);
        expect(reduced).toHaveLength(2);
        expect(reduced.every((i) => i.caption.includes("Visão Geral"))).toBe(true);
    });

    it("não zera a lista quando nenhuma legenda tem 'Visão Geral'", () => {
        const semRotulo = [img("Cena A 2008"), img("Cena B 2007"), img("Cena C 2006"), img("Cena D 2003")];
        expect(reduceImageSet(semRotulo).length).toBeGreaterThan(0);
    });
});
