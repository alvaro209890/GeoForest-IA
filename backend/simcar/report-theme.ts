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
    // O laudo sai no papel timbrado da IMAP (report-imap.ts), então o verde de
    // acento é o do Ofício (#008A07) — não o Emerald 600 da marca GeoForest.
    primary: "#008A07",
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
 * Marco do pousio quinquenal.
 *
 * O pousio do art. 3º, XXIV da Lei 12.651/2012 é a interrupção da atividade por
 * **no máximo 5 anos** — dentro desse prazo o uso segue consolidado, mesmo que
 * a cena de 2008 mostre capoeira. Passando de 5 anos, a interrupção
 * **descaracteriza** o uso consolidado e a vegetação regenerada volta a ser
 * classificada como AVN.
 *
 * 2003 é o ano em que essa conta fecha contra o marco de 2008. Por isso a série
 * do laudo começa nele e precisa ser contígua: quem decide é o **ano da última
 * atividade visível**, e um ano faltando pode mover a contagem de um lado ao
 * outro do limite. Se nenhum ano de 2003 a 2008 mostra atividade, a última é
 * anterior a 2003 — mais de 5 anos — e o trecho é AVN, não AC em descanso.
 *
 * Reconhecimento estadual: IN SEMA-MT 04/2023, art. 42 §6º (redação do Decreto
 * estadual 288/2023, que alterou o Decreto 1.031/2017).
 */
export const MARCO_POUSIO_YEAR = 2003;

/** Teto legal do pousio, em anos (Lei 12.651/2012, art. 3º, XXIV). */
export const POUSIO_MAX_YEARS = 5;

/**
 * Glossário AC × AUAS — a confusão que mais estraga a redação do laudo.
 *
 * As duas camadas são **a mesma coisa** (solo sem vegetação nativa) separadas
 * só pelo marco de 22/07/2008. Chamar AC de "área antropizada" é tecnicamente
 * defensável (a lei fala em "ocupação antrópica"), mas no vocabulário do SIMCAR
 * "antropizado" puxa para AUAS — isto é, para supressão que exigia autorização.
 * Em laudo que vai para a SEMA, essa ambiguidade lê como acusação.
 *
 * Regra de escrita: **AC → "uso consolidado"; AUAS → "supressão pós-2008".**
 */
export const AC_VS_AUAS_GLOSSARY: string[] = [
    "AC (Área Consolidada) — ocupação anterior a 22/07/2008. É uso regular por força do art. 3º, IV da Lei 12.651/2012; no laudo, escreva \"uso consolidado\".",
    "AUAS (Área de Uso Alternativo do Solo) — supressão de vegetação nativa a partir de 22/07/2008. Depende de autorização prévia (art. 26); no laudo, escreva \"supressão pós-2008\".",
    "AVN (Área de Vegetação Nativa) — remanescente nunca convertido, ou área cuja atividade foi interrompida por mais de 5 anos antes do marco (ver pousio abaixo).",
    `Pousio (art. 3º, XXIV) — interrupção da atividade por no máximo ${POUSIO_MAX_YEARS} anos não descaracteriza a AC: a área segue consolidada mesmo coberta por capoeira em 2008. Acima desse prazo, a interrupção descaracteriza e a vegetação regenerada volta a ser AVN.`,
    `Quem decide é o ano da última atividade visível na série ${MARCO_POUSIO_YEAR}–${MARCO_CODIGO_FLORESTAL_YEAR}: se nenhum ano do período mostra atividade, a última é anterior a ${MARCO_POUSIO_YEAR} e o trecho é AVN — traço antigo de talhão, sozinho, não sustenta AC.`,
];

export const LEGAL_BASIS_LINES: string[] = [
    "Lei federal 12.651/2012 (Código Florestal), art. 3º, IV — área rural consolidada é a de ocupação antrópica preexistente a 22/07/2008, com edificações, benfeitorias ou atividades agrossilvipastoris.",
    "Lei federal 12.651/2012, art. 3º, XXIV — pousio é a interrupção da atividade por no máximo 5 anos: dentro do prazo o uso segue consolidado; acima dele a interrupção descaracteriza a consolidação e a vegetação regenerada volta a ser vegetação nativa (AVN).",
    "Lei federal 12.651/2012, art. 61-A — APP consolidada segue as faixas de recomposição por módulo fiscal.",
    "Lei federal 12.651/2012, art. 26 — supressão de vegetação nativa para uso alternativo do solo depende de autorização prévia do órgão estadual (AUAS/AUTEX).",
    "IN SEMA-MT 04/2023, art. 42 e §6º (c/c Decreto estadual 288/2023 e Decreto 1.031/2017) — reconhece o pousio no marco de 2008; art. 44 admite imagem de satélite como meio de prova da consolidação.",
    "Nota Técnica 001/2017/CGMA/SRMA/SEMA-MT (revisada em 2018) — metodologia oficial de interpretação de imagem para delimitar área consolidada, com base SPOT 2008 (2,5 m).",
];

/* ─── Origem dos vetores ─────────────────────────────────────── */

/**
 * De onde vieram as geometrias do laudo.
 *
 * Isto muda o que os números significam e precisa estar escrito na peça:
 * - `auto-clip` — recorte feito contra o WFS da SEMA. Os polígonos de AC, AVN e
 *   AUAS são os que **estão publicados** na base estadual.
 * - `vectorized-analysis` — ZIP do modelo já vetorizado, enviado pelo usuário.
 *   Os polígonos são os que **o responsável técnico desenhou** e ainda não
 *   necessariamente foram submetidos. Um "AC fora do shape" aqui aponta erro na
 *   vetorização em revisão, não divergência contra o cadastro vigente.
 */
export type VectorSource = "auto-clip" | "vectorized-analysis";

export function normalizeVectorSource(value: unknown): VectorSource {
    return String(value || "").trim() === "vectorized-analysis" ? "vectorized-analysis" : "auto-clip";
}

export function vectorSourceNote(value: unknown): { label: string; detail: string } {
    if (normalizeVectorSource(value) === "vectorized-analysis") {
        return {
            label: "Origem dos vetores: ZIP vetorizado enviado pelo responsável técnico",
            detail:
                "As camadas analisadas vieram do ZIP do modelo SIMCAR enviado, não da base estadual — não houve recorte WFS. Os quantitativos refletem a vetorização em revisão; divergências apontadas são de desenho, não do cadastro publicado na SEMA.",
        };
    }
    return {
        label: "Origem dos vetores: recorte automático contra a base da SEMA-MT",
        detail:
            "As camadas ambientais foram recortadas do WFS estadual para o perímetro do imóvel; os quantitativos refletem o que está publicado na base.",
    };
}

/* ─── Origem das imagens ─────────────────────────────────────── */

/** Marca que `describeSceneProvenance` grava na legenda de cada figura. */
const ACERVO_CAPTION_MARK = "acervo IMAP";
const SEMA_CAPTION_MARK = "mosaico SEMA-MT";

/**
 * De onde vieram as imagens do laudo, lido das próprias legendas.
 *
 * Desde 21/08/2026 a série pode misturar cena nativa do acervo da IMAP (quando
 * existe para aquele ano e órbita) com o mosaico estadual da SEMA (quando não
 * existe). Isso **precisa** estar escrito na peça por dois motivos:
 *
 * 1. A cena do acervo tem data de passagem; o mosaico estadual não. Um laudo
 *    que cita "cena de 20/07/2008" e outro que cita "mosaico 2008" não têm o
 *    mesmo peso probatório, e o leitor tem direito de saber qual está lendo.
 * 2. Fontes diferentes têm realce e nitidez diferentes. Quem confere o laudo
 *    precisa saber que a mudança de aparência no ano da troca é de
 *    processamento, não do chão — é a mesma ressalva que vai no prompt da IA
 *    (`MIXED_SOURCE_PROMPT_NOTE`).
 *
 * Laudo antigo, gerado antes da proveniência existir, não tem nenhuma das duas
 * marcas: devolve `null` e nenhum quadro é impresso.
 */
export function imageSourceNote(captions: readonly string[]): { label: string; detail: string } | null {
    const textos = (captions || []).map((item) => String(item || ""));
    const temAcervo = textos.some((texto) => texto.includes(ACERVO_CAPTION_MARK));
    const temSema = textos.some((texto) => texto.includes(SEMA_CAPTION_MARK));

    if (temAcervo && temSema) {
        return {
            label: "Origem das imagens: séries mistas (acervo IMAP + mosaico SEMA-MT)",
            detail:
                "Parte das cenas é do acervo próprio da IMAP, com data de passagem declarada na legenda de cada figura; "
                + "os anos sem cena própria foram cobertos pelo mosaico estadual da SEMA-MT, que não tem data exata e é reamostrado. "
                + "As duas fontes têm realce e nitidez distintos: diferença de brilho ou definição entre figuras de fontes "
                + "diferentes é artefato de processamento, não evidência de alteração no uso do solo.",
        };
    }
    if (temAcervo) {
        return {
            label: "Origem das imagens: acervo próprio da IMAP",
            detail:
                "As cenas são imagens nativas do acervo da IMAP, com data de passagem e órbita/ponto declarados na legenda "
                + "de cada figura — e não mosaicos anuais de data indefinida.",
        };
    }
    if (temSema) {
        return {
            label: "Origem das imagens: mosaicos estaduais da SEMA-MT",
            detail:
                "As cenas são os mosaicos anuais publicados pela SEMA-MT. O mosaico agrega passagens de datas distintas "
                + "dentro do ano, de modo que a data exata de cada trecho da cena não é determinável.",
        };
    }
    return null;
}

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

/**
 * Cabeçalho do anexo fotográfico de cada fase. As três anexam a MESMA imagem que
 * a visão analisou (overlay vermelho do polígono já desenhado); o que muda é a
 * série e a leitura de cor, e é isso que o subtítulo tem de avisar — senão o RT
 * lê falsa-cor como se fosse foto aérea.
 */
export function reportPhotoAnnexHeading(kind: ReportKind): { title: string; subtitle: string } | null {
    switch (kind) {
        case "AUAS_PRE2008":
            return {
                title: "Anexo Fotográfico — Cenas por Polígono AUAS (série 2003–2008)",
                subtitle:
                    "Landsat 5 falsa-cor 2003–2007 · SPOT cor natural 2008. Overlay vermelho = perímetro declarado; a diferença de paleta entre sensores não é mudança de cobertura.",
            };
        case "AUAS_POS2008":
            return {
                title: "Anexo Fotográfico — Cenas por Polígono AUAS (série 2009–2019)",
                subtitle:
                    "Série anual das fontes WMS registradas na análise, em falsa-cor (vegetação densa em verde forte/neon). Overlay vermelho = perímetro declarado; a troca de sensor ao longo da série não é mudança de cobertura.",
            };
        case "AC_VEG":
            return {
                title: "Anexo Fotográfico — Cenas por Polígono de Área Consolidada",
                subtitle:
                    "Cenas disponíveis nas fontes WMS registradas na análise; fontes ausentes são declaradas como limitações. Overlay vermelho = perímetro da AC declarada; a interpretação das cores depende do sensor e da composição informados.",
            };
        default:
            return null;
    }
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

/**
 * Achados da análise AC/AVN (etapa que roda hoje em produção).
 *
 * Vocabulário: a janela desta etapa é 2003–2008, **toda anterior ao marco**.
 * Logo, uso do solo visto nessas cenas é **uso consolidado** — não "uso
 * antrópico" genérico, que no SIMCAR remete à AUAS (supressão posterior a
 * 22/07/2008). Ver {@link AC_VS_AUAS_GLOSSARY}.
 */
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
                    ? "Imagem mostra uso consolidado fora da AC declarada — revisar o limite da AC."
                    : verdict.acForaShape === "NAO"
                        ? "Nenhum uso consolidado relevante fora da AC declarada nas cenas avaliadas."
                        : "As cenas não permitem confirmar nem descartar uso fora da AC — pendência de revisão.",
        },
        {
            label: "Uso consolidado dentro do polígono AVN",
            status: verdictStatus(verdict.avnDentroShapeAntropizado),
            tone: verdictTone(verdict.avnDentroShapeAntropizado),
            detail:
                verdict.avnDentroShapeAntropizado === "SIM"
                    ? "Há trecho com uso consolidado dentro da AVN declarada — revisar o setor apontado."
                    : verdict.avnDentroShapeAntropizado === "NAO"
                        ? "Nenhum uso consolidado consistente dentro da AVN declarada."
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
    SINAL_DE_DUVIDA: "Sinal de dúvida",
    SEM_EVIDENCIA_PRE_2008: "Sem evidência pré-2008",
    INCONCLUSIVO: "Inconclusivo",
};

const POS2008_STATUS_LABEL: Record<string, string> = {
    CONFIRMADO_ANO: "Ano confirmado",
    CONFIRMADO_INTERVALO: "Intervalo confirmado",
    // O código é `JA_ANTROPIZADO...`, mas o rótulo diz "em uso": na Fase 2 a
    // série começa em 2009 e "já antropizado no início" significa que a
    // conversão é anterior — ou seja, provável AC, não supressão pós-marco.
    JA_ANTROPIZADO_NO_INICIO_DA_SERIE: "Já em uso no início da série",
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
                label: "Uso do solo anterior a 22/07/2008 em polígono AUAS",
                status: PRE2008_STATUS_LABEL[String(auasMeta?.status || "")] || "Não informado",
                tone: alert ? "danger" : auasMeta?.status === "SEM_EVIDENCIA_PRE_2008" ? "ok" : "warn",
                detail: alert
                    ? "Há polígono declarado como AUAS com uso já implantado antes do marco — se confirmado, a área é consolidada (AC), não supressão pós-2008."
                    : auasMeta?.status === "SEM_EVIDENCIA_PRE_2008" && Number(summary.inconclusiveCount || 0) === 0 && Number(summary.doubtCount || 0) === 0
                        ? "Não foi identificada evidência de uso anterior ao marco nas cenas analisadas; a ausência de evidência não comprova a data da conversão."
                        : "A evidência disponível não permite concluir se o uso foi implantado antes ou depois do marco de 22/07/2008 — conferir as limitações e revisar manualmente.",
            },
            {
                label: "Polígonos AUAS analisados",
                status: String(Number(summary.polygonCount || 0)),
                tone: "info",
                detail: `${Number(summary.alertCount || 0)} com alerta · ${Number(summary.doubtCount || 0)} com sinal de dúvida · ${Number(summary.inconclusiveCount || 0)} inconclusivo(s) · ${Number(summary.totalAuasAreaHa || 0).toFixed(2)} ha no total.`,
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
        if (Number(summary.doubtCount || 0) > 0) {
            findings.push({
                label: "Áreas passíveis de discussão",
                status: `${Number(summary.doubtCount || 0)} (${Number(summary.doubtAreaHa || 0).toFixed(2)} ha)`,
                tone: "warn",
                detail: "Polígonos com desmate parcial/gradual, estado misto ou sobreposição geométrica com AC/AVN — ver seção própria e figuras por ano.",
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
                label: "Supressões datadas na série",
                status: `${confirmed + interval} de ${Number(summary.polygonCount || 0)}`,
                tone: confirmed + interval > 0 ? "warn" : "neutral",
                detail: `${confirmed} com ano confirmado e ${interval} com intervalo observado — supressão posterior ao marco depende de AUAS/AUTEX emitida.`,
            },
            {
                label: "Já em uso no início da série",
                status: String(Number(summary.alreadyAnthropizedCount || 0)),
                tone: Number(summary.alreadyAnthropizedCount || 0) > 0 ? "info" : "ok",
                detail: "Uso anterior ao primeiro ano observável — indício de área consolidada (AC); confirmar na Fase 1.",
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
        const inconclusive = Number(summary.inconclusiveCount || 0) > 0;
        return [
            {
                label: "AC com vegetação aparente na imagem",
                status: String(apparent),
                tone: apparent > 0 ? "danger" : inconclusive ? "warn" : "ok",
                detail:
                    apparent > 0
                        ? "Há Área Consolidada com feição de vegetação nativa na cena atual — revisar o polígono declarado."
                        : inconclusive
                            ? "Há AC com resultado inconclusivo; a ausência de detecção não descarta vegetação nativa. Conferir as cenas disponíveis e as limitações."
                            : "Não foi identificada feição de vegetação nativa relevante nas cenas analisadas.",
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

/**
 * Bullets do resumo executivo.
 *
 * Não repete área do imóvel, contagem de camadas nem de feições: os quatro
 * cartões de métrica no topo do laudo já trazem esses números, e repetir em
 * bullet só empurrava o achado relevante para baixo.
 */
export function buildExecutiveBullets(args: {
    jobId: string;
    findings: Finding[];
    timeline?: TimelineModel | null;
}): ExecutiveBullet[] {
    const bullets: ExecutiveBullet[] = [];
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
