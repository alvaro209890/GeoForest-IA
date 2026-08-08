/**
 * Saneamento do texto livre devolvido pela visão (fases 1, 2 e 3).
 *
 * Por que existe: as três fases rejeitavam a janela inteira quando o modelo
 * escrevia uma frase levemente fora do formato — e uma janela rejeitada custa
 * 3 GetMap + 1 chamada de visão e vira `INCONCLUSIVO`. Medido no CAR 6816
 * (aprovado pela SEMA): 5/15 janelas da Fase 1, 13/30 da Fase 2 e 1/1 da
 * Fase 3 caíram com `INVALID_SCHEMA` por dois motivos cosméticos:
 *
 * 1. `FORBIDDEN_LEGAL_TERMS` casava por **substring**, então "regular" batia em
 *    "padrão regular"/"formato regular" (descrição de textura, não veredito) e
 *    "legal" batia em "reserva legal" — o nome da própria camada ARL.
 * 2. Uma frase de 330 caracteres em `conflicts` invalidava a observação toda.
 *
 * A defesa que importa (o laudo não pode conter conclusão jurídica) é mantida:
 * a frase ofensora é **descartada**, e o descarte é contabilizado para ficar
 * auditável — em vez de derrubar a janela inteira.
 */

/** Tamanho máximo de cada frase de evidência/limitação/conflito. */
export const MAX_TEXT_LENGTH = 280;

/**
 * Conclusões jurídicas proibidas na observação visual. São expressões inteiras
 * com fronteira de palavra — nunca substrings soltas. "regular" e "legal" não
 * entram sozinhos: são adjetivos comuns na descrição de imagem ("textura
 * regular") e no nome das camadas do CAR ("Área de Reserva Legal").
 */
const LEGAL_VERDICT_PATTERNS: RegExp[] = [
  /\binfracao\b/,
  /\bauto de infracao\b/,
  /\bpassivo ambiental\b/,
  /\bilegal(mente|idade)?\b/,
  /\birregular(idade|es)?\b/,
  /\bregularidade\b/,
  /\bmulta\b/,
  /\bembargo\b/,
  /\bdesmatamento ilegal\b/,
  /\bcrime ambiental\b/,
];

function normalizeForMatch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Retorna o padrão jurídico encontrado, ou `null` se a frase está limpa. */
export function findLegalVerdict(value: string): string | null {
  const normalized = normalizeForMatch(value);
  const hit = LEGAL_VERDICT_PATTERNS.find((pattern) => pattern.test(normalized));
  return hit ? hit.source : null;
}

export type SanitizeCounters = {
  /** Frases descartadas por conterem conclusão jurídica. */
  droppedLegal: number;
  /** Frases cortadas em MAX_TEXT_LENGTH. */
  truncated: number;
  /** Frases descartadas por excederem o limite de itens do array. */
  droppedOverflow: number;
};

export function emptyCounters(): SanitizeCounters {
  return { droppedLegal: 0, truncated: 0, droppedOverflow: 0 };
}

export function mergeCounters(a: SanitizeCounters, b: SanitizeCounters): SanitizeCounters {
  return {
    droppedLegal: a.droppedLegal + b.droppedLegal,
    truncated: a.truncated + b.truncated,
    droppedOverflow: a.droppedOverflow + b.droppedOverflow,
  };
}

export function hasSanitizeNotes(counters: SanitizeCounters): boolean {
  return counters.droppedLegal > 0 || counters.truncated > 0 || counters.droppedOverflow > 0;
}

/** Descreve o saneamento em uma frase curta, para registrar na janela. */
export function describeSanitize(counters: SanitizeCounters): string | null {
  if (!hasSanitizeNotes(counters)) return null;
  const parts: string[] = [];
  if (counters.droppedLegal > 0) {
    parts.push(`${counters.droppedLegal} frase(s) removida(s) por linguagem conclusiva`);
  }
  if (counters.truncated > 0) parts.push(`${counters.truncated} frase(s) truncada(s)`);
  if (counters.droppedOverflow > 0) parts.push(`${counters.droppedOverflow} frase(s) além do limite`);
  return `Texto da visão saneado: ${parts.join("; ")}.`;
}

/**
 * Sanea uma lista de frases livres: corta no limite, remove conclusões
 * jurídicas e respeita o teto de itens. Nunca lança — devolve `[]` quando a
 * entrada não é uma lista de strings.
 */
export function sanitizeTextArray(
  input: unknown,
  maxItems: number,
  counters: SanitizeCounters
): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (findLegalVerdict(trimmed)) {
      counters.droppedLegal += 1;
      continue;
    }
    let text = trimmed;
    if (text.length > MAX_TEXT_LENGTH) {
      text = `${text.slice(0, MAX_TEXT_LENGTH - 1).trimEnd()}…`;
      counters.truncated += 1;
    }
    if (out.length >= maxItems) {
      counters.droppedOverflow += 1;
      continue;
    }
    out.push(text);
  }
  return out;
}

/** Teto de itens por lista de texto — igual nas três fases. */
const MAX_TEXT_ITEMS = 8;

/**
 * Sanea, **antes** do zod, as listas de texto livre do JSON de visão. As três
 * fases usam os mesmos nomes de campo (`observations[].evidence`,
 * `observations[].limitations`, `transitions[].evidence` e `conflicts`), então
 * um único passe serve para todas. Campos ausentes ou de outro tipo são
 * deixados como estão — quem reclama deles é o schema, que continua estrito
 * para enum, id, ano e fração.
 */
export function sanitizeVisionPayload(raw: unknown): {
  value: unknown;
  counters: SanitizeCounters;
} {
  const counters = emptyCounters();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { value: raw, counters };

  const source = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...source };

  if (Array.isArray(source.observations)) {
    out.observations = source.observations.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const obs = item as Record<string, unknown>;
      return {
        ...obs,
        ...(obs.evidence !== undefined
          ? { evidence: sanitizeTextArray(obs.evidence, MAX_TEXT_ITEMS, counters) }
          : {}),
        ...(obs.limitations !== undefined
          ? { limitations: sanitizeTextArray(obs.limitations, MAX_TEXT_ITEMS, counters) }
          : {}),
      };
    });
  }

  if (Array.isArray(source.transitions)) {
    out.transitions = source.transitions.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const transition = item as Record<string, unknown>;
      return {
        ...transition,
        ...(transition.evidence !== undefined
          ? { evidence: sanitizeTextArray(transition.evidence, MAX_TEXT_ITEMS, counters) }
          : {}),
      };
    });
  }

  if (source.conflicts !== undefined) {
    out.conflicts = sanitizeTextArray(source.conflicts, MAX_TEXT_ITEMS, counters);
  }

  return { value: out, counters };
}
