/**
 * Acervo Landsat/SPOT da IMAP no GeoServer local.
 *
 * O GeoServer da casa (Jetty 8081, mesmo host do backend) publica cenas Landsat
 * **nativas, com data de passagem conhecida**, e os mosaicos SPOT 2008 por
 * município. Quando existe cena nossa para o ano e ela cobre o imóvel, ela vale
 * mais que o mosaico estadual da SEMA por dois motivos:
 *
 * 1. **É mais nítida.** O mosaico estadual é reamostrado; a cena nativa mostra
 *    o limite do talhão.
 * 2. **Tem data.** O laudo pode citar "cena Landsat 5 TM, órbita/ponto 224/069,
 *    de 20/07/2008" no lugar de "mosaico LANDSAT_5_2008", de data indefinida.
 *    Dois dias antes do marco do art. 3º, IV é outro patamar de prova.
 *
 * ⚠️ **Três armadilhas medidas no acervo real (21/08/2026) — todas viram
 * decisão de código aqui:**
 *
 * - **O path/row do nome da camada mente.** `landsat_5_20041229_002_069_l2` está
 *   arquivada em 224/069 e tem bbox no Peru (1.852 km fora); a de 2011 está na
 *   pasta 224/068 sendo 225/068 (164 km). Só o **bbox** casa imóvel com cena;
 *   o nome nunca.
 * - **Deslocamento não se detecta por bbox.** A variação natural de
 *   enquadramento entre datas da mesma órbita é de 1 a 10 km e engole os
 *   30–300 m de erro de georreferenciamento que importam. O bbox pega o erro
 *   grosseiro e nada mais — por isso a escolha final é **lista curada**
 *   (`config/acervo-landsat.json`), não heurística em tempo de requisição.
 * - **Bbox conter o imóvel não é cobrir o imóvel.** `spot_sema_canarana_mosaico`
 *   tem bbox sobre o imóvel e renderiza 100% preto; o tile
 *   `spot_sema_querencia_19311ne` volta 60% branco. Daí `isMostlyEmptyRender`
 *   ser gate obrigatório, e não otimização.
 *
 * Regenerar o catálogo: `npx tsx scripts/levantar-acervo-landsat.ts`.
 * Análise completa: `docs/ACERVO_LANDSAT_LOCAL.md`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { SEMA_WMS_AUTHKEY, SEMA_WMS_BASE } from "./constants";

export type Bbox = [number, number, number, number];

/** Endpoint WMS de onde uma cena vem. O laudo declara isso figura a figura. */
export type WmsSource = {
    id: "acervo" | "sema";
    /** Texto curto que vai para a legenda da figura e para o laudo. */
    label: string;
    base: string;
    authkey?: string;
};

export type AcervoStatus = "confirmado" | "automatico" | "descartado";

export type AcervoSceneEntry = {
    layer: string;
    path: string;
    row: string;
    year: number;
    /** ISO `yyyy-mm-dd` da passagem, quando o nome da camada a carrega. */
    date?: string;
    platform?: string;
    composicao?: "false_color" | "natural_color";
    bbox: Bbox;
    status: AcervoStatus;
    /** 0 = escolha primária do (órbita, ponto, ano); 1+ = reservas na ordem. */
    rank: number;
    motivo?: string;
    /**
     * Há outra cena da MESMA data com bbox diferente — ou seja, uma das duas
     * está deslocada. É o caso que o bbox denuncia mas não resolve: qual das
     * duas está certa só se sabe olhando. Enquanto `status` for `automatico`,
     * o pipeline serve mesmo assim e registra aviso no log.
     */
    revisar?: boolean;
};

export type AcervoSpotEntry = {
    layer: string;
    municipio: string;
    tipo: "mosaico" | "tile";
    bbox: Bbox;
    status: AcervoStatus;
    rank: number;
};

export type AcervoCatalog = {
    geradoEm: string;
    fonte: string;
    workspace: string;
    landsat: AcervoSceneEntry[];
    spot: AcervoSpotEntry[];
};

/**
 * Base WMS do acervo. Mesma constante que o pipeline Landsat usa para publicar
 * (`backend/landsat/constants.ts`), para não haver dois endereços do mesmo
 * GeoServer no repositório.
 */
export const ACERVO_WMS_BASE = String(
    process.env.ACERVO_WMS_BASE_URL
    || (process.env.GEOSERVER_BASE_URL ? `${process.env.GEOSERVER_BASE_URL}/wms` : "")
    || "http://127.0.0.1:8081/geoserver/wms",
).replace(/\/+$/, "");

export const ACERVO_SOURCE: WmsSource = {
    id: "acervo",
    label: "acervo IMAP",
    base: ACERVO_WMS_BASE,
};

export const SEMA_SOURCE: WmsSource = {
    id: "sema",
    label: "mosaico SEMA-MT",
    base: SEMA_WMS_BASE,
    authkey: SEMA_WMS_AUTHKEY,
};

/**
 * Chave de desligamento. O acervo local é o caminho preferencial, mas se o
 * GeoServer estiver fora ou o catálogo suspeito, `false` devolve o pipeline
 * inteiro para a SEMA sem tocar em código.
 */
export function isAcervoEnabled(): boolean {
    const raw = String(process.env.SIMCAR_ACERVO_LOCAL_ENABLED ?? "").trim().toLowerCase();
    if (raw === "false" || raw === "0" || raw === "off") return false;
    return true;
}

/**
 * `descartado` nunca é servida.
 * `revisar: true` também não — é o grupo co-datado com bbox divergente, e
 * GetMap mostrou que a heurística de rank já escolheu a deslocada (2009
 * 224/069, 2006 L2). Só entra em laudo cena `confirmado` ou `automatico`
 * sem marca de revisão.
 */
function isUsable(scene: { status: AcervoStatus; revisar?: boolean }): boolean {
    if (scene.status === "descartado") return false;
    if (scene.revisar && scene.status !== "confirmado") return false;
    return true;
}

let catalogCache: AcervoCatalog | null | undefined;

function catalogPath(): string | null {
    // Caminho apontado à mão manda sozinho: cair no catálogo do repositório
    // porque o arquivo configurado não existe faria o pipeline servir cenas que
    // ninguém pediu, sem dizer nada.
    const configured = String(process.env.ACERVO_LANDSAT_JSON || "").trim();
    if (configured) {
        const resolvido = path.resolve(configured);
        if (fs.existsSync(resolvido)) return resolvido;
        console.warn(`[ACERVO] ACERVO_LANDSAT_JSON aponta para arquivo inexistente (${resolvido}); usando apenas a SEMA.`);
        return null;
    }

    const moduleDir = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
        path.resolve(process.cwd(), "config", "acervo-landsat.json"),
        path.resolve(moduleDir, "../../config/acervo-landsat.json"),
        path.resolve(moduleDir, "../config/acervo-landsat.json"),
    ];
    return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

export function loadAcervoCatalog(): AcervoCatalog | null {
    if (catalogCache !== undefined) return catalogCache;
    const found = catalogPath();
    if (!found) {
        console.warn("[ACERVO] config/acervo-landsat.json não encontrado; usando apenas a SEMA.");
        catalogCache = null;
        return catalogCache;
    }
    try {
        const parsed = JSON.parse(fs.readFileSync(found, "utf8")) as AcervoCatalog;
        const landsat = Array.isArray(parsed?.landsat) ? parsed.landsat : [];
        const spot = Array.isArray(parsed?.spot) ? parsed.spot : [];
        catalogCache = { ...parsed, landsat, spot };
        console.log(`[ACERVO] catálogo carregado: ${landsat.length} cenas Landsat, ${spot.length} entradas SPOT (${found}).`);
    } catch (error) {
        console.warn("[ACERVO] Falha ao ler acervo-landsat.json:", (error as Error)?.message);
        catalogCache = null;
    }
    return catalogCache;
}

/** Só para teste: descarta o cache entre casos. */
export function resetAcervoCatalogCache(): void {
    catalogCache = undefined;
}

/**
 * `outer` contém `inner` inteiro?
 *
 * Exigimos **contenção total**, não interseção: cena que cobre metade do imóvel
 * renderiza a outra metade como nodata, e uma figura pela metade num laudo é
 * pior que a cena estadual inteira.
 */
export function bboxContains(outer: Bbox, inner: Bbox): boolean {
    return outer[0] <= inner[0] && outer[1] <= inner[1] && outer[2] >= inner[2] && outer[3] >= inner[3];
}

/** Cenas do acervo que cobrem o imóvel naquele ano, na ordem de preferência. */
export function resolveAcervoLandsat(year: number, bbox: Bbox): AcervoSceneEntry[] {
    if (!isAcervoEnabled()) return [];
    const catalog = loadAcervoCatalog();
    if (!catalog) return [];
    return catalog.landsat
        .filter((scene) => scene.year === year && isUsable(scene) && bboxContains(scene.bbox, bbox))
        .sort((a, b) => a.rank - b.rank);
}

/**
 * Mosaicos SPOT 2008 que cobrem o imóvel, na ordem de preferência.
 *
 * Mosaico municipal antes de tile: o tile é recortado na folha da carta e quase
 * sempre corta o imóvel ao meio (medido: 60% em branco em Querência).
 */
export function resolveAcervoSpot(bbox: Bbox): AcervoSpotEntry[] {
    if (!isAcervoEnabled()) return [];
    const catalog = loadAcervoCatalog();
    if (!catalog) return [];
    return catalog.spot
        .filter((entry) => isUsable(entry) && bboxContains(entry.bbox, bbox))
        .sort((a, b) => {
            if (a.tipo !== b.tipo) return a.tipo === "mosaico" ? -1 : 1;
            return a.rank - b.rank;
        });
}

/** Uma tentativa de GetMap: camada + de onde ela vem + o que citar no laudo. */
export type WmsCandidate = {
    layer: string;
    source: WmsSource;
    scene?: SceneProvenance;
};

/** O que a legenda da figura e o laudo citam sobre a origem daquela cena. */
export type SceneProvenance = {
    date?: string;
    path?: string;
    row?: string;
    platform?: string;
    /** Só para SPOT: o mosaico é por município, não por órbita/ponto. */
    municipio?: string;
    revisar?: boolean;
};

/**
 * A família de sensor que a chave do catálogo promete.
 *
 * Serve para não rotular como "Landsat 5 (2003)" uma cena que o acervo tem em
 * Landsat 7: a legenda do laudo é declaração técnica, não enfeite. Cena sem
 * plataforma reconhecida passa — o nome da camada nem sempre a carrega.
 */
export function matchesSensorFamily(satelliteKey: string, platform?: string): boolean {
    if (!platform) return true;
    const key = String(satelliteKey || "").toLowerCase();
    const familia = key.match(/^landsat(\d)/)?.[1];
    if (!familia) return false;
    return platform === `landsat-${familia}`;
}

/**
 * Candidatas do acervo para uma chave de satélite, na ordem de preferência.
 * Lista vazia significa "não temos" — quem chama emenda as candidatas da SEMA
 * na sequência.
 */
export function acervoCandidates(satelliteKey: string, year: number, bbox: Bbox): WmsCandidate[] {
    const key = String(satelliteKey || "").toLowerCase();

    if (key.startsWith("spot")) {
        return resolveAcervoSpot(bbox).map((entry) => ({
            layer: entry.layer,
            source: ACERVO_SOURCE,
            scene: { municipio: entry.municipio },
        }));
    }

    // Sentinel-2 e ResourceSat não existem no acervo; trocar por Landsat mudaria
    // o sensor sem mudar o rótulo.
    if (!/^landsat\d/.test(key)) return [];

    return resolveAcervoLandsat(year, bbox)
        .filter((scene) => matchesSensorFamily(key, scene.platform))
        .map((scene) => ({
            layer: scene.layer,
            source: ACERVO_SOURCE,
            scene: {
                date: scene.date,
                path: scene.path,
                row: scene.row,
                platform: scene.platform,
                revisar: scene.revisar,
            },
        }));
}

/** Fração de pixels acima da qual a cena é considerada sem cobertura útil. */
const EMPTY_RENDER_MAX_RATIO = Math.min(
    0.5,
    Math.max(0, Number(process.env.ACERVO_EMPTY_RENDER_MAX_RATIO || 0.1)),
);

/**
 * O GeoServer devolve nodata como branco puro (255) ou preto puro (0). Imagem
 * real de satélite quase não tem pixel exatamente saturado nos três canais —
 * medido no acervo: cena boa fica em 0,0%, tile cortado em 60%, mosaico sem
 * cobertura em 100%. A separação é limpa o bastante para decidir sozinha.
 */
export async function measureEmptyRenderRatio(png: Buffer): Promise<number> {
    const { data, info } = await sharp(png)
        .removeAlpha()
        .resize(120, 90, { fit: "fill" })
        .raw()
        .toBuffer({ resolveWithObject: true });
    const channels = info.channels;
    const total = info.width * info.height;
    if (total === 0) return 1;
    let empty = 0;
    for (let i = 0; i < data.length; i += channels) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const branco = r >= 252 && g >= 252 && b >= 252;
        const preto = r <= 3 && g <= 3 && b <= 3;
        if (branco || preto) empty += 1;
    }
    return empty / total;
}

export async function isMostlyEmptyRender(png: Buffer): Promise<{ empty: boolean; ratio: number }> {
    try {
        const ratio = await measureEmptyRenderRatio(png);
        return { empty: ratio > EMPTY_RENDER_MAX_RATIO, ratio };
    } catch {
        // Se nem dá para medir, deixa passar: o gate seguinte é o olho humano.
        return { empty: false, ratio: 0 };
    }
}

/** `20/07/2008` a partir do ISO; vazio quando o nome da camada não trouxe data. */
export function formatSceneDate(iso?: string): string {
    const match = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return "";
    return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Sufixo de proveniência da figura: `cena 20/07/2008, órbita/ponto 224/069,
 * acervo IMAP`. Vai na legenda do anexo e no corpo do laudo.
 *
 * ⚠️ É **sufixo**, nunca prefixo. `selectPrincipalReportImages` e
 * `reduceImageSet` ordenam lendo o começo da legenda (SPOT, ano); mexer na
 * frente da string quebra a seleção do anexo em silêncio — já aconteceu uma vez
 * (ver `docs/CHANGELOG_2026-08-21_ANEXO_SPOT_SUMIA.md`).
 */
export function describeSceneProvenance(source: WmsSource, scene?: SceneProvenance | null): string {
    const partes: string[] = [];
    const data = formatSceneDate(scene?.date);
    if (data) partes.push(`cena ${data}`);
    if (scene?.path && scene?.row) partes.push(`órbita/ponto ${scene.path}/${scene.row}`);
    if (scene?.municipio) partes.push(`mosaico de ${tituloMunicipio(scene.municipio)}`);
    partes.push(source.label);
    return partes.join(", ");
}

/**
 * `querencia` → `Querencia`. Sem acento de propósito: o nome vem do slug da
 * camada, que não guarda acento, e reconstruí-lo por adivinhação erraria em
 * "São Félix do Araguaia".
 */
function tituloMunicipio(slug: string): string {
    return String(slug || "")
        .split("_")
        .filter(Boolean)
        .map((parte) => parte.charAt(0).toUpperCase() + parte.slice(1))
        .join(" ");
}
