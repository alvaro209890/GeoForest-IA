/**
 * Monta `config/acervo-landsat.json` a partir do GetCapabilities do GeoServer
 * da casa.
 *
 *   npx tsx scripts/levantar-acervo-landsat.ts [--saida=config/acervo-landsat.json]
 *
 * Precisa rodar **no servidor** (o GeoServer só escuta em 127.0.0.1:8081) ou
 * com `ACERVO_WMS_BASE_URL` apontando para um endereço alcançável.
 *
 * O que sai daqui é **proposta**, não veredito. Cada entrada nasce
 * `automatico`; virar `confirmado` é ato humano, depois de olhar a cena. Para
 * um laudo que vai à SEMA, qual das versões co-datadas está bem
 * georreferenciada não é decisão de heurística — o deslocamento de 30–300 m que
 * importa não aparece no bbox (a variação natural de enquadramento entre datas
 * da mesma órbita é de 1 a 10 km e o engole).
 *
 * O que o script decide sozinho, porque é objetivo:
 *
 * - **Descarta cena arquivada na órbita errada.** Centro do bbox a mais de
 *   `--max-desvio-km` da mediana da órbita. Dois casos reais no acervo:
 *   `landsat_5_20041229_002_069_l2` (1.852 km, bbox no Peru) e
 *   `l5_225_068_20111008` (164 km, arquivada em 224/068 sendo 225/068).
 * - **Rebaixa Landsat 7 pós-31/05/2003**, quando o SLC falhou e a cena passou a
 *   ter faixas de vazio.
 * - **Rebaixa composição em cor natural**, para a série ficar coerente com a
 *   falsa-cor da SEMA quando os dois anos se misturam na mesma análise.
 * - **Rebaixa resíduo de reprocessamento** (`_2`, `_geo1`, `_geo2`, `_v2`).
 * - **Prefere a data mais próxima de 22/07**, que é o marco do art. 3º, IV e
 *   também o miolo da seca — menos nuvem.
 */
import fs from "node:fs";
import path from "node:path";

import { parseLandsatLayerName } from "../backend/landsat/naming";
import { ACERVO_WMS_BASE, type AcervoCatalog, type AcervoSceneEntry, type AcervoSpotEntry, type Bbox } from "../backend/simcar/acervo-local";

const args = process.argv.slice(2);
function flag(name: string, fallback: string): string {
    const hit = args.find((item) => item.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
}

const SAIDA = path.resolve(flag("saida", path.join("config", "acervo-landsat.json")));
const MAX_DESVIO_KM = Number(flag("max-desvio-km", "50"));
const WORKSPACE = process.env.GEOSERVER_WORKSPACE || "cbers";

/** Metros por grau de latitude; longitude é corrigida pelo cosseno na conta. */
const M_POR_GRAU = 111_320;

type RawLayer = { name: string; bbox: Bbox };

/**
 * Extrai `<Name>` + `<EX_GeographicBoundingBox>` do GetCapabilities sem
 * dependência de parser XML (o repositório não tem nenhum).
 *
 * A regra que torna isso seguro: só vale o bbox que aparece **antes do próximo
 * `<Name>`**. No GeoServer a ordem dentro de `<Layer>` é Name → … →
 * EX_GeographicBoundingBox → … → Style/Name, então o nome de estilo (que também
 * é um `<Name>`) nunca rouba o bbox da camada.
 */
function parseCapabilities(xml: string): RawLayer[] {
    const out: RawLayer[] = [];
    const nameRe = /<Name>([^<]+)<\/Name>/g;
    const posicoes: Array<{ name: string; end: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = nameRe.exec(xml)) !== null) {
        posicoes.push({ name: m[1].trim(), end: nameRe.lastIndex });
    }
    for (let i = 0; i < posicoes.length; i += 1) {
        const inicio = posicoes[i].end;
        const fim = i + 1 < posicoes.length ? posicoes[i + 1].end : xml.length;
        const trecho = xml.slice(inicio, fim);
        const bloco = trecho.match(/<EX_GeographicBoundingBox>([\s\S]*?)<\/EX_GeographicBoundingBox>/);
        if (!bloco) continue;
        const num = (tag: string): number => Number(bloco[1].match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1]);
        const bbox: Bbox = [
            num("westBoundLongitude"),
            num("southBoundLatitude"),
            num("eastBoundLongitude"),
            num("northBoundLatitude"),
        ];
        if (bbox.some((v) => !Number.isFinite(v))) continue;
        if (!(bbox[2] > bbox[0]) || !(bbox[3] > bbox[1])) continue;
        out.push({ name: posicoes[i].name, bbox });
    }
    return out;
}

function centro(bbox: Bbox): [number, number] {
    return [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];
}

function mediana(valores: number[]): number {
    const ord = [...valores].sort((a, b) => a - b);
    const meio = Math.floor(ord.length / 2);
    return ord.length % 2 ? ord[meio] : (ord[meio - 1] + ord[meio]) / 2;
}

function distanciaKm(a: [number, number], b: [number, number]): number {
    const latMedia = ((a[1] + b[1]) / 2) * (Math.PI / 180);
    const dx = (a[0] - b[0]) * M_POR_GRAU * Math.cos(latMedia);
    const dy = (a[1] - b[1]) * M_POR_GRAU;
    return Math.sqrt(dx * dx + dy * dy) / 1000;
}

/** Dias entre a passagem e o 22/07 daquele ano. */
function distanciaDoMarcoDias(iso: string | undefined, ano: number): number | null {
    if (!iso) return null;
    const data = new Date(`${iso}T00:00:00Z`).getTime();
    const marco = new Date(`${ano}-07-22T00:00:00Z`).getTime();
    if (!Number.isFinite(data)) return null;
    return Math.abs(data - marco) / 86_400_000;
}

type Candidato = AcervoSceneEntry & { score: number };

function pontuar(cena: Omit<AcervoSceneEntry, "status" | "rank" | "motivo">): { score: number; motivos: string[] } {
    const motivos: string[] = [];
    let score = 0;

    if (cena.platform === "landsat-7" && cena.date && cena.date >= "2003-05-31") {
        score += 100;
        motivos.push("Landsat 7 pós-falha do SLC (faixas de vazio)");
    }
    if (cena.composicao === "natural_color") {
        score += 50;
        motivos.push("cor natural; a série da SEMA é falsa-cor");
    }
    // Resíduo de reprocessamento: `_geo1`, `_geo2`, `_c654_v2`, `_c543_2`.
    // O padrão tem que ser preciso — um `_\d$` solto rebaixaria `band5_4_3`,
    // que é nome de composição e não sobra de reprocessamento.
    if (/_geo\d$|_v\d$|_(?:c|comp)\d{3}_\d$/.test(cena.layer)) {
        score += 20;
        motivos.push("resíduo de reprocessamento");
    }
    const dias = distanciaDoMarcoDias(cena.date, cena.year);
    if (dias === null) {
        score += 30;
        motivos.push("sem data no nome da camada");
    } else {
        score += dias / 10;
        motivos.push(`${Math.round(dias)} dia(s) do 22/07`);
    }
    return { score, motivos };
}

function municipioDoSpot(nome: string): string {
    const curto = nome.replace(/^.*:/, "");
    const m = curto.match(/^spot_sema_([a-z_]+?)(?:_mosaico|_mosaic|_mi|_\d.*)?$/);
    return m ? m[1] : curto.replace(/^spot_sema_/, "");
}

async function main(): Promise<void> {
    const url = `${ACERVO_WMS_BASE}?service=WMS&version=1.3.0&request=GetCapabilities`;
    console.log(`[ACERVO] GetCapabilities: ${url}`);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`GetCapabilities falhou: HTTP ${resp.status}`);
    const xml = await resp.text();
    console.log(`[ACERVO] ${(xml.length / 1024 / 1024).toFixed(1)} MB de capabilities`);

    const camadas = parseCapabilities(xml);
    console.log(`[ACERVO] ${camadas.length} camadas com bbox`);

    /* ── Landsat ────────────────────────────────────────────── */
    const brutas = camadas
        .filter((l) => l.name.startsWith(`${WORKSPACE}:landsat_`))
        .map((l) => {
            const parsed = parseLandsatLayerName(l.name.replace(/^.*:/, ""));
            if (!parsed) return null;
            const iso = parsed.date && /^\d{8}$/.test(parsed.date)
                ? `${parsed.date.slice(0, 4)}-${parsed.date.slice(4, 6)}-${parsed.date.slice(6, 8)}`
                : undefined;
            return {
                layer: l.name,
                path: parsed.path,
                row: parsed.row,
                year: Number(parsed.year),
                date: iso,
                platform: parsed.platform,
                composicao: parsed.composition === "natural_color" ? ("natural_color" as const) : ("false_color" as const),
                bbox: l.bbox,
            };
        })
        .filter((x): x is NonNullable<typeof x> => Boolean(x));

    // Mediana por órbita/ponto: o gabarito contra o qual a cena arquivada errada aparece.
    const porOrbita = new Map<string, typeof brutas>();
    for (const cena of brutas) {
        const chave = `${cena.path}/${cena.row}`;
        if (!porOrbita.has(chave)) porOrbita.set(chave, []);
        porOrbita.get(chave)!.push(cena);
    }
    const medianas = new Map<string, [number, number]>();
    for (const [chave, lista] of porOrbita) {
        const centros = lista.map((c) => centro(c.bbox));
        medianas.set(chave, [mediana(centros.map((c) => c[0])), mediana(centros.map((c) => c[1]))]);
    }

    // Largura mediana da órbita: separa "arquivada na órbita errada" de
    // "recorte parcial da cena". As duas afastam o centro do bbox da mediana,
    // mas só a primeira é erro de catálogo — a segunda é uma cena legítima,
    // menor, que `bboxContains` já descarta sozinha quando não cobre o imóvel.
    const larguras = new Map<string, number>();
    for (const [chave, lista] of porOrbita) {
        larguras.set(chave, mediana(lista.map((c) => distanciaKm([c.bbox[0], c.bbox[1]], [c.bbox[2], c.bbox[1]]))));
    }

    const porAno = new Map<string, Candidato[]>();
    let descartadas = 0;
    let parciais = 0;
    for (const cena of brutas) {
        const chaveOrbita = `${cena.path}/${cena.row}`;
        const desvio = distanciaKm(centro(cena.bbox), medianas.get(chaveOrbita)!);
        const larguraKm = distanciaKm([cena.bbox[0], cena.bbox[1]], [cena.bbox[2], cena.bbox[1]]);
        const larguraMediana = larguras.get(chaveOrbita)!;
        const { score, motivos } = pontuar(cena);

        const parcial = larguraKm < 0.6 * larguraMediana;
        const foraDaOrbita = !parcial && desvio > MAX_DESVIO_KM;
        if (foraDaOrbita) descartadas += 1;
        if (parcial) parciais += 1;

        let motivo = motivos.join("; ");
        let scoreFinal = score;
        if (foraDaOrbita) {
            motivo = `arquivada na órbita errada (${Math.round(desvio)} km da mediana de ${chaveOrbita})`;
        } else if (parcial) {
            scoreFinal += 200;
            motivo = `recorte parcial da cena (${Math.round(larguraKm)} km de largura contra ${Math.round(larguraMediana)} km da órbita); ${motivo}`;
        }

        const entrada: Candidato = {
            ...cena,
            status: foraDaOrbita ? "descartado" : "automatico",
            rank: 0,
            motivo,
            score: scoreFinal,
        };
        const chave = `${cena.path}/${cena.row}/${cena.year}`;
        if (!porAno.has(chave)) porAno.set(chave, []);
        porAno.get(chave)!.push(entrada);
    }

    // Duas cenas da MESMA data com bbox diferente: os footprints deveriam ser
    // idênticos, então uma delas está deslocada. O bbox denuncia o conflito mas
    // não diz qual presta — marca para revisão humana.
    let emConflito = 0;
    for (const lista of porAno.values()) {
        const porData = new Map<string, Candidato[]>();
        for (const item of lista) {
            if (!item.date || item.status === "descartado") continue;
            if (!porData.has(item.date)) porData.set(item.date, []);
            porData.get(item.date)!.push(item);
        }
        for (const mesmaData of porData.values()) {
            if (mesmaData.length < 2) continue;
            let maxDist = 0;
            for (let i = 0; i < mesmaData.length; i += 1) {
                for (let j = i + 1; j < mesmaData.length; j += 1) {
                    maxDist = Math.max(maxDist, distanciaKm(centro(mesmaData[i].bbox), centro(mesmaData[j].bbox)));
                }
            }
            if (maxDist * 1000 <= 200) continue;
            emConflito += mesmaData.length;
            for (const item of mesmaData) {
                item.revisar = true;
                item.motivo = `${mesmaData.length} versões da mesma data com bbox até ${Math.round(maxDist * 1000)} m de diferença — uma está deslocada; ${item.motivo}`;
            }
        }
    }

    const landsat: AcervoSceneEntry[] = [];
    for (const lista of porAno.values()) {
        lista.sort((a, b) => a.score - b.score);
        lista.forEach((item, idx) => {
            const { score: _score, ...resto } = item;
            landsat.push({ ...resto, rank: item.status === "descartado" ? 99 : idx });
        });
    }
    landsat.sort((a, b) => a.path.localeCompare(b.path) || a.row.localeCompare(b.row) || a.year - b.year || a.rank - b.rank);

    /* ── SPOT 2008 ──────────────────────────────────────────── */
    const spotBrutas = camadas.filter((l) => /^.*:spot_sema_/.test(l.name) && l.name.startsWith(`${WORKSPACE}:`));
    const vistos = new Set<string>();
    const spot: AcervoSpotEntry[] = [];
    for (const l of spotBrutas) {
        const curto = l.name.replace(/^.*:/, "");
        const ehMosaico = /_(?:mosaico|mosaic|mi)$/.test(curto);
        const municipio = municipioDoSpot(l.name);
        // `_mosaico`, `_mosaic` e `_mi` são três nomes do mesmo raster: fica um.
        const chave = ehMosaico ? `mosaico:${municipio}` : `tile:${curto}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        spot.push({
            layer: l.name,
            municipio,
            tipo: ehMosaico ? "mosaico" : "tile",
            bbox: l.bbox,
            status: "automatico",
            rank: 0,
        });
    }
    // Área crescente: mosaico mais justo primeiro. Cobertura real quem decide é o
    // render — `spot_sema_canarana_mosaico` tem bbox sobre imóveis que não cobre.
    const area = (b: Bbox) => (b[2] - b[0]) * (b[3] - b[1]);
    spot.sort((a, b) => (a.tipo === b.tipo ? area(a.bbox) - area(b.bbox) : a.tipo === "mosaico" ? -1 : 1));
    spot.forEach((item, idx) => { item.rank = idx; });

    const catalogo: AcervoCatalog = {
        geradoEm: new Date().toISOString(),
        fonte: ACERVO_WMS_BASE,
        workspace: WORKSPACE,
        landsat,
        spot,
    };

    fs.mkdirSync(path.dirname(SAIDA), { recursive: true });
    fs.writeFileSync(SAIDA, `${JSON.stringify(catalogo, null, 2)}\n`, "utf8");

    const orbitas = new Set(landsat.map((c) => `${c.path}/${c.row}`));
    const primarias = landsat.filter((c) => c.rank === 0 && c.status !== "descartado");
    console.log(`[ACERVO] ${landsat.length} cenas (${descartadas} descartadas, ${parciais} recortes parciais), ${orbitas.size} órbitas, ${primarias.length} escolhas primárias`);
    console.log(`[ACERVO] ${emConflito} cena(s) marcadas para revisão (mesma data, bbox divergente)`);
    console.log(`[ACERVO] ${spot.length} entradas SPOT (${spot.filter((s) => s.tipo === "mosaico").length} mosaicos municipais)`);
    console.log(`[ACERVO] gravado em ${SAIDA}`);

    console.log("\nJanela AC/AVN (2003-2008), escolha primária por órbita:");
    for (const orbita of [...orbitas].sort()) {
        const linha: string[] = [];
        for (let ano = 2003; ano <= 2008; ano += 1) {
            const escolha = landsat.find(
                (c) => `${c.path}/${c.row}` === orbita && c.year === ano && c.rank === 0 && c.status !== "descartado",
            );
            linha.push(`${ano}:${escolha ? (escolha.date || "s/data") : "—"}`);
        }
        console.log(`  ${orbita}  ${linha.join("  ")}`);
    }
}

main().catch((error) => {
    console.error("[ACERVO] falhou:", error);
    process.exit(1);
});
