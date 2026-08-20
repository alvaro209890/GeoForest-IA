/**
 * Tema e estrutura do laudo PDF do SIMCAR — parte PURA (sem pdfkit, sem rede).
 *
 * O `report.ts` só desenha; toda a decisão de "o que aparece, com que cor e em
 * que ordem" mora aqui, para poder ser testada sem gerar PDF. Regra de ouro:
 * nada aqui inventa veredito — só traduz o que as fases já calcularam para
 * rótulo, cor e ordem de leitura.
 */

/* ─── Paleta ─────────────────────────────────────────────────── */

export const PALETTE = {
    primary: "#059669",     // Emerald 600 — identidade GeoForest
    primaryLight: "#D1FAE5",
    primaryBg: "#ECFDF5",
    dark: "#0F172A",        // Slate 900
    darkText: "#1E293B",
    text: "#334155",
    lightText: "#64748B",
    border: "#E2E8F0",
    bg: "#F8FAFC",
    white: "#FFFFFF",
} as const;

/** Semáforo do laudo. `danger` nunca significa infração — significa "revisar". */
export type Tone = "ok" | "warn" | "danger" | "info" | "neutral";

export type ToneColors = {
    /** Cor do texto/ícone. */
    fg: string;
    /** Fundo do box/pílula. */
    bg: string;
    /** Borda do box/pílula. */
    border: string;
};

export const TONES: Record<Tone, ToneColors> = {
    ok: { fg: "#15803D", bg: "#DCFCE7", border: "#86EFAC" },
    warn: { fg: "#B45309", bg: "#FEF3C7", border: "#FCD34D" },
    danger: { fg: "#B91C1C", bg: "#FEE2E2", border: "#FCA5A5" },
    info: { fg: "#1D4ED8", bg: "#DBEAFE", border: "#93C5FD" },
    neutral: { fg: "#475569", bg: "#F1F5F9", border: "#CBD5E1" },
};

/** Ordem de gravidade — usada para escolher o tom do painel de veredito. */
const TONE_SEVERITY: Record<Tone, number> = { ok: 0, info: 1, neutral: 2, warn: 3, danger: 4 };

export function worstTone(tones: Tone[]): Tone {
    return tones.reduce<Tone>((acc, tone) => (TONE_SEVERITY[tone] > TONE_SEVERITY[acc] ? tone : acc), "ok");
}

/* ─── Marcos legais ──────────────────────────────────────────── */

/**
 * Marco do Código Florestal (Lei 12.651/2012, art. 3º, IV e art. 61-A):
 * ocupação antrópica **preexistente a 22/07/2008** caracteriza área rural
 * consolidada.
 */
export const MARCO_CODIGO_FLORESTAL_YEAR = 2008;

/**
 * Marco do pousio quinquenal: a IN SEMA-MT 04/2023, art. 42 §6º (na redação
 * dada pelo Decreto estadual 288/2023, que alterou o Decreto 1.031/2017)
 * reconhece como consolidada a área com atividade agrossilvipastoril
 * implantada até **22/07/2003** que esteja em pousio no marco de 2008.
 * É por isso que a série de imagens do laudo começa em 2003.
 */
export const MARCO_POUSIO_YEAR = 2003;

export const LEGAL_BASIS_LINES: string[] = [
    "Lei federal 12.651/2012 (Código Florestal), art. 3º, IV — área rural consolidada é a de ocupação antrópica preexistente a 22/07/2008, com edificações, benfeitorias ou atividades agrossilvipastoris.",
    "Lei federal 12.651/2012, art. 3º, XXIV e art. 61-A — pousio de até 5 anos não descaracteriza o uso consolidado; APP consolidada segue as faixas do art. 61-A.",
    "Lei federal 12.651/2012, art. 26 — supressão de vegetação nativa para uso alternativo do solo depende de autorização prévia do órgão estadual (AUAS/AUTEX).",
    "IN SEMA-MT 04/2023, art. 42 e §6º (c/c Decreto estadual 288/2023 e Decreto 1.031/2017) — área implantada até 22/07/2003 e em pousio no marco de 2008 é considerada consolidada; art. 44 admite imagem de satélite como meio de prova.",
    "Nota Técnica 001/2017/CGMA/SRMA/SEMA-MT (revisada em 2018) — metodologia oficial de interpretação de imagem para delimitar área consolidada, com base SPOT 2008 (2,5 m).",
];

/* ─── Identificação da etapa ─────────────────────────────────── */

export type ReportKind =
    | "AC_AVN"
    | "AUAS_V1"
    | "AUAS_PRE2008"
    | "AUAS_POS2008"
    | "AC_VEG"
    | "GENERICO";

/** Descobre de qual etapa é o `auasMeta` recebido (as 4 fases compartilham o campo). */
export function detectReportKind(auasMeta: any): ReportKind {
    if (!auasMeta || typeof auasMeta !== "object") return "GENERICO";
    if (auasMeta.phase === "AC_VEG" || String(auasMeta.rulesVersion || "").startsWith("ac-vegetacao")) return "AC_VEG";
    if (auasMeta.phase === "POS_2008" || String(auasMeta.rulesVersion || "").startsWith("auas-pos2008")) return "AUAS_POS2008";
    if (auasMeta.schemaVersion === 2 || String(auasMeta.rulesVersion || "").startsWith("auas-pre2008")) return "AUAS_PRE2008";
    if (auasMeta.finalStatus !== undefined || auasMeta.passivoAmbiental !== undefined) return "AUAS_V1";
    return "GENERICO";
}

export function reportKindSectionTitle(kind: ReportKind): string {
    switch (kind) {
        case "AUAS_PRE2008":
            return "Fase 1 — AUAS anterior ao marco de 2008 (série 2003–2008)";
        case "AUAS_POS2008":
            return "Fase 2 — Datação da conversão por polígono AUAS";
        case "AC_VEG":
            return "Fase 3 — Vegetação remanescente dentro da Área Consolidada";
        case "AUAS_V1":
            return "Análise de Área de Uso Alternativo do Solo (AUAS)";
        default:
            return "Análise temporal complementar";
    }
}

/* ─── Achados (linhas do quadro com semáforo) ────────────────── */

export type Finding = {
    label: string;
    /** Texto curto da pílula colorida. */
    status: string;
    tone: Tone;
    /** Frase de uma linha explicando o achado. */
    detail: string;
};

function verdictTone(value: unknown): Tone {
    const raw = String(value || "").toUpperCase();
    if (raw === "SIM") return "danger";
    if (raw === "NAO") return "ok";
    return "warn";
}

function verdictStatus(value: unknown): string {
    const raw = String(value || "").toUpperCase();
    if (raw === "SIM") return "Revisar";
    if (raw === "NAO") return "Conforme";
    return "Inconclusivo";
}

export function confidenceTone(value: unknown): Tone {
    const raw = String(value || "").toUpperCase();
    if (raw === "ALTA") return "ok";
    if (raw === "MEDIA") return "warn";
    if (raw === "BAIXA") return "danger";
    return "neutral";
}

export function confidenceLabel(value: unknown): string {
    const raw = String(value || "").toUpperCase();
    if (raw === "ALTA") return "Alta";
    if (raw === "MEDIA") return "Média";
    if (raw === "BAIXA") return "Baixa";
    return "Inconclusiva";
}

/** Achados da análise AC/AVN (etapa que roda hoje em produção). */
export function buildAcAvnFindings(analysisMeta: any): Finding[] {
    const verdict = analysisMeta?.globalVerdict;
    if (!verdict) return [];
    const findings: Finding[] = [
        {
            label: "Uso consolidado fora do polígono AC",
            status: verdictStatus(verdict.acForaShape),
            tone: verdictTone(verdict.acForaShape),
            detail:
                verdict.acForaShape === "SIM"
                    ? "Imagem mostra uso antrópico fora da AC declarada — revisar o limite da AC."
                    : verdict.acForaShape === "NAO"
                        ? "Nenhum uso antrópico relevante fora da AC declarada nas cenas avaliadas."
                        : "As cenas não permitem confirmar nem descartar uso fora da AC — pendência de revisão.",
        },
        {
            label: "Antropização dentro do polígono AVN",
            status: verdictStatus(verdict.avnDentroShapeAntropizado),
            tone: verdictTone(verdict.avnDentroShapeAntropizado),
            detail:
                verdict.avnDentroShapeAntropizado === "SIM"
                    ? "Há trecho antropizado dentro da AVN declarada — revisar o setor apontado."
                    : verdict.avnDentroShapeAntropizado === "NAO"
                        ? "Nenhuma antropização consistente dentro da AVN declarada."
                        : "Integridade da AVN inconclusiva — validar com imagem complementar.",
        },
    ];
    if (verdict.avnParcialForaShapeMasEmAuas) {
        findings.push({
            label: "Relação AVN × AUAS",
            status: verdictStatus(verdict.avnParcialForaShapeMasEmAuas),
            tone: verdictTone(verdict.avnParcialForaShapeMasEmAuas),
            detail:
                verdict.avnParcialForaShapeMasEmAuas === "SIM"
                    ? "Possível vegetação fora da AVN porém dentro da AUAS — exige validação temporal."
                    : verdict.avnParcialForaShapeMasEmAuas === "NAO"
                        ? "Sem conflito visual entre AVN e AUAS neste recorte."
                        : "Relação AVN × AUAS inconclusiva — usar a análise AUAS temporal.",
        });
    }
    const notes: string[] = Array.isArray(analysisMeta?.coherence?.notes) ? analysisMeta.coherence.notes : [];
    findings.push({
        label: "Coerência entre cenas",
        status: analysisMeta?.coherence?.isCoherent === false ? "Divergente" : "Coerente",
        tone: analysisMeta?.coherence?.isCoherent === false ? "warn" : "ok",
        detail:
            analysisMeta?.coherence?.isCoherent === false
                ? `Cenas divergiram entre si; decisão final foi conservadora. ${notes.slice(0, 1).join(" ")}`.trim()
                : "Vereditos por imagem coerentes com o veredito global.",
    });
    const clouds: any[] = Array.isArray(analysisMeta?.cloudWarnings) ? analysisMeta.cloudWarnings : [];
    if (clouds.length > 0) {
        findings.push({
            label: "Nuvem / oclusão nas cenas",
            status: `${clouds.length} cena(s)`,
            tone: "warn",
            detail: `Cenas com suspeita de nuvem: ${clouds.map((c) => String(c?.satellite || "")).filter(Boolean).join(", ")}.`,
        });
    }
    return findings;
}

const PRE2008_STATUS_LABEL: Record<string, string> = {
    ALERTA_PRE_2008: "Alerta pré-2008",
    SEM_EVIDENCIA_PRE_2008: "Sem evidência pré-2008",
    INCONCLUSIVO: "Inconclusivo",
};

const POS2008_STATUS_LABEL: Record<string, string> = {
    CONFIRMADO_ANO: "Ano confirmado",
    CONFIRMADO_INTERVALO: "Intervalo confirmado",
    JA_ANTROPIZADO_NO_INICIO_DA_SERIE: "Já antropizado no início da série",
    SEM_MUDANCA_OBSERVADA: "Sem mudança observada",
    INCONCLUSIVO: "Inconclusivo",
};

/** Achados da etapa AUAS — cobre as 4 formas de `auasMeta` que chegam ao PDF. */
export function buildAuasFindings(auasMeta: any, kind = detectReportKind(auasMeta)): Finding[] {
    if (kind === "AUAS_PRE2008") {
        const summary = auasMeta?.summary || {};
        const alert = auasMeta?.pre2008Alert === true;
        const findings: Finding[] = [
            {
                label: "Antropização anterior a 22/07/2008",
                status: PRE2008_STATUS_LABEL[String(auasMeta?.status || "")] || "Não informado",
                tone: alert ? "danger" : auasMeta?.status === "SEM_EVIDENCIA_PRE_2008" ? "ok" : "warn",
                detail: alert
                    ? "Há polígono AUAS com sinal de uso antrópico antes do marco — a declaração como AUAS deve ser reavaliada."
                    : "Nenhum polígono AUAS apresentou sinal consistente de antropização antes do marco de 2008.",
            },
            {
                label: "Polígonos AUAS analisados",
                status: String(Number(summary.polygonCount || 0)),
                tone: "info",
                detail: `${Number(summary.alertCount || 0)} com alerta · ${Number(summary.inconclusiveCount || 0)} inconclusivo(s) · ${Number(summary.totalAuasAreaHa || 0).toFixed(2)} ha no total.`,
            },
        ];
        if (Number(summary.inconclusiveCount || 0) > 0) {
            findings.push({
                label: "Polígonos inconclusivos",
                status: String(Number(summary.inconclusiveCount || 0)),
                tone: "warn",
                detail: "Nesses polígonos não é possível descartar conversão anterior ao marco — revisar manualmente.",
            });
        }
        return findings;
    }

    if (kind === "AUAS_POS2008") {
        const summary = auasMeta?.summary || {};
        const confirmed = Number(summary.confirmedYearCount || 0);
        const interval = Number(summary.intervalCount || 0);
        const inconclusive = Number(summary.inconclusiveCount || 0);
        return [
            {
                label: "Conversões datadas na série",
                status: `${confirmed + interval} de ${Number(summary.polygonCount || 0)}`,
                tone: confirmed + interval > 0 ? "warn" : "neutral",
                detail: `${confirmed} com ano confirmado e ${interval} com intervalo observado.`,
            },
            {
                label: "Já antropizados no início da série",
                status: String(Number(summary.alreadyAnthropizedCount || 0)),
                tone: Number(summary.alreadyAnthropizedCount || 0) > 0 ? "info" : "ok",
                detail: "Coerente com evento anterior ao primeiro ano observável — confirmar na Fase 1.",
            },
            {
                label: "Sem mudança observada",
                status: String(Number(summary.noChangeCount || 0)),
                tone: "info",
                detail: "Para eventos recentes, a datação oficial vem dos alertas (aba AUAS × SCCON), não da imagem.",
            },
            {
                label: "Polígonos inconclusivos",
                status: String(inconclusive),
                tone: inconclusive > 0 ? "warn" : "ok",
                detail:
                    inconclusive > 0
                        ? "Sem cena utilizável suficiente — impossível descartar conversão nesses polígonos."
                        : "Todos os polígonos tiveram cena utilizável suficiente para decisão.",
            },
        ];
    }

    if (kind === "AC_VEG") {
        const summary = auasMeta?.summary || {};
        const apparent = Number(summary.apparentVegetationCount || 0);
        return [
            {
                label: "AC com vegetação aparente na imagem",
                status: String(apparent),
                tone: apparent > 0 ? "danger" : "ok",
                detail:
                    apparent > 0
                        ? "Há Área Consolidada com feição de vegetação nativa na cena atual — revisar o polígono declarado."
                        : "Nenhuma AC apresentou feição de vegetação nativa relevante na cena atual.",
            },
            {
                label: "AC com vegetação declarada (AVN)",
                status: String(Number(summary.declaredVegetationCount || 0)),
                tone: Number(summary.declaredVegetationCount || 0) > 0 ? "warn" : "ok",
                detail: `${Number(summary.declaredVegetationAreaHa || 0).toFixed(2)} ha de AVN declarada dentro de polígonos de AC.`,
            },
            {
                label: "Área Consolidada analisada",
                status: `${Number(summary.totalAcAreaHa || 0).toFixed(2)} ha`,
                tone: "info",
                detail: `${Number(summary.polygonCount || 0)} polígono(s) de AC · ${Number(summary.cleanCount || 0)} sem pendência · ${Number(summary.inconclusiveCount || 0)} inconclusivo(s).`,
            },
        ];
    }

    if (kind === "AUAS_V1") {
        const passivo = auasMeta?.passivoAmbiental;
        return [
            {
                label: "Síntese da AUAS",
                status: String(auasMeta?.finalStatus || "Não informado").replace(/_/g, " ").toLowerCase(),
                tone: auasMeta?.finalStatus === "AUAS_VALIDA" ? "ok" : auasMeta?.finalStatus === "AUAS_INVALIDA" ? "danger" : "warn",
                detail: "Resultado consolidado da rotina AUAS na versão anterior do analisador.",
            },
            {
                label: "Indício de passivo ambiental",
                status: passivo === true ? "Sim" : passivo === false ? "Não" : "Não informado",
                tone: passivo === true ? "danger" : passivo === false ? "ok" : "neutral",
                detail:
                    passivo === true
                        ? "A rotina apontou indício de passivo — confirmar com o responsável técnico antes de qualquer peça oficial."
                        : "Sem indício de passivo registrado nesta rodada.",
            },
        ];
    }

    return [];
}

/* ─── Painel de veredito ─────────────────────────────────────── */

export type VerdictPanel = {
    tone: Tone;
    /** Rótulo curto do estado geral (aparece grande). */
    title: string;
    /** Frase única explicando o estado. */
    headline: string;
    confidence: string;
    confidenceTone: Tone;
};

export function buildVerdictPanel(args: {
    findings: Finding[];
    kind: ReportKind;
    analysisMeta?: any;
    auasMeta?: any;
}): VerdictPanel {
    const actionable = args.findings.filter((f) => f.tone === "danger");
    const pending = args.findings.filter((f) => f.tone === "warn");
    const tone = worstTone(args.findings.map((f) => f.tone));
    const rawConfidence =
        args.analysisMeta?.globalVerdict?.confidence ?? args.auasMeta?.confidence ?? null;

    let title = "Sem ajuste indicado";
    let headline = "Nenhum achado exige ajuste vetorial com base nas cenas avaliadas.";
    if (actionable.length > 0) {
        title = "Requer revisão";
        headline = `${actionable.length} achado(s) exigem revisão antes de submeter ao SIMCAR: ${actionable
            .map((f) => f.label)
            .slice(0, 3)
            .join("; ")}.`;
    } else if (pending.length > 0) {
        title = "Parcialmente inconclusivo";
        headline = `${pending.length} achado(s) ficaram pendentes de confirmação: ${pending
            .map((f) => f.label)
            .slice(0, 3)
            .join("; ")}.`;
    } else if (args.findings.length === 0) {
        title = "Sem análise de IA";
        headline = "Este laudo traz apenas os quantitativos do recorte — nenhuma etapa de análise por imagem foi executada.";
    }

    return {
        tone: args.findings.length === 0 ? "neutral" : tone,
        title,
        headline,
        confidence: confidenceLabel(rawConfidence),
        confidenceTone: rawConfidence ? confidenceTone(rawConfidence) : "neutral",
    };
}

/* ─── Resumo executivo em bullets ────────────────────────────── */

export type ExecutiveBullet = { text: string; tone: Tone };

export function buildExecutiveBullets(args: {
    jobId: string;
    totalLayers: number;
    layersWithData: number;
    totalFeatures: number;
    propertyAreaHa: number;
    findings: Finding[];
    timeline?: TimelineModel | null;
}): ExecutiveBullet[] {
    const bullets: ExecutiveBullet[] = [
        {
            text: `Imóvel de ${args.propertyAreaHa.toFixed(2)} ha; ${args.layersWithData} de ${args.totalLayers} camada(s) ambiental(is) com sobreposição e ${args.totalFeatures} feição(ões) recortada(s).`,
            tone: "info",
        },
    ];
    if (args.timeline && args.timeline.years.length > 0) {
        const usable = args.timeline.years.filter((y) => y.state !== "missing").length;
        bullets.push({
            text: `Janela temporal analisada: ${args.timeline.firstYear}–${args.timeline.lastYear} (${usable} ano(s) com cena utilizável), com o marco de 22/07/2008 no meio da série.`,
            tone: "info",
        });
    }
    for (const finding of args.findings.slice(0, 5)) {
        bullets.push({ text: `${finding.label}: ${finding.status.toLowerCase()} — ${finding.detail}`, tone: finding.tone });
    }
    bullets.push({
        text: "Documento de apoio gerado automaticamente: a decisão final e a assinatura são do responsável técnico.",
        tone: "neutral",
    });
    return bullets;
}

/* ─── Linha do tempo ─────────────────────────────────────────── */

export type TimelineYearState = "used" | "missing" | "event";

export type TimelineYear = {
    year: number;
    state: TimelineYearState;
    /** Rótulo curto do sensor/cena (ex.: "SPOT", "L5"). */
    label?: string;
};

export type TimelineModel = {
    years: TimelineYear[];
    firstYear: number;
    lastYear: number;
    /** Ano do marco do Código Florestal, quando cai dentro da série. */
    markerYear: number | null;
    /** Anos em que alguma conversão foi datada. */
    eventYears: number[];
    caption: string;
};

function shortSensorLabel(raw: string): string {
    const value = String(raw || "").toUpperCase();
    if (value.includes("SPOT")) return "SPOT";
    if (value.includes("SENTINEL")) return "S2";
    if (value.includes("LANDSAT_8") || value.includes("LANDSAT 8") || value.includes("LANDSAT8")) return "L8";
    if (value.includes("LANDSAT_7") || value.includes("LANDSAT 7") || value.includes("LANDSAT7")) return "L7";
    if (value.includes("LANDSAT")) return "L5";
    if (value.includes("RESOURCESAT")) return "RS";
    if (value.includes("CBERS")) return "CB";
    return "";
}

function pushYear(map: Map<number, TimelineYear>, year: number, state: TimelineYearState, label?: string): void {
    if (!Number.isInteger(year) || year < 1970 || year > 2100) return;
    const current = map.get(year);
    if (!current) {
        map.set(year, { year, state, label });
        return;
    }
    // "event" manda sobre "used", que manda sobre "missing".
    if (state === "event" || (state === "used" && current.state === "missing")) {
        map.set(year, { year, state, label: label || current.label });
    } else if (label && !current.label) {
        map.set(year, { ...current, label });
    }
}

/**
 * Monta a série de anos que o laudo realmente olhou, a partir de qualquer das
 * metas de fase. Devolve `null` quando não houve análise temporal alguma —
 * nesse caso o PDF simplesmente não desenha a linha do tempo.
 */
export function buildTimelineModel(args: { analysisMeta?: any; auasMeta?: any }): TimelineModel | null {
    const map = new Map<number, TimelineYear>();
    const eventYears = new Set<number>();
    const captions: string[] = [];

    const satellites: any[] = Array.isArray(args.analysisMeta?.satelliteVerdicts)
        ? args.analysisMeta.satelliteVerdicts
        : [];
    for (const sat of satellites) {
        const year = Number(sat?.year || 0);
        pushYear(map, year, sat?.status === "missing" ? "missing" : "used", shortSensorLabel(sat?.label || sat?.key));
    }
    if (satellites.length > 0) captions.push("cenas AC/AVN");

    const auasMeta = args.auasMeta;
    const scenes: any[] = Array.isArray(auasMeta?.scenes) ? auasMeta.scenes : [];
    for (const scene of scenes) {
        const year = Number(scene?.year || 0);
        const usable = scene?.usability === "USABLE" || scene?.usability === "LOW_RESOLUTION";
        pushYear(map, year, usable ? "used" : "missing", shortSensorLabel(scene?.sensor || scene?.layer));
    }
    if (scenes.length > 0) captions.push("cenas da análise pós-recorte");

    const catalogYears: any[] = Array.isArray(auasMeta?.catalog?.years) ? auasMeta.catalog.years : [];
    const missingYears: number[] = Array.isArray(auasMeta?.catalog?.missingYears) ? auasMeta.catalog.missingYears : [];
    for (const year of catalogYears) {
        pushYear(map, Number(year), missingYears.includes(Number(year)) ? "missing" : "used",
            shortSensorLabel(auasMeta?.catalog?.layerByYear?.[Number(year)] || ""));
    }
    for (const year of missingYears) pushYear(map, Number(year), "missing");

    const histogram = auasMeta?.summary?.yearHistogram;
    if (histogram && typeof histogram === "object") {
        for (const [rawYear, value] of Object.entries(histogram)) {
            const year = Number(rawYear);
            if (Number((value as any)?.count || 0) > 0) {
                eventYears.add(year);
                pushYear(map, year, "event", shortSensorLabel(auasMeta?.catalog?.layerByYear?.[year] || ""));
            }
        }
    }
    const polygons: any[] = Array.isArray(auasMeta?.polygons) ? auasMeta.polygons : [];
    for (const polygon of polygons) {
        const detected = Number(polygon?.firstDetectedYear || 0);
        if (detected > 0) {
            eventYears.add(detected);
            pushYear(map, detected, "event");
        }
    }

    if (map.size === 0) return null;

    const years = [...map.values()].sort((a, b) => a.year - b.year);
    const firstYear = years[0].year;
    const lastYear = years[years.length - 1].year;
    const markerYear =
        MARCO_CODIGO_FLORESTAL_YEAR >= firstYear && MARCO_CODIGO_FLORESTAL_YEAR <= lastYear
            ? MARCO_CODIGO_FLORESTAL_YEAR
            : null;

    return {
        years,
        firstYear,
        lastYear,
        markerYear,
        eventYears: [...eventYears].sort((a, b) => a - b),
        caption: captions.length > 0 ? `Série montada a partir de ${captions.join(" e ")}.` : "Série de imagens analisada.",
    };
}

/* ─── Markdown → blocos desenháveis ──────────────────────────── */

export type MarkdownBlock =
    | { type: "heading"; text: string }
    | { type: "bullet"; label: string | null; text: string }
    | { type: "paragraph"; text: string };

const MAX_MARKDOWN_BLOCKS = 120;

/**
 * Converte o markdown do laudo de IA em blocos estruturados, preservando
 * títulos e bullets — que a limpeza antiga jogava fora, transformando tudo em
 * parágrafo corrido. `- **Rótulo:** texto` vira bullet com rótulo destacado.
 */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = [];
    const lines = String(markdown || "").replace(/\r/g, "").split("\n");
    let paragraph: string[] = [];

    const flushParagraph = () => {
        const text = paragraph.join(" ").replace(/\s+/g, " ").trim();
        paragraph = [];
        if (text) blocks.push({ type: "paragraph", text: stripInlineMarkdown(text) });
    };

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.trim()) {
            flushParagraph();
            continue;
        }
        const heading = line.match(/^\s{0,3}#{1,6}\s+(.*)$/);
        if (heading) {
            flushParagraph();
            const text = stripInlineMarkdown(heading[1]).trim();
            if (text) blocks.push({ type: "heading", text });
            continue;
        }
        const bullet = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
        if (bullet) {
            flushParagraph();
            const content = bullet[1].trim();
            const labelled = content.match(/^\*\*(.+?)\*\*\s*[:—-]?\s*(.*)$/);
            if (labelled && labelled[2].trim()) {
                blocks.push({
                    type: "bullet",
                    label: stripInlineMarkdown(labelled[1]).replace(/:$/, "").trim(),
                    text: stripInlineMarkdown(labelled[2]).trim(),
                });
            } else {
                blocks.push({ type: "bullet", label: null, text: stripInlineMarkdown(content) });
            }
            continue;
        }
        paragraph.push(line.trim());
    }
    flushParagraph();
    return blocks.slice(0, MAX_MARKDOWN_BLOCKS);
}

function stripInlineMarkdown(value: string): string {
    return String(value || "")
        .replace(/\*\*(.+?)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^\s*[-*]\s+/, "")
        .trim();
}

/** Parágrafo longo demais vira leitura pesada — o PDF quebra em frases. */
export function splitLongParagraph(text: string, maxChars = 420): string[] {
    const clean = String(text || "").trim();
    if (clean.length <= maxChars) return clean ? [clean] : [];
    const sentences = clean.split(/(?<=[.;!?])\s+/);
    const parts: string[] = [];
    let current = "";
    for (const sentence of sentences) {
        if (!current) {
            current = sentence;
        } else if ((current + " " + sentence).length <= maxChars) {
            current = `${current} ${sentence}`;
        } else {
            parts.push(current);
            current = sentence;
        }
    }
    if (current) parts.push(current);
    return parts;
}

/* ─── Classificação de camadas do recorte ────────────────────── */

/** Camadas que carregam restrição legal — recebem destaque na tabela. */
const RESTRICTION_LAYERS = new Set([
    "ARL", "ARLREM", "AUAS", "AURD", "AVN",
    "AREA_USO_RESTRITO", "AREA_ALTITUDE_1800", "AREA_DECLIVIDADE",
    "AREA_TOPO_MORRO", "BORDA_CHAPADA", "AREA_UMIDA",
    "NASCENTE", "MANGUEZAL", "RESTINGA", "VEREDA",
    "RIO_ATE_10", "RIO_10_A_50", "RIO_50_A_200", "RIO_200_A_600", "RIO_ACIMA_600",
    "RESERVATORIO_ARTIFICIAL", "LAGOA_NATURAL",
]);

export type LayerNature = "Restrição" | "Uso" | "Base";

export function classifyLayerNature(name: string): { nature: LayerNature; tone: Tone } {
    const clean = String(name || "").trim().toUpperCase();
    if (clean === "AIR" || clean === "ATP") return { nature: "Base", tone: "neutral" };
    if (clean === "AREA_CONSOLIDADA" || clean === "INTERESSE_SOCIAL" || clean === "UTILIDADE_PUBLICA") {
        return { nature: "Uso", tone: "info" };
    }
    if (RESTRICTION_LAYERS.has(clean)) return { nature: "Restrição", tone: "warn" };
    return { nature: "Base", tone: "neutral" };
}
