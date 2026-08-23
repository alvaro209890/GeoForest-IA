import { Paragraph, TextRun, ImageRun, AlignmentType } from "docx";
import sharp from "sharp";

/**
 * Blocos DOCX do anexo das análises pós-recorte:
 *  1. Seção "Áreas passíveis de discussão" — polígonos SINAL_DE_DUVIDA com os
 *     sinais que motivaram a classificação (desmate parcial/gradual, estado
 *     misto, sobreposição geométrica com AC/AVN).
 *  2. Anexo fotográfico por polígono — TODOS os anos da série de cada polígono,
 *     com as cenas persistidas no storage (`publicImageUrl`), legenda por figura
 *     e nota de estado observado pela IA naquele ano. Vale para as TRÊS fases:
 *     o cabeçalho (série e leitura de cor) vem por parâmetro.
 *
 * Usado pelo `report-docx.ts` (papel timbrado IMAP). PDF continua igual.
 */

export type AuasScenePublic = {
    sceneId: string;
    polygonId: string;
    year: number;
    sensor: string;
    usability: string;
    publicImageUrl?: string;
    /** Fase 2: cena de outra camada usada só para calibrar a troca de sensor. */
    bridge?: boolean;
};

export type AuasPolygonDoubt = {
    polygonId: string;
    areaHa: number;
    status: string;
    doubtSignals?: string[];
    anthropizedFractionByYear?: Record<string, number>;
    geometryChecks?: {
        overlapAcHa: number;
        overlapAvnHa: number;
        hasAcLayer: boolean;
        hasAvnLayer: boolean;
    };
};

const LARGURA_MAX = 560; // px — largura útil do Ofício com margem
const ALTURA_MAX = 380;

/**
 * Comprime a cena antes de embutir no documento.
 *
 * As cenas do WMS em zoom alto chegam a 1,2 MB em PNG cada. Com o anexo agora
 * nas TRÊS fases (a Fase 2 tem 11 anos por polígono), embutir o PNG cru faz o
 * laudo de um imóvel com muitos polígonos passar de centenas de MB — medido:
 * 6 figuras já davam 5,5 MB de PDF. Em JPEG q82, na resolução em que a figura é
 * de fato desenhada, a mesma imagem fica legível com uma fração dos bytes.
 *
 * Falha de compressão devolve o original: figura pesada é melhor que anexo sem
 * figura.
 */
async function comprimirFigura(buffer: Buffer, larguraAlvo: number): Promise<{ data: Buffer; tipo: "jpg" | "png" }> {
    try {
        const data = await sharp(buffer)
            .resize({ width: Math.max(720, Math.round(larguraAlvo * 2)), withoutEnlargement: true })
            .flatten({ background: "#ffffff" })
            .jpeg({ quality: 82, mozjpeg: true })
            .toBuffer();
        return { data, tipo: "jpg" };
    } catch {
        return { data: buffer, tipo: "png" };
    }
}

function fetchImageBufferLocal(url: string): Promise<Buffer> {
    // URL pública servida pelo próprio backend (storage local): caminho absoluto.
    // As URLs públicas têm formato {PUBLIC_API_BASE_URL}/api/storage/users/{uid}/...
    // Baixar via HTTP garante funcionar igual local e produção (túnel).
    return new Promise((resolve, reject) => {
        const fullUrl = url.startsWith("http")
            ? url
            : `${process.env.PUBLIC_API_BASE_URL || "https://geoforest-api.cursar.space"}${url}`;
        import("node:http").catch(() => undefined);
        import("node:https")
            .then(({ default: https }) => {
                const req = https.get(fullUrl, { timeout: 20_000 }, (res) => {
                    if ((res.statusCode || 500) >= 400) {
                        reject(new Error(`HTTP ${res.statusCode} ao baixar cena`));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    res.on("data", (c: Buffer) => chunks.push(c));
                    res.on("end", () => resolve(Buffer.concat(chunks)));
                });
                req.on("error", reject);
                req.on("timeout", () => {
                    req.destroy(new Error("timeout ao baixar cena"));
                });
            })
            .catch(reject);
    });
}

/** Blocos da seção "Áreas passíveis de discussão" (só quando existem). */
export function auasDoubtBlocks(doubtPolygons: AuasPolygonDoubt[]): Array<Paragraph | any> {
    if (doubtPolygons.length === 0) return [];

    const intro: Paragraph[] = [
        new Paragraph({
            spacing: { before: 120, after: 80 },
            children: [
                new TextRun({
                    text: "Áreas Passíveis de Discussão (sinal de desmate parcial/gradual ou inconsistência de declaração)",
                    bold: true,
                    size: 22,
                }),
            ],
        }),
        new Paragraph({
            spacing: { after: 120 },
            children: [
                new TextRun({
                    size: 18,
                    text:
                        "Polígonos AUAS abaixo NÃO apresentaram conversão completa anterior ao marco de 22/07/2008, mas exibiram sinais visuais sutis ou sobreposição geométrica objetiva com outras declarações do CAR. Estas áreas geram DÚVIDA e são PASSÍVEIS DE DISCUSSÃO técnica — recomendada conferência visual pelo responsável técnico usando as figuras do anexo.",
                }),
            ],
        }),
    ];

    const blocks: Array<Paragraph | any> = [...intro];
    for (const p of doubtPolygons) {
        blocks.push(
            new Paragraph({
                spacing: { before: 100, after: 40 },
                children: [
                    new TextRun({ text: `${p.polygonId} — ${Number(p.areaHa || 0).toFixed(4)} ha`, bold: true, size: 19 }),
                ],
            }),
        );
        const signals = p.doubtSignals?.length ? p.doubtSignals : ["Sinal sutil registrado sem detalhamento adicional."];
        for (const s of signals.slice(0, 6)) {
            blocks.push(
                new Paragraph({
                    spacing: { after: 30 },
                    indent: { left: 360 },
                    children: [new TextRun({ text: `• ${s}`, size: 17 })],
                }),
            );
        }
    }
    return blocks;
}

/**
 * Anexo fotográfico: para cada polígono (priorizando os em dúvida, quando a fase
 * os tem), uma linha por ano com a cena persistida. Estados observados entram na
 * legenda. `heading` define o título/subtítulo da fase; sem ele cai no da Fase 1.
 */
export async function auasScenesGalleryBlocks(
    scenes: AuasScenePublic[],
    polygons: AuasPolygonDoubt[],
    heading?: { title: string; subtitle: string },
): Promise<Array<Paragraph | any>> {
    const usable = scenes.filter((s) => s.publicImageUrl);
    if (usable.length === 0) return [];

    const byYearState = new Map<string, { state?: string; fraction?: number }>();
    for (const p of polygons) {
        for (const [yearStr, frac] of Object.entries(p.anthropizedFractionByYear || {})) {
            byYearState.set(`${p.polygonId}:${yearStr}`, { fraction: frac });
        }
    }

    const header: Paragraph[] = [
        new Paragraph({
            spacing: { before: 160, after: 80 },
            children: [
                new Paragraph({
                    spacing: { after: 0 },
                    children: [],
                }),
                new TextRun({
                    text: heading?.title
                        || "Anexo Fotográfico — Cenas por Polígono AUAS (série 2003–2008, zoom individual)",
                    bold: true,
                    size: 22,
                }),
            ],
        }),
        new Paragraph({
            spacing: { after: 120 },
            children: [
                new TextRun({
                    size: 17,
                    text: heading?.subtitle
                        || "Cenas WMS SEMA-MT (Landsat 5 falsa-cor 2003–2007 · SPOT cor natural 2008) recortadas por polígono com margem reduzida. Overlay vermelho = perímetro do polígono declarado. A diferença de paleta entre sensores não é mudança na cobertura do solo.",
                }),
            ],
        }),
    ];

    // Agrupa por polígono, ordenando os em dúvida primeiro.
    const order = new Map(polygons.map((p, i) => [p.polygonId, i]));
    const grouped = new Map<string, AuasScenePublic[]>();
    for (const s of usable) {
        const list = grouped.get(s.polygonId) || [];
        list.push(s);
        grouped.set(s.polygonId, list);
    }
    const sortedIds = [...grouped.keys()].sort(
        (a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b),
    );

    let figura = 0;
    const blocks: Array<Paragraph | any> = [...header];

    for (const polygonId of sortedIds) {
        const scenesForPoly = (grouped.get(polygonId) || []).sort((a, b) => a.year - b.year);
        blocks.push(
            new Paragraph({
                spacing: { before: 140, after: 60 },
                children: [
                    new TextRun({
                        text: `Polígono ${polygonId}`,
                        bold: true,
                        size: 20,
                    }),
                ],
            }),
        );

        for (const scene of scenesForPoly) {
            try {
                const buffer = await fetchImageBufferLocal(scene.publicImageUrl!);
                let largura = LARGURA_MAX;
                let altura = Math.round(LARGURA_MAX * 0.66);
                try {
                    const meta = await sharp(buffer).metadata();
                    if (meta.width && meta.height) {
                        altura = Math.round(largura / (meta.width / meta.height));
                        if (altura > ALTURA_MAX) {
                            altura = ALTURA_MAX;
                            largura = Math.round(ALTURA_MAX * (meta.width / meta.height));
                        }
                    }
                } catch {
                    // metadata indisponível: mantém tamanho padrão
                }
                const figuraImg = await comprimirFigura(buffer, largura);
                figura += 1;
                const info = byYearState.get(`${scene.polygonId}:${scene.year}`);
                const fracTxt = typeof info?.fraction === "number" ? ` · ~${Math.round(info.fraction * 100)}% c/ sinal de uso` : "";
                blocks.push(
                    new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { before: 120, after: 40 },
                        children: [new ImageRun({ type: figuraImg.tipo, data: figuraImg.data, transformation: { width: largura, height: altura } })],
                    }),
                    new Paragraph({
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 140 },
                        children: [
                            new TextRun({
                                text: `Figura ${figura} — ${scene.polygonId}, ano ${scene.year} (${scene.sensor})${scene.bridge ? " · janela-ponte" : ""}${fracTxt}`,
                                italics: true,
                                size: 16,
                            }),
                        ],
                    }),
                );
            } catch (err) {
                figura -= 1; // falha de download não consome número
                console.warn("[AUAS DOCX] cena não baixada (não-fatal):", scene.sceneId, err instanceof Error ? err.message : err);
            }
        }
    }

    return blocks;
}
