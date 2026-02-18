import crypto from "crypto";
import fs from "fs";
import path from "path";
import { inflateRawSync } from "zlib";

export type ChatMessageLike = {
  role: string;
  content: any;
};

export type KnowledgeTier = "law" | "tr2024" | "technical";

export type KnowledgeDoc = {
  id: string;
  relPath: string;
  title: string;
  tags: string[];
  text: string;
  section: string;
  tier: KnowledgeTier;
  isIndex: boolean;
  isPending: boolean;
  searchable: boolean;
  source: "disk" | "zip";
  mtimeMs: number;
};

export type KnowledgeTelemetry = {
  mode: "hybrid_controlled";
  docsUsed: string[];
  summaryUsed: boolean;
  contextChars: number;
  policy: "law>tr2024>others";
};

export type KnowledgeSelection = {
  queryText: string;
  queryTerms: string[];
  contextParts: string[];
  contextChars: number;
  docs: KnowledgeDoc[];
  isComplexQuery: boolean;
};

export type KnowledgeHealth = {
  ok: boolean;
  docsTotal: number;
  docsSearchable: number;
  docsExcluded: string[];
  zipDetected: boolean;
  sourcePolicy: "law>tr2024>others";
  updatedAtIso: string;
  versionHash: string;
};

export type SummaryModelCall = (args: {
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
}) => Promise<string>;

type KnowledgeInitOptions = {
  dbRoot: string;
  zipPath: string;
  summaryModel?: string;
  summaryMaxTokens?: number;
  summaryEnabled?: boolean;
};

type FieldName = "title" | "tags" | "path" | "body";

type IndexedDoc = {
  doc: KnowledgeDoc;
  fieldTf: Record<FieldName, Map<string, number>>;
  fieldLen: Record<FieldName, number>;
  allTextNormalized: string;
};

type RankedDoc = {
  doc: IndexedDoc;
  score: number;
  matchedTerms: Set<string>;
};

type SelectionCacheValue = {
  expiresAt: number;
  versionHash: string;
  selection: KnowledgeSelection;
};

type SummaryCacheValue = {
  expiresAt: number;
  versionHash: string;
  message: { role: "system"; content: string } | null;
};

type ZipDocEntry = {
  relPath: string;
  text: string;
  mtimeMs: number;
};

const KNOWLEDGE_POLICY = "law>tr2024>others" as const;
const KNOWLEDGE_MODE = "hybrid_controlled" as const;
const CACHE_TTL_MS = 30 * 60 * 1000;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const FIELD_WEIGHTS: Record<FieldName, number> = {
  title: 2.2,
  tags: 1.5,
  path: 1.0,
  body: 1.0,
};
const FIELD_ORDER: FieldName[] = ["title", "tags", "path", "body"];
const DEFAULT_SUMMARY_MODEL = "openai/gpt-oss-20b";
const DEFAULT_SUMMARY_MAX_TOKENS = 220;
const DEFAULT_MAX_CONTEXT_CHARS = 2200;
const COMPLEX_MAX_CONTEXT_CHARS = 3200;

const QUERY_EXPANSIONS: Array<{ pattern: RegExp; text: string }> = [
  { pattern: /\baqc\b/i, text: "queima controlada tr30" },
  { pattern: /\btr\s*0*1\b|\btr0*1\b/i, text: "documentacao empreendedor tr01 sugf" },
  { pattern: /\btr\s*0*28\b|\btr0*28\b/i, text: "inventario florestal manejo pef pmfs" },
  { pattern: /\btr\s*0*33\b|\btr0*33\b/i, text: "corte final acf pcf exploracao florestal" },
  { pattern: /\btr\s*0*02\b|\btr0*02\b/i, text: "hidrografia geoprocessamento mapas ccra srma" },
];

const SHORT_TECH_TOKENS = new Set([
  "tr",
  "rl",
  "lc",
  "in",
  "ip",
  "apf",
  "car",
  "app",
  "pra",
  "asv",
  "aqc",
]);

const STOPWORDS = new Set([
  "a",
  "o",
  "os",
  "as",
  "um",
  "uma",
  "uns",
  "umas",
  "de",
  "da",
  "do",
  "das",
  "dos",
  "em",
  "no",
  "na",
  "nos",
  "nas",
  "por",
  "para",
  "com",
  "sem",
  "e",
  "ou",
  "que",
  "como",
  "qual",
  "quais",
  "quando",
  "onde",
  "porque",
  "por que",
  "se",
  "ao",
  "aos",
  "a",
  "as",
  "dos",
  "das",
  "no",
  "na",
  "e",
  "ser",
  "sao",
  "foi",
  "era",
  "sua",
  "seu",
  "suas",
  "seus",
  "me",
  "minha",
  "meu",
  "meus",
  "minhas",
  "voce",
  "voces",
  "nosso",
  "nossa",
  "nossos",
  "nossas",
  "tambem",
  "mais",
  "menos",
  "muito",
  "pouco",
  "ja",
  "ainda",
  "ate",
  "sobre",
  "entre",
  "dentro",
  "fora",
  "cada",
  "todo",
  "toda",
  "todos",
  "todas",
  "isso",
  "isto",
  "essa",
  "esse",
  "aquele",
  "aquela",
  "aquilo",
  "seja",
  "ha",
]);

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").replace(/^\.\//, "");
}

function tokenize(value: string) {
  const normalized = normalizeText(value);
  const rawTokens = normalized.match(/[a-z0-9./_-]+/g) || [];
  const out: string[] = [];
  for (const raw of rawTokens) {
    const base = raw.trim();
    if (!base) continue;
    const hasDigits = /\d/.test(base);
    const alphaNum = base.replace(/[^a-z0-9]/g, "");
    if (alphaNum) {
      if (
        alphaNum.length >= 3 ||
        (alphaNum.length === 2 && SHORT_TECH_TOKENS.has(alphaNum)) ||
        (hasDigits && alphaNum.length >= 2)
      ) {
        if (!STOPWORDS.has(alphaNum)) out.push(alphaNum);
      }
    }
    const splitParts = base.split(/[./_-]+/g).map((t) => t.trim()).filter(Boolean);
    for (const part of splitParts) {
      if (
        part.length >= 3 ||
        (part.length === 2 && SHORT_TECH_TOKENS.has(part)) ||
        (/\d/.test(part) && part.length >= 2)
      ) {
        if (!STOPWORDS.has(part)) out.push(part);
      }
    }
  }
  return [...new Set(out)];
}

function extractLatestUserText(messages: ChatMessageLike[]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    if (typeof msg.content === "string") return msg.content;
    if (Array.isArray(msg.content)) {
      return msg.content
        .map((part: any) => (part?.type === "text" ? String(part?.text || "") : ""))
        .join("\n");
    }
  }
  return "";
}

function parseTags(raw: string) {
  const lines = raw.split(/\r?\n/);
  const tagLine = lines.find((line) => /^tags\s*:/i.test(line.trim()));
  if (!tagLine) return [];
  const rhs = tagLine.replace(/^tags\s*:/i, "").trim();
  const inBackticks = [...rhs.matchAll(/`([^`]+)`/g)]
    .map((m) => String(m[1] || "").trim())
    .filter(Boolean);
  if (inBackticks.length) return inBackticks;
  return rhs
    .split(/[;,]/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function inferTier(relPath: string): KnowledgeTier {
  const lower = relPath.toLowerCase();
  if (
    lower.startsWith("02_legislacao_federal/") ||
    lower.startsWith("03_legislacao_estadual/")
  ) {
    return "law";
  }
  if (lower.startsWith("08_termos_referencia_sema/")) return "tr2024";
  return "technical";
}

function parseSection(relPath: string) {
  const normalized = normalizePath(relPath);
  const [section] = normalized.split("/");
  return section || "root";
}

function dosDateTimeToMs(date: number, time: number) {
  if (!date && !time) return 0;
  const day = date & 0x1f;
  const month = (date >> 5) & 0x0f;
  const year = ((date >> 9) & 0x7f) + 1980;
  const second = (time & 0x1f) * 2;
  const minute = (time >> 5) & 0x3f;
  const hour = (time >> 11) & 0x1f;
  return Date.UTC(year, Math.max(0, month - 1), Math.max(1, day), hour, minute, second);
}

function readMarkdownFromDisk(root: string): ZipDocEntry[] {
  const out: ZipDocEntry[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".md")) continue;
      const relPath = normalizePath(path.relative(root, fullPath));
      const raw = fs.readFileSync(fullPath, "utf8");
      const stats = fs.statSync(fullPath);
      out.push({
        relPath,
        text: raw,
        mtimeMs: Number(stats.mtimeMs || 0),
      });
    }
  };
  walk(root);
  return out;
}

function readMarkdownFromZip(zipPath: string): ZipDocEntry[] {
  if (!zipPath || !fs.existsSync(zipPath)) return [];
  const zipBuffer = fs.readFileSync(zipPath);
  const out: ZipDocEntry[] = [];
  const EOCD_SIG = 0x06054b50;
  const CEN_SIG = 0x02014b50;
  const LOC_SIG = 0x04034b50;
  const maxScan = Math.min(zipBuffer.length, 65557);

  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= zipBuffer.length - maxScan; i -= 1) {
    if (i < 0) break;
    if (zipBuffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return out;

  const totalEntries = zipBuffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  let cenOffset = centralDirOffset;

  for (let i = 0; i < totalEntries; i += 1) {
    if (cenOffset + 46 > zipBuffer.length) break;
    if (zipBuffer.readUInt32LE(cenOffset) !== CEN_SIG) break;

    const method = zipBuffer.readUInt16LE(cenOffset + 10);
    const modTime = zipBuffer.readUInt16LE(cenOffset + 12);
    const modDate = zipBuffer.readUInt16LE(cenOffset + 14);
    const compressedSize = zipBuffer.readUInt32LE(cenOffset + 20);
    const fileNameLength = zipBuffer.readUInt16LE(cenOffset + 28);
    const extraLength = zipBuffer.readUInt16LE(cenOffset + 30);
    const commentLength = zipBuffer.readUInt16LE(cenOffset + 32);
    const localHeaderOffset = zipBuffer.readUInt32LE(cenOffset + 42);

    const fileNameStart = cenOffset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > zipBuffer.length) break;
    const fileName = normalizePath(zipBuffer.subarray(fileNameStart, fileNameEnd).toString("utf8"));

    cenOffset = fileNameEnd + extraLength + commentLength;
    if (!fileName.toLowerCase().endsWith(".md")) continue;

    if (localHeaderOffset + 30 > zipBuffer.length) continue;
    if (zipBuffer.readUInt32LE(localHeaderOffset) !== LOC_SIG) continue;

    const localNameLen = zipBuffer.readUInt16LE(localHeaderOffset + 26);
    const localExtraLen = zipBuffer.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) continue;

    const compressed = zipBuffer.subarray(dataStart, dataEnd);
    let data: Buffer;
    if (method === 0) {
      data = Buffer.from(compressed);
    } else if (method === 8) {
      try {
        data = Buffer.from(inflateRawSync(compressed));
      } catch {
        continue;
      }
    } else {
      continue;
    }

    out.push({
      relPath: fileName,
      text: data.toString("utf8"),
      mtimeMs: dosDateTimeToMs(modDate, modTime),
    });
  }

  return out;
}

function hashSelectionKey(queryNormalized: string, versionHash: string) {
  return crypto
    .createHash("sha1")
    .update(`${versionHash}::${queryNormalized}`)
    .digest("hex");
}

function hashSummaryKey(
  queryText: string,
  docsUsed: string[],
  contextParts: string[],
  versionHash: string,
) {
  return crypto
    .createHash("sha1")
    .update(
      JSON.stringify({
        versionHash,
        queryText: normalizeText(queryText),
        docsUsed,
        contextParts,
      }),
    )
    .digest("hex");
}

function normalizeQueryForCache(queryText: string) {
  return normalizeText(queryText).replace(/\s+/g, " ").trim();
}

function isComplexQuery(queryText: string, terms: string[]) {
  if (terms.length >= 10) return true;
  const normalized = normalizeText(queryText);
  const complexityRegex =
    /\b(lei|lc|in|decreto|portaria|artigo|art|prazo|procedimento|licenciamento|requisito|documentacao|tr|simcar|pra|car|pmfs|regularizacao)\b/;
  return complexityRegex.test(normalized);
}

function parseNormativeHints(queryText: string) {
  const normalized = normalizeText(queryText);
  const trMatches = [...normalized.matchAll(/\btr\s*0*(\d{1,3})\b/g)].map((m) => m[1]);
  const lcMatches = [...normalized.matchAll(/\blc\s*0*(\d{1,4})\b/g)].map((m) => m[1]);
  const leiMatches = [...normalized.matchAll(/\blei\s*([0-9][0-9./]+)/g)].map((m) =>
    String(m[1] || "").replace(/[^0-9]/g, ""),
  );
  return {
    trs: [...new Set(trMatches)],
    lcs: [...new Set(lcMatches)],
    leis: [...new Set(leiMatches)],
  };
}

function looksLikeLegalOrProceduralTopic(queryText: string, terms: string[]) {
  return isComplexQuery(queryText, terms);
}

export function createKnowledgeBase(options: KnowledgeInitOptions) {
  const dbRoot = options.dbRoot;
  const zipPath = options.zipPath;
  const summaryModel = options.summaryModel || process.env.DB_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL;
  const summaryMaxTokens = Number(
    options.summaryMaxTokens ?? process.env.DB_SUMMARY_MAX_TOKENS ?? DEFAULT_SUMMARY_MAX_TOKENS,
  );
  const summaryEnabled =
    options.summaryEnabled !== undefined
      ? options.summaryEnabled
      : String(process.env.DB_SUMMARY_ENABLED ?? "true") !== "false";

  let docs: IndexedDoc[] = [];
  let searchableDocs: IndexedDoc[] = [];
  let docsExcluded: string[] = [];
  let zipDetected = false;
  let updatedAtIso = new Date().toISOString();
  let versionHash = "";
  let fieldDf: Record<FieldName, Map<string, number>> = {
    title: new Map(),
    tags: new Map(),
    path: new Map(),
    body: new Map(),
  };
  let fieldAvgLen: Record<FieldName, number> = {
    title: 1,
    tags: 1,
    path: 1,
    body: 1,
  };

  const selectionCache = new Map<string, SelectionCacheValue>();
  const summaryCache = new Map<string, SummaryCacheValue>();

  const clearCaches = () => {
    selectionCache.clear();
    summaryCache.clear();
  };

  const getFieldTermMap = (tokens: string[]) => {
    const map = new Map<string, number>();
    for (const token of tokens) {
      map.set(token, (map.get(token) || 0) + 1);
    }
    return map;
  };

  const toIndexedDoc = (entry: KnowledgeDoc): IndexedDoc => {
    const titleTokens = tokenize(entry.title);
    const tagsTokens = tokenize(entry.tags.join(" "));
    const pathTokens = tokenize(entry.relPath);
    const bodyTokens = tokenize(entry.text);
    return {
      doc: entry,
      fieldTf: {
        title: getFieldTermMap(titleTokens),
        tags: getFieldTermMap(tagsTokens),
        path: getFieldTermMap(pathTokens),
        body: getFieldTermMap(bodyTokens),
      },
      fieldLen: {
        title: Math.max(1, titleTokens.length),
        tags: Math.max(1, tagsTokens.length),
        path: Math.max(1, pathTokens.length),
        body: Math.max(1, bodyTokens.length),
      },
      allTextNormalized: normalizeText(`${entry.relPath}\n${entry.title}\n${entry.tags.join(" ")}\n${entry.text}`),
    };
  };

  const buildFieldStats = (items: IndexedDoc[]) => {
    const nextDf: Record<FieldName, Map<string, number>> = {
      title: new Map(),
      tags: new Map(),
      path: new Map(),
      body: new Map(),
    };
    const totalLen: Record<FieldName, number> = {
      title: 0,
      tags: 0,
      path: 0,
      body: 0,
    };

    for (const item of items) {
      for (const field of FIELD_ORDER) {
        totalLen[field] += item.fieldLen[field];
        const seen = new Set<string>();
        for (const term of item.fieldTf[field].keys()) {
          if (seen.has(term)) continue;
          nextDf[field].set(term, (nextDf[field].get(term) || 0) + 1);
          seen.add(term);
        }
      }
    }
    const count = items.length || 1;
    const nextAvg: Record<FieldName, number> = {
      title: Math.max(1, totalLen.title / count),
      tags: Math.max(1, totalLen.tags / count),
      path: Math.max(1, totalLen.path / count),
      body: Math.max(1, totalLen.body / count),
    };
    fieldDf = nextDf;
    fieldAvgLen = nextAvg;
  };

  const loadDocs = () => {
    try {
      const diskDocs = readMarkdownFromDisk(dbRoot);
      const zipDocs = readMarkdownFromZip(zipPath);
      zipDetected = zipDocs.length > 0 || fs.existsSync(zipPath);

      const merged = new Map<string, { relPath: string; text: string; mtimeMs: number; source: "disk" | "zip" }>();
      for (const item of diskDocs) {
        merged.set(item.relPath, { ...item, source: "disk" });
      }
      for (const item of zipDocs) {
        const existing = merged.get(item.relPath);
        if (!existing || item.mtimeMs > existing.mtimeMs) {
          merged.set(item.relPath, { ...item, source: "zip" });
        }
      }

      const docsRaw: KnowledgeDoc[] = [...merged.values()]
        .sort((a, b) => a.relPath.localeCompare(b.relPath))
        .map((item) => {
          const titleLine =
            item.text
              .split(/\r?\n/)
              .find((line) => line.trim().startsWith("#")) || "";
          const title = titleLine.replace(/^#+\s*/, "").trim() || item.relPath;
          const relPath = normalizePath(item.relPath);
          const isIndex = relPath.toLowerCase() === "indice.md";
          const isPending = /\[PENDENTE\]/i.test(item.text);
          const searchable = !isIndex && !isPending && item.text.trim().length > 0;
          return {
            id: relPath,
            relPath,
            title,
            tags: parseTags(item.text),
            text: item.text,
            section: parseSection(relPath),
            tier: inferTier(relPath),
            isIndex,
            isPending,
            searchable,
            source: item.source,
            mtimeMs: item.mtimeMs || 0,
          };
        });

      const indexed = docsRaw.map(toIndexedDoc);
      const searchable = indexed.filter((item) => item.doc.searchable);
      docs = indexed;
      searchableDocs = searchable;
      docsExcluded = docs
        .filter((item) => !item.doc.searchable)
        .map((item) => item.doc.relPath)
        .sort((a, b) => a.localeCompare(b));
      buildFieldStats(searchableDocs);

      updatedAtIso = new Date().toISOString();
      const hashPayload = docs
        .map((item) =>
          `${item.doc.relPath}:${item.doc.mtimeMs}:${item.doc.text.length}:${crypto
            .createHash("sha1")
            .update(item.doc.text)
            .digest("hex")}`,
        )
        .join("|");
      versionHash = crypto.createHash("sha256").update(hashPayload).digest("hex").slice(0, 16);

      const sectionCount: Record<string, number> = {};
      for (const item of docs) {
        sectionCount[item.doc.section] = (sectionCount[item.doc.section] || 0) + 1;
      }
      clearCaches();
      console.log(
        `[KNOWLEDGE] loaded docs=${docs.length} searchable=${searchableDocs.length} zipDetected=${zipDetected} version=${versionHash} sections=${JSON.stringify(
          sectionCount,
        )}`,
      );
    } catch (error) {
      console.warn("[KNOWLEDGE] failed to load docs:", error);
      docs = [];
      searchableDocs = [];
      docsExcluded = [];
      fieldDf = { title: new Map(), tags: new Map(), path: new Map(), body: new Map() };
      fieldAvgLen = { title: 1, tags: 1, path: 1, body: 1 };
      updatedAtIso = new Date().toISOString();
      versionHash = "";
      clearCaches();
    }
  };

  const buildQueryTerms = (queryText: string) => {
    const expandedParts = [queryText];
    for (const expansion of QUERY_EXPANSIONS) {
      if (expansion.pattern.test(queryText)) {
        expandedParts.push(expansion.text);
      }
    }
    return tokenize(expandedParts.join("\n"));
  };

  const scoreDocField = (
    tfMap: Map<string, number>,
    len: number,
    avgLen: number,
    term: string,
    df: number,
    docCount: number,
  ) => {
    const tf = tfMap.get(term) || 0;
    if (!tf) return 0;
    const idf = Math.log(1 + (docCount - df + 0.5) / (df + 0.5));
    const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (len / Math.max(1, avgLen)));
    return idf * ((tf * (BM25_K1 + 1)) / denom);
  };

  const scoreDocs = (terms: string[], pool: IndexedDoc[]) => {
    const ranked: RankedDoc[] = [];
    const uniqueTerms = [...new Set(terms)];
    const docCount = Math.max(1, pool.length);
    for (const doc of pool) {
      let score = 0;
      const matchedTerms = new Set<string>();
      for (const field of FIELD_ORDER) {
        const tfMap = doc.fieldTf[field];
        for (const term of uniqueTerms) {
          const df = fieldDf[field].get(term) || 0;
          const rawScore = scoreDocField(
            tfMap,
            doc.fieldLen[field],
            fieldAvgLen[field],
            term,
            df,
            docCount,
          );
          if (rawScore > 0) {
            score += FIELD_WEIGHTS[field] * rawScore;
            matchedTerms.add(term);
          }
        }
      }
      if (score <= 0) continue;
      ranked.push({ doc, score, matchedTerms });
    }
    ranked.sort((a, b) => b.score - a.score);
    return ranked;
  };

  const rerank = (queryText: string, terms: string[], rankedStage1: RankedDoc[]) => {
    const hints = parseNormativeHints(queryText);
    const withBoost = rankedStage1.map((item) => {
      let boost = 0;
      if (item.doc.doc.tier === "law") boost += 0.25;
      if (item.doc.doc.tier === "tr2024") boost += 0.18;

      const docTextNorm = item.doc.allTextNormalized;
      for (const tr of hints.trs) {
        if (docTextNorm.includes(`tr ${tr}`) || docTextNorm.includes(`tr${tr}`)) boost += 0.85;
      }
      for (const lc of hints.lcs) {
        if (docTextNorm.includes(`lc ${lc}`) || docTextNorm.includes(`lc${lc}`)) boost += 0.8;
      }
      for (const lei of hints.leis) {
        if (lei && docTextNorm.includes(lei)) boost += 0.7;
      }
      return {
        ...item,
        score: item.score + boost,
      };
    });
    withBoost.sort((a, b) => b.score - a.score);

    const topScore = withBoost[0]?.score || 0;
    const lowConfidence = topScore < 2;
    const targetCount = lowConfidence ? 5 : 4;
    const hardMax = lowConfidence ? 6 : 4;

    const selected: RankedDoc[] = [];
    const coveredTerms = new Set<string>();
    for (const candidate of withBoost) {
      if (selected.length >= hardMax) break;
      const newTerms = [...candidate.matchedTerms].filter((term) => !coveredTerms.has(term));
      const hasCoverageGain = newTerms.length > 0;
      const duplicatedProfile = selected.some(
        (item) =>
          item.doc.doc.section === candidate.doc.doc.section &&
          item.doc.doc.tier === candidate.doc.doc.tier,
      );
      if (!hasCoverageGain && duplicatedProfile && selected.length >= 2) continue;
      selected.push(candidate);
      for (const term of newTerms) coveredTerms.add(term);
      if (selected.length >= targetCount && coveredTerms.size >= Math.min(4, terms.length)) break;
    }

    if (selected.length < targetCount) {
      for (const candidate of withBoost) {
        if (selected.length >= targetCount) break;
        if (selected.some((item) => item.doc.doc.relPath === candidate.doc.doc.relPath)) continue;
        selected.push(candidate);
      }
    }

    return selected;
  };

  const buildContextParts = (
    selectionDocs: RankedDoc[],
    terms: string[],
    maxContextChars: number,
  ) => {
    const contextParts: string[] = [];
    let usedChars = 0;
    for (const ranked of selectionDocs) {
      const doc = ranked.doc.doc;
      const paragraphs = doc.text
        .split(/\n\s*\n+/)
        .map((p) => p.trim())
        .filter(Boolean);

      const scoredParagraphs = paragraphs
        .map((paragraph) => {
          const paragraphNormalized = normalizeText(paragraph);
          let paragraphScore = 0;
          for (const term of terms) {
            if (paragraphNormalized.includes(term)) paragraphScore += 1;
          }
          if (/lei\s+\d|lc\s+\d|tr\s+\d|art\.\s*\d|artigo\s+\d/i.test(paragraph)) {
            paragraphScore += 1.2;
          }
          return { paragraph, paragraphScore };
        })
        .sort((a, b) => b.paragraphScore - a.paragraphScore);

      const chosen = scoredParagraphs.filter((p) => p.paragraphScore > 0).slice(0, 2);
      if (!chosen.length && paragraphs.length) {
        chosen.push({ paragraph: paragraphs[0], paragraphScore: 0 });
      }
      if (!chosen.length) continue;

      const perDocCap = Math.max(
        260,
        Math.min(760, Math.floor(maxContextChars / Math.max(1, selectionDocs.length))),
      );
      const excerpt = chosen
        .map((item) => item.paragraph)
        .join("\n\n")
        .slice(0, perDocCap);
      if (!excerpt) continue;

      const part = `Fonte: ${doc.relPath}\n${excerpt}`.trim();
      if (usedChars + part.length <= maxContextChars) {
        contextParts.push(part);
        usedChars += part.length;
        continue;
      }

      const remaining = maxContextChars - usedChars;
      if (remaining < 140) break;
      const truncated = part.slice(0, remaining).trim();
      if (truncated.length >= 140) {
        contextParts.push(truncated);
        usedChars += truncated.length;
      }
      break;
    }
    return {
      contextParts,
      contextChars: usedChars,
    };
  };

  const canUseSummary = (selection: KnowledgeSelection) => {
    if (!summaryEnabled) return false;
    if (!selection.contextParts.length) return false;
    if (selection.contextChars <= 2400) return false;
    if (selection.docs.length < 4) return false;
    if (!selection.isComplexQuery) return false;
    return true;
  };

  const selectByQuery = (queryText: string) => {
    const queryNormalized = normalizeQueryForCache(queryText);
    if (!queryNormalized) return null;
    const cacheKey = hashSelectionKey(queryNormalized, versionHash);
    const now = Date.now();
    const cached = selectionCache.get(cacheKey);
    if (cached && cached.expiresAt > now && cached.versionHash === versionHash) {
      return cached.selection;
    }

    const terms = buildQueryTerms(queryText);
    if (!terms.length) return null;

    let ranked = scoreDocs(terms, searchableDocs).slice(0, 12);
    if (!ranked.length) {
      const fallbackPool = docs.filter((doc) => !doc.doc.isIndex);
      ranked = scoreDocs(terms, fallbackPool).slice(0, 12);
      if (!ranked.length) return null;
    }

    const reranked = rerank(queryText, terms, ranked);
    const selectionDocs = reranked.filter((item) => !item.doc.doc.isIndex);
    if (!selectionDocs.length) return null;

    const complex = looksLikeLegalOrProceduralTopic(queryText, terms);
    const maxContextChars = complex ? COMPLEX_MAX_CONTEXT_CHARS : DEFAULT_MAX_CONTEXT_CHARS;
    const context = buildContextParts(selectionDocs, terms, maxContextChars);
    if (!context.contextParts.length) return null;

    const selection: KnowledgeSelection = {
      queryText,
      queryTerms: terms,
      contextParts: context.contextParts,
      contextChars: context.contextChars,
      docs: selectionDocs.map((item) => item.doc.doc),
      isComplexQuery: complex,
    };

    selectionCache.set(cacheKey, {
      expiresAt: now + CACHE_TTL_MS,
      versionHash,
      selection,
    });
    return selection;
  };

  const buildKnowledgeContextMessage = (selection: KnowledgeSelection) => {
    if (!selection.contextParts.length) return null;
    const contextText = selection.contextParts.join("\n\n");
    return {
      role: "system" as const,
      content:
        "## BASE DE CONHECIMENTO (MODO HIBRIDO CONTROLADO)\n" +
        "Use os excertos abaixo como fonte primaria e cite as fontes no formato [arquivo.md].\n\n" +
        "REGRAS OBRIGATORIAS:\n" +
        "1. Priorize a seguinte precedencia de fontes: lei > tr2024 > demais.\n" +
        "2. Se faltar evidencia na base, adicione um bloco curto chamado \"Complemento geral (verificar norma vigente)\" sem citar arquivo.\n" +
        "3. Se houver conflito entre fontes da base e nao for possivel resolver, diga explicitamente: \"ha divergencia entre fontes da base\".\n" +
        "4. Nao invente artigos, numeros normativos ou dados nao presentes nos excertos.\n" +
        "5. Ao citar norma legal, mantenha o numero e ano exatamente como no excerto.\n\n" +
        "Excertos:\n" +
        contextText,
    };
  };

  const maybeBuildGuidedSummary = async (
    selection: KnowledgeSelection,
    runModel: SummaryModelCall,
  ): Promise<{ message: { role: "system"; content: string } | null; summaryUsed: boolean }> => {
    if (!canUseSummary(selection)) {
      return { message: null, summaryUsed: false };
    }

    const docsUsed = selection.docs.map((doc) => doc.relPath);
    const key = hashSummaryKey(selection.queryText, docsUsed, selection.contextParts, versionHash);
    const now = Date.now();
    const cached = summaryCache.get(key);
    if (cached && cached.expiresAt > now && cached.versionHash === versionHash) {
      return { message: cached.message, summaryUsed: Boolean(cached.message) };
    }

    const summaryPrompt = [
      "Voce e um assistente de sumarizacao tecnica.",
      "Resuma os excertos em no maximo 7 bullets curtos.",
      "Regras obrigatorias:",
      "- Use apenas informacao presente nos excertos.",
      "- Cite fontes no formato [arquivo.md].",
      "- Se nao houver informacao suficiente, diga explicitamente.",
      "- Nao invente numeros normativos.",
      `- Mantenha precedencia: ${KNOWLEDGE_POLICY}.`,
    ].join("\n");
    const summaryMessages = [
      { role: "system" as const, content: summaryPrompt },
      {
        role: "user" as const,
        content:
          `Pergunta do usuario: ${selection.queryText}\n\n` +
          "Excertos da base:\n" +
          selection.contextParts.join("\n\n"),
      },
    ];

    try {
      const summary = await runModel({
        model: summaryModel,
        messages: summaryMessages,
        maxTokens: summaryMaxTokens,
        temperature: 0.05,
      });
      const clean = String(summary || "").trim();
      if (!clean) {
        summaryCache.set(key, {
          expiresAt: now + CACHE_TTL_MS,
          versionHash,
          message: null,
        });
        return { message: null, summaryUsed: false };
      }
      const message = {
        role: "system" as const,
        content:
          "Resumo guiado da Base de Conhecimento (nao contem informacao adicional):\n" +
          clean,
      };
      summaryCache.set(key, {
        expiresAt: now + CACHE_TTL_MS,
        versionHash,
        message,
      });
      return { message, summaryUsed: true };
    } catch (error) {
      console.warn("[KNOWLEDGE] guided summary failed:", error);
      return { message: null, summaryUsed: false };
    }
  };

  const toTelemetry = (
    selection: KnowledgeSelection | null,
    summaryUsed: boolean,
  ): KnowledgeTelemetry => {
    if (!selection) {
      return {
        mode: KNOWLEDGE_MODE,
        docsUsed: [],
        summaryUsed: false,
        contextChars: 0,
        policy: KNOWLEDGE_POLICY,
      };
    }
    return {
      mode: KNOWLEDGE_MODE,
      docsUsed: selection.docs.map((doc) => doc.relPath),
      summaryUsed,
      contextChars: selection.contextChars,
      policy: KNOWLEDGE_POLICY,
    };
  };

  const getHealth = (): KnowledgeHealth => ({
    ok: true,
    docsTotal: docs.length,
    docsSearchable: searchableDocs.length,
    docsExcluded: [...docsExcluded],
    zipDetected,
    sourcePolicy: KNOWLEDGE_POLICY,
    updatedAtIso,
    versionHash,
  });

  loadDocs();

  return {
    refresh: loadDocs,
    selectForMessages(messages: ChatMessageLike[]) {
      const queryText = extractLatestUserText(messages);
      return selectByQuery(queryText);
    },
    buildContextSystemMessage(selection: KnowledgeSelection) {
      return buildKnowledgeContextMessage(selection);
    },
    maybeBuildGuidedSummary,
    toTelemetry,
    getHealth,
    getPolicy() {
      return KNOWLEDGE_POLICY;
    },
  };
}
