import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

export type BillingProvider = "groq" | "gemini" | "cloudinary";

export type UsageRecordInput = {
  provider?: BillingProvider;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  endpoint?: string;
  estimated?: boolean;
};

export type SettledUsageRecord = {
  provider: BillingProvider;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costBrl: number;
  endpoint: string;
  estimated: boolean;
};

type BillingSessionStore = {
  usages: UsageRecordInput[];
};

type PricingTier = {
  inputUsdPer1M: number;
  outputUsdPer1M: number;
};

type ModelPricing = {
  base: PricingTier;
  over200kPrompt?: PricingTier;
};

const usageStorage = new AsyncLocalStorage<BillingSessionStore>();

const BILLING_MARGIN = Number.parseFloat(process.env.BILLING_MARGIN || "1.50") || 1.5;
const MIN_CHARGE_BRL = Number.parseFloat(process.env.BILLING_MIN_CHARGE_BRL || "0.01") || 0.01;
const BILLING_ASSISTANT_CHAT_MULTIPLIER =
  Number.parseFloat(process.env.BILLING_ASSISTANT_CHAT_MULTIPLIER || "1.25") || 1.25;
const USD_BRL_FALLBACK = Number.parseFloat(process.env.USD_BRL_FALLBACK || "5.2257") || 5.2257;
const RATE_CACHE_MS = 8 * 60 * 60 * 1000;
const CLOUDINARY_PLUS_MONTHLY_USD = Number.parseFloat(process.env.CLOUDINARY_PLUS_MONTHLY_USD || "99") || 99;
const CLOUDINARY_PLUS_MONTHLY_CREDITS = Number.parseFloat(process.env.CLOUDINARY_PLUS_MONTHLY_CREDITS || "225") || 225;
const CLOUDINARY_STORAGE_USD_PER_GB_MONTH = Number.parseFloat(process.env.CLOUDINARY_STORAGE_USD_PER_GB_MONTH || "") ||
  (CLOUDINARY_PLUS_MONTHLY_USD / Math.max(1, CLOUDINARY_PLUS_MONTHLY_CREDITS));
const CLOUDINARY_STORAGE_BILLING_DAYS = Number.parseFloat(process.env.CLOUDINARY_STORAGE_BILLING_DAYS || "30") || 30;
const MIN_STORAGE_CHARGE_BRL = Number.parseFloat(process.env.BILLING_MIN_STORAGE_CHARGE_BRL || "0.001") || 0.001;
const MAX_RESERVE_BRL = Number.parseFloat(process.env.BILLING_MAX_RESERVE_BRL || "10") || 10;

const MODEL_PRICING_USD: Record<string, ModelPricing> = {
  "openai/gpt-oss-20b": { base: { inputUsdPer1M: 0.1, outputUsdPer1M: 0.5 } },
  "openai/gpt-oss-120b": { base: { inputUsdPer1M: 0.15, outputUsdPer1M: 0.75 } },
  "meta-llama/llama-3.3-70b-versatile": { base: { inputUsdPer1M: 0.59, outputUsdPer1M: 0.79 } },
  "meta-llama/llama-4-scout-17b-16e-instruct": { base: { inputUsdPer1M: 0.11, outputUsdPer1M: 0.34 } },
  "meta-llama/llama-4-maverick-17b-128e-instruct": { base: { inputUsdPer1M: 0.2, outputUsdPer1M: 0.6 } },
  "meta-llama/llama-guard-4-12b": { base: { inputUsdPer1M: 0.2, outputUsdPer1M: 0.2 } },
  "qwen/qwen3-32b": { base: { inputUsdPer1M: 0.29, outputUsdPer1M: 0.59 } },
  "moonshotai/kimi-k2-instruct-0905": { base: { inputUsdPer1M: 1.0, outputUsdPer1M: 3.0 } },
  "gemini-3-flash": {
    base: { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
    over200kPrompt: { inputUsdPer1M: 0.3, outputUsdPer1M: 2.5 },
  },
  "gemini-2.5-flash": {
    base: { inputUsdPer1M: 0.15, outputUsdPer1M: 0.6 },
    over200kPrompt: { inputUsdPer1M: 0.3, outputUsdPer1M: 2.5 },
  },
  "gemini-3-pro": {
    base: { inputUsdPer1M: 1.25, outputUsdPer1M: 10.0 },
    over200kPrompt: { inputUsdPer1M: 2.5, outputUsdPer1M: 15.0 },
  },
  "gemini-2.5-pro": {
    base: { inputUsdPer1M: 1.25, outputUsdPer1M: 10.0 },
    over200kPrompt: { inputUsdPer1M: 2.5, outputUsdPer1M: 15.0 },
  },
  "nano-banana-pro": {
    base: { inputUsdPer1M: 2.5, outputUsdPer1M: 15.0 },
  },
};

let rateCache: { value: number; fetchedAt: number; source: string } | null = null;

function normalizeEndpoint(endpoint?: string): string {
  return String(endpoint || "").trim().toLowerCase();
}

function endpointCostMultiplier(endpoint?: string): number {
  const normalized = normalizeEndpoint(endpoint);
  if (normalized === "/api/chat" || normalized === "/api/chat-stream") {
    return Math.max(1, BILLING_ASSISTANT_CHAT_MULTIPLIER);
  }
  return 1;
}

export class BillingError extends Error {
  statusCode: number;
  code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.name = "BillingError";
  }
}

export function runWithBillingUsageSession<T>(fn: () => Promise<T>): Promise<T> {
  return usageStorage.run({ usages: [] }, fn);
}

export function recordModelUsage(input: UsageRecordInput): void {
  const store = usageStorage.getStore();
  if (!store) return;
  const model = normalizeModelName(input.model);
  if (!model) return;
  store.usages.push({
    provider: input.provider || inferProviderFromModel(model),
    model,
    inputTokens: sanitizeTokenCount(input.inputTokens),
    outputTokens: sanitizeTokenCount(input.outputTokens),
    endpoint: input.endpoint,
    estimated: Boolean(input.estimated),
  });
}

export function getBillingUsageSessionRecords(): UsageRecordInput[] {
  const store = usageStorage.getStore();
  if (!store) return [];
  return [...store.usages];
}

/**
 * Estimate token count from text.
 * Uses 3.7 chars/token — more accurate than 4.0 for mixed Portuguese/English
 * technical content (Brazilian environmental legislation, GIS terms).
 * Portuguese words average 5-6 chars but tokenize efficiently (~3.5-3.8 chars/token).
 */
export function estimateTokensFromText(text: string): number {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  // Count words and chars separately for a blended estimate
  const wordCount = normalized.split(/\s+/).length;
  const charCount = normalized.length;
  // Word-based estimate: ~1.35 tokens/word (Portuguese averages ~1.2-1.5)
  const wordEstimate = Math.ceil(wordCount * 1.35);
  // Char-based estimate: ~3.7 chars/token for mixed pt-BR/en technical text
  const charEstimate = Math.ceil(charCount / 3.7);
  // Blend: average of both to reduce bias
  return Math.max(1, Math.round((wordEstimate + charEstimate) / 2));
}

/**
 * Estimate tokens for a vision model image based on dimensions.
 * Gemini: tiles of 258 tokens each, min 258, max ~2072 (for large images).
 * Groq/LLaMA-Vision: approximately 1024-1600 tokens for 800x600 images.
 * Returns a conservative estimate that works for both.
 */
export function estimateImageTokens(widthPx: number, heightPx: number): number {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  // Gemini tile-based formula: ceil(w/768) * ceil(h/768) * 258, min 258
  const tilesW = Math.ceil(w / 768);
  const tilesH = Math.ceil(h / 768);
  const geminiTokens = tilesW * tilesH * 258;
  // Groq/LLaMA-Vision: roughly proportional to pixel count, ~0.0017 tokens/px for 800x600
  const groqTokens = Math.round((w * h) * 0.00175);
  // Use the higher of the two estimates (conservative for billing)
  return Math.max(258, Math.max(geminiTokens, groqTokens));
}

export function estimateTokensFromMessages(messages: Array<{ role: string; content: any }>): number {
  // Each message has ~4 tokens of overhead (role + separators in chat format)
  const MESSAGE_OVERHEAD = 4;
  let tokens = 0;
  for (const message of messages || []) {
    tokens += MESSAGE_OVERHEAD;
    const content = message?.content;
    if (typeof content === "string") {
      tokens += estimateTokensFromText(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === "string") tokens += estimateTokensFromText(part.text);
        if (typeof part?.input_text === "string") tokens += estimateTokensFromText(part.input_text);
        // Vision image parts: estimate based on standard analysis image size (1024x768)
        if (part?.type === "image_url" || part?.inline_data) {
          tokens += estimateImageTokens(1024, 768);
        }
      }
    }
  }
  return Math.max(1, tokens);
}

function sanitizeTokenCount(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed);
}

function normalizeModelName(model: string): string {
  return String(model || "")
    .trim()
    .toLowerCase()
    .replace(/^models\//i, "")
    .replace(/:generatecontent$/i, "");
}

function inferProviderFromModel(model: string): BillingProvider {
  const normalized = normalizeModelName(model);
  if (normalized.includes("cloudinary")) return "cloudinary";
  if (normalized.includes("gemini") || normalized.includes("banana")) return "gemini";
  return "groq";
}

function getPricingTier(model: string, promptTokens: number): PricingTier {
  const normalized = normalizeModelName(model);
  const pricing = MODEL_PRICING_USD[normalized];
  if (pricing) {
    if (promptTokens > 200_000 && pricing.over200kPrompt) return pricing.over200kPrompt;
    return pricing.base;
  }

  const provider = inferProviderFromModel(normalized);
  const fallback = provider === "gemini"
    ? { inputUsdPer1M: 2.5, outputUsdPer1M: 15.0 }
    : { inputUsdPer1M: 1.0, outputUsdPer1M: 3.0 };
  console.warn(`[BILLING] modelo sem preço explícito (${normalized}), usando fallback conservador (${provider})`);
  return fallback;
}

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function normalizeStorageBillingDays(days?: number): number {
  const parsed = Number(days);
  if (!Number.isFinite(parsed) || parsed <= 0) return CLOUDINARY_STORAGE_BILLING_DAYS;
  return Math.max(1, Math.min(365, Math.round(parsed)));
}

function computeCloudinaryStorageChargeBrl(args: {
  bytesStored: number;
  usdBrlRate: number;
  billingDays?: number;
}) {
  const bytesStored = Math.max(0, Math.round(Number(args.bytesStored) || 0));
  const billingDays = normalizeStorageBillingDays(args.billingDays);
  const monthsFactor = billingDays / 30;
  const gbStored = bytesStored / (1024 * 1024 * 1024);
  const usdCost = gbStored * CLOUDINARY_STORAGE_USD_PER_GB_MONTH * monthsFactor;
  const brlCostRaw = usdCost * args.usdBrlRate * BILLING_MARGIN;
  const chargedBrl = bytesStored > 0
    ? roundCurrency(Math.max(MIN_STORAGE_CHARGE_BRL, brlCostRaw))
    : 0;
  return {
    bytesStored,
    kbStored: bytesStored / 1024,
    gbStored,
    billingDays,
    chargedBrl,
    usdPerGbMonth: CLOUDINARY_STORAGE_USD_PER_GB_MONTH,
    brlPerGbMonth: CLOUDINARY_STORAGE_USD_PER_GB_MONTH * args.usdBrlRate * BILLING_MARGIN,
  };
}

function mergeUsageInputs(usageInputs: UsageRecordInput[], defaultEndpoint: string): UsageRecordInput[] {
  const merged = new Map<string, UsageRecordInput>();
  for (const raw of usageInputs || []) {
    const model = normalizeModelName(raw.model);
    if (!model) continue;
    const provider = raw.provider || inferProviderFromModel(model);
    const endpoint = String(raw.endpoint || defaultEndpoint || "");
    const key = `${provider}|${model}|${endpoint}`;
    const current = merged.get(key);
    const inputTokens = sanitizeTokenCount(raw.inputTokens);
    const outputTokens = sanitizeTokenCount(raw.outputTokens);
    const estimated = Boolean(raw.estimated);
    if (!current) {
      merged.set(key, {
        provider,
        model,
        endpoint,
        inputTokens,
        outputTokens,
        estimated,
      });
      continue;
    }
    merged.set(key, {
      provider,
      model,
      endpoint,
      inputTokens: sanitizeTokenCount(current.inputTokens) + inputTokens,
      outputTokens: sanitizeTokenCount(current.outputTokens) + outputTokens,
      estimated: Boolean(current.estimated) && estimated,
    });
  }
  return [...merged.values()].map((item) => {
    const inTokens = sanitizeTokenCount(item.inputTokens);
    const outTokens = sanitizeTokenCount(item.outputTokens);
    if (inTokens > 0 || outTokens > 0) return item;
    if (item.estimated) {
      return {
        ...item,
        inputTokens: 1,
        outputTokens: 1,
      };
    }
    return item;
  });
}

async function fetchUsdBrlRateFromBcb(): Promise<number> {
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const asBcbDate = (d: Date) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;

  const url =
    "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
    `CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?` +
    `@moeda='USD'&@dataInicial='${asBcbDate(yesterday)}'&@dataFinalCotacao='${asBcbDate(today)}'&$top=1&$orderby=dataHoraCotacao%20desc&$format=json`;

  const response = await fetch(url, { method: "GET" });
  if (!response.ok) throw new Error(`BCB HTTP ${response.status}`);
  const data = (await response.json()) as any;
  const cotacaoVenda = Number(data?.value?.[0]?.cotacaoVenda);
  if (!Number.isFinite(cotacaoVenda) || cotacaoVenda <= 0) {
    throw new Error("cotacaoVenda inválida no retorno do BCB");
  }
  return cotacaoVenda;
}

export async function getUsdBrlRate(): Promise<{ rate: number; source: string }> {
  const now = Date.now();
  if (rateCache && now - rateCache.fetchedAt < RATE_CACHE_MS) {
    return { rate: rateCache.value, source: rateCache.source };
  }

  try {
    const rate = await fetchUsdBrlRateFromBcb();
    rateCache = { value: rate, fetchedAt: now, source: "BCB_PTAX" };
    try {
      await adminDb.doc("system/billing_config/current").set(
        {
          usdBrlRate: rate,
          usdBrlSource: "BCB_PTAX",
          margin: BILLING_MARGIN,
          modelPricingUsd: MODEL_PRICING_USD,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    } catch (persistErr) {
      console.warn("[BILLING] não foi possível persistir câmbio no Firestore:", persistErr);
    }
    return { rate, source: "BCB_PTAX" };
  } catch (error) {
    console.warn("[BILLING] falha ao obter câmbio BCB, usando fallback:", error);
  }

  try {
    const configSnap = await adminDb.doc("system/billing_config/current").get();
    const storedRate = Number(configSnap.data()?.usdBrlRate);
    if (Number.isFinite(storedRate) && storedRate > 0) {
      rateCache = { value: storedRate, fetchedAt: now, source: "FIRESTORE_CACHE" };
      return { rate: storedRate, source: "FIRESTORE_CACHE" };
    }
  } catch (cacheErr) {
    console.warn("[BILLING] Firestore indisponível para cache de câmbio, usando ENV_FALLBACK:", cacheErr);
  }

  rateCache = { value: USD_BRL_FALLBACK, fetchedAt: now, source: "ENV_FALLBACK" };
  return { rate: USD_BRL_FALLBACK, source: "ENV_FALLBACK" };
}

export async function getBillingPricingSnapshot() {
  const { rate, source } = await getUsdBrlRate();
  const pricingBrl = Object.fromEntries(
    Object.entries(MODEL_PRICING_USD).map(([model, tiers]) => {
      const toBrl = (tier: PricingTier) => ({
        inputBrlPer1M: roundCurrency(tier.inputUsdPer1M * rate * BILLING_MARGIN),
        outputBrlPer1M: roundCurrency(tier.outputUsdPer1M * rate * BILLING_MARGIN),
      });
      return [
        model,
        {
          usd: tiers,
          brl: {
            base: toBrl(tiers.base),
            over200kPrompt: tiers.over200kPrompt ? toBrl(tiers.over200kPrompt) : undefined,
          },
        },
      ];
    }),
  );

  return {
    margin: BILLING_MARGIN,
    assistantChatMultiplier: Math.max(1, BILLING_ASSISTANT_CHAT_MULTIPLIER),
    minChargeBrl: MIN_CHARGE_BRL,
    usdBrlRate: rate,
    usdBrlSource: source,
    modelPricingUsd: MODEL_PRICING_USD,
    modelPricingBrl: pricingBrl,
    cloudinaryStorage: {
      usdPerGbMonth: CLOUDINARY_STORAGE_USD_PER_GB_MONTH,
      brlPerGbMonth: roundCurrency(CLOUDINARY_STORAGE_USD_PER_GB_MONTH * rate * BILLING_MARGIN),
      brlPerMbMonth: roundCurrency((CLOUDINARY_STORAGE_USD_PER_GB_MONTH * rate * BILLING_MARGIN) / 1024),
      brlPerKbMonth: roundCurrency((CLOUDINARY_STORAGE_USD_PER_GB_MONTH * rate * BILLING_MARGIN) / (1024 * 1024)),
      billingWindowDays: CLOUDINARY_STORAGE_BILLING_DAYS,
      minStorageChargeBrl: MIN_STORAGE_CHARGE_BRL,
      sourcePlan: {
        plusMonthlyUsd: CLOUDINARY_PLUS_MONTHLY_USD,
        plusMonthlyCredits: CLOUDINARY_PLUS_MONTHLY_CREDITS,
      },
    },
    updatedAtIso: new Date().toISOString(),
  };
}

function walletRef(uid: string) {
  return adminDb.doc(`users/${uid}/billing/wallet`);
}

function ledgerCollection(uid: string) {
  return adminDb.collection(`users/${uid}/billing_ledger`);
}

function usageDailyCollection(uid: string) {
  return adminDb.collection(`users/${uid}/usage_daily`);
}

function getDateId(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${String(now.getUTCDate()).padStart(2, "0")}`;
}

function getRecentDateIds(days: number, now = new Date()): string[] {
  const safeDays = Math.max(1, Math.floor(days || 1));
  const ids: string[] = [];
  for (let i = 0; i < safeDays; i++) {
    const dt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    ids.push(getDateId(dt));
  }
  return ids;
}

function safeModelKey(model: string): string {
  return normalizeModelName(model).replace(/[^a-z0-9_-]/g, "_");
}

async function ensureWallet(uid: string) {
  const ref = walletRef(uid);
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set(
      {
        balanceBrl: 0,
        totalTopupBrl: 0,
        totalSpentBrl: 0,
        version: 0,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }
}

export async function reserveCredits(args: {
  uid: string;
  amountBrl: number;
  requestId: string;
  endpoint: string;
}): Promise<{ reservedBrl: number; balanceAfterBrl: number }> {
  const amount = roundCurrency(Math.max(0, args.amountBrl));
  if (amount <= 0) {
    return { reservedBrl: 0, balanceAfterBrl: 0 };
  }

  await ensureWallet(args.uid);
  const ledgerRef = ledgerCollection(args.uid).doc(`reserve_${args.requestId}`);

  return adminDb.runTransaction(async (tx) => {
    const wallet = await tx.get(walletRef(args.uid));
    const currentBalance = Number(wallet.data()?.balanceBrl || 0);
    if (currentBalance < amount) {
      throw new BillingError(402, "INSUFFICIENT_CREDITS", "Saldo insuficiente para iniciar a chamada de IA.");
    }

    const balanceAfter = roundCurrency(currentBalance - amount);
    tx.set(
      walletRef(args.uid),
      {
        balanceBrl: balanceAfter,
        version: Number(wallet.data()?.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(
      ledgerRef,
      {
        type: "reserve_hold",
        amountBrl: -amount,
        balanceAfterBrl: balanceAfter,
        requestId: args.requestId,
        endpoint: args.endpoint,
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    return { reservedBrl: amount, balanceAfterBrl: balanceAfter };
  });
}

export async function refundReserve(args: {
  uid: string;
  requestId: string;
  amountBrl: number;
  endpoint: string;
  reason?: string;
}): Promise<{ balanceAfterBrl: number }> {
  const amount = roundCurrency(Math.max(0, args.amountBrl));
  await ensureWallet(args.uid);
  if (amount <= 0) {
    const snap = await walletRef(args.uid).get();
    return { balanceAfterBrl: Number(snap.data()?.balanceBrl || 0) };
  }

  const ledgerRef = ledgerCollection(args.uid).doc(`refund_${args.requestId}`);
  return adminDb.runTransaction(async (tx) => {
    const ledgerSnap = await tx.get(ledgerRef);
    const walletSnap = await tx.get(walletRef(args.uid));
    const currentBalance = Number(walletSnap.data()?.balanceBrl || 0);
    if (ledgerSnap.exists) {
      return { balanceAfterBrl: currentBalance };
    }

    const balanceAfter = roundCurrency(currentBalance + amount);
    tx.set(
      walletRef(args.uid),
      {
        balanceBrl: balanceAfter,
        version: Number(walletSnap.data()?.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(ledgerRef, {
      type: "refund",
      amountBrl: amount,
      balanceAfterBrl: balanceAfter,
      requestId: args.requestId,
      endpoint: args.endpoint,
      reason: args.reason || "request_failed",
      createdAt: FieldValue.serverTimestamp(),
    });

    return { balanceAfterBrl: balanceAfter };
  });
}

export async function settleReservedCredits(args: {
  uid: string;
  requestId: string;
  endpoint: string;
  reservedBrl: number;
  usageInputs: UsageRecordInput[];
}): Promise<{ chargedBrl: number; balanceAfterBrl: number; usage: SettledUsageRecord[] }> {
  const reserved = roundCurrency(Math.max(0, args.reservedBrl));
  await ensureWallet(args.uid);
  const { rate } = await getUsdBrlRate();
  const mergedInputs = mergeUsageInputs(args.usageInputs, args.endpoint);

  const normalizedUsage: SettledUsageRecord[] = mergedInputs
    .map((item) => {
      const model = normalizeModelName(item.model);
      if (!model) return null;
      const inputTokens = sanitizeTokenCount(item.inputTokens);
      const outputTokens = sanitizeTokenCount(item.outputTokens);
      const tier = getPricingTier(model, inputTokens);
      const endpoint = item.endpoint || args.endpoint;
      const costMultiplier = endpointCostMultiplier(endpoint);
      const cost =
        ((inputTokens / 1_000_000) * tier.inputUsdPer1M + (outputTokens / 1_000_000) * tier.outputUsdPer1M) *
        rate *
        BILLING_MARGIN *
        costMultiplier;
      return {
        provider: item.provider || inferProviderFromModel(model),
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costBrl: roundCurrency(Math.max(0, cost)),
        endpoint,
        estimated: Boolean(item.estimated),
      } as SettledUsageRecord;
    })
    .filter((item): item is SettledUsageRecord => Boolean(item));

  let charged = roundCurrency(normalizedUsage.reduce((acc, item) => acc + item.costBrl, 0));
  if (charged > 0 && charged < MIN_CHARGE_BRL) {
    charged = MIN_CHARGE_BRL;
  }

  const releaseAmount = roundCurrency(Math.max(0, reserved - charged));
  const extraDebit = roundCurrency(Math.max(0, charged - reserved));

  const result = await adminDb.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef(args.uid));
    const currentBalance = Number(walletSnap.data()?.balanceBrl || 0);
    if (extraDebit > 0 && currentBalance < extraDebit) {
      throw new BillingError(402, "INSUFFICIENT_CREDITS", "Saldo insuficiente para concluir a cobrança do uso de IA.");
    }

    const balanceAfter = roundCurrency(currentBalance + releaseAmount - extraDebit);

    tx.set(
      walletRef(args.uid),
      {
        balanceBrl: balanceAfter,
        totalSpentBrl: FieldValue.increment(charged),
        version: Number(walletSnap.data()?.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const summaryLedgerRef = ledgerCollection(args.uid).doc(`usage_${args.requestId}`);
    tx.set(summaryLedgerRef, {
      type: "usage_debit",
      amountBrl: -charged,
      balanceAfterBrl: balanceAfter,
      requestId: args.requestId,
      endpoint: args.endpoint,
      estimated: normalizedUsage.some((u) => u.estimated),
      usage: normalizedUsage,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (releaseAmount > 0) {
      const releaseRef = ledgerCollection(args.uid).doc(`release_${args.requestId}`);
      tx.set(releaseRef, {
        type: "reserve_release",
        amountBrl: releaseAmount,
        balanceAfterBrl: balanceAfter,
        requestId: args.requestId,
        endpoint: args.endpoint,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const dateId = getDateId();
    const usageRef = usageDailyCollection(args.uid).doc(dateId);
    const usageUpdate: Record<string, any> = {
      date: dateId,
      updatedAt: FieldValue.serverTimestamp(),
      totalCostBrl: FieldValue.increment(charged),
      totalInputTokens: FieldValue.increment(normalizedUsage.reduce((acc, item) => acc + item.inputTokens, 0)),
      totalOutputTokens: FieldValue.increment(normalizedUsage.reduce((acc, item) => acc + item.outputTokens, 0)),
      totalRequests: FieldValue.increment(1),
    };

    for (const item of normalizedUsage) {
      const key = safeModelKey(item.model);
      usageUpdate[`models.${key}.model`] = item.model;
      usageUpdate[`models.${key}.provider`] = item.provider;
      usageUpdate[`models.${key}.inputTokens`] = FieldValue.increment(item.inputTokens);
      usageUpdate[`models.${key}.outputTokens`] = FieldValue.increment(item.outputTokens);
      usageUpdate[`models.${key}.costBrl`] = FieldValue.increment(item.costBrl);
      usageUpdate[`models.${key}.requests`] = FieldValue.increment(1);
    }

    tx.set(usageRef, usageUpdate, { merge: true });

    return { balanceAfterBrl: balanceAfter };
  });

  return {
    chargedBrl: charged,
    balanceAfterBrl: result.balanceAfterBrl,
    usage: normalizedUsage,
  };
}

export async function estimateCloudinaryStorageReserve(args: {
  bytesStored: number;
  billingDays?: number;
  safetyMultiplier?: number;
}): Promise<number> {
  const bytesStored = Math.max(0, Math.round(Number(args.bytesStored) || 0));
  if (bytesStored <= 0) return 0;
  const { rate } = await getUsdBrlRate();
  const base = computeCloudinaryStorageChargeBrl({
    bytesStored,
    usdBrlRate: rate,
    billingDays: args.billingDays,
  }).chargedBrl;
  const safety = Number.isFinite(args.safetyMultiplier as number)
    ? Math.max(1, Number(args.safetyMultiplier))
    : 1.1;
  return roundCurrency(Math.max(MIN_STORAGE_CHARGE_BRL, base * safety));
}

export async function settleCloudinaryStorageReserve(args: {
  uid: string;
  requestId: string;
  endpoint: string;
  reservedBrl: number;
  bytesStored: number;
  assetKind?: string;
  billingDays?: number;
}): Promise<{ chargedBrl: number; balanceAfterBrl: number; usage: SettledUsageRecord[] }> {
  const reserved = roundCurrency(Math.max(0, Number(args.reservedBrl) || 0));
  const bytesStored = Math.max(0, Math.round(Number(args.bytesStored) || 0));
  await ensureWallet(args.uid);
  const { rate } = await getUsdBrlRate();
  const computed = computeCloudinaryStorageChargeBrl({
    bytesStored,
    usdBrlRate: rate,
    billingDays: args.billingDays,
  });
  const charged = computed.chargedBrl;
  const releaseAmount = roundCurrency(Math.max(0, reserved - charged));
  const extraDebit = roundCurrency(Math.max(0, charged - reserved));
  const model = "cloudinary/storage";
  const usageRecord: SettledUsageRecord = {
    provider: "cloudinary",
    model,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    costBrl: charged,
    endpoint: args.endpoint,
    estimated: false,
  };

  const result = await adminDb.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef(args.uid));
    const currentBalance = Number(walletSnap.data()?.balanceBrl || 0);
    if (extraDebit > 0 && currentBalance < extraDebit) {
      throw new BillingError(402, "INSUFFICIENT_CREDITS", "Saldo insuficiente para concluir a cobrança de armazenamento.");
    }
    const balanceAfter = roundCurrency(currentBalance + releaseAmount - extraDebit);

    tx.set(
      walletRef(args.uid),
      {
        balanceBrl: balanceAfter,
        totalSpentBrl: FieldValue.increment(charged),
        version: Number(walletSnap.data()?.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const summaryLedgerRef = ledgerCollection(args.uid).doc(`storage_${args.requestId}`);
    tx.set(summaryLedgerRef, {
      type: "usage_debit",
      amountBrl: -charged,
      balanceAfterBrl: balanceAfter,
      requestId: args.requestId,
      endpoint: args.endpoint,
      provider: "cloudinary",
      model,
      assetKind: String(args.assetKind || "asset"),
      bytesStored,
      kbStored: roundCurrency(bytesStored / 1024),
      gbStored: roundCurrency(bytesStored / (1024 * 1024 * 1024)),
      billingDays: computed.billingDays,
      usdPerGbMonth: computed.usdPerGbMonth,
      brlPerGbMonth: roundCurrency(computed.brlPerGbMonth),
      estimated: false,
      usage: [usageRecord],
      createdAt: FieldValue.serverTimestamp(),
    });

    if (releaseAmount > 0) {
      const releaseRef = ledgerCollection(args.uid).doc(`release_storage_${args.requestId}`);
      tx.set(releaseRef, {
        type: "reserve_release",
        amountBrl: releaseAmount,
        balanceAfterBrl: balanceAfter,
        requestId: args.requestId,
        endpoint: args.endpoint,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const dateId = getDateId();
    const usageRef = usageDailyCollection(args.uid).doc(dateId);
    const key = safeModelKey(model);
    const usageUpdate: Record<string, any> = {
      date: dateId,
      updatedAt: FieldValue.serverTimestamp(),
      totalCostBrl: FieldValue.increment(charged),
      totalRequests: FieldValue.increment(1),
      [`models.${key}.model`]: model,
      [`models.${key}.provider`]: "cloudinary",
      [`models.${key}.inputTokens`]: FieldValue.increment(0),
      [`models.${key}.outputTokens`]: FieldValue.increment(0),
      [`models.${key}.costBrl`]: FieldValue.increment(charged),
      [`models.${key}.requests`]: FieldValue.increment(1),
      [`models.${key}.storageBytes`]: FieldValue.increment(bytesStored),
      [`models.${key}.storageKb`]: FieldValue.increment(bytesStored / 1024),
    };
    tx.set(usageRef, usageUpdate, { merge: true });

    return { balanceAfterBrl: balanceAfter };
  });

  return {
    chargedBrl: charged,
    balanceAfterBrl: result.balanceAfterBrl,
    usage: [usageRecord],
  };
}

export async function createManualTopup(args: {
  uid: string;
  amountBrl: number;
  idempotencyKey: string;
}): Promise<{ balanceAfterBrl: number; amountBrl: number; ledgerId: string }> {
  const amount = roundCurrency(Number(args.amountBrl));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BillingError(400, "INVALID_TOPUP_AMOUNT", "amountBrl deve ser maior que zero.");
  }

  const sanitizedKey = String(args.idempotencyKey || "").trim().replace(/[^a-zA-Z0-9_-]/g, "");
  if (!sanitizedKey) {
    throw new BillingError(400, "INVALID_IDEMPOTENCY_KEY", "idempotencyKey inválido.");
  }

  await ensureWallet(args.uid);

  const ledgerId = `topup_${sanitizedKey}`;
  const ledgerRef = ledgerCollection(args.uid).doc(ledgerId);

  return adminDb.runTransaction(async (tx) => {
    const existing = await tx.get(ledgerRef);
    const walletSnap = await tx.get(walletRef(args.uid));
    const currentBalance = Number(walletSnap.data()?.balanceBrl || 0);

    if (existing.exists) {
      return {
        balanceAfterBrl: currentBalance,
        amountBrl: Number(existing.data()?.amountBrl || amount),
        ledgerId,
      };
    }

    const balanceAfter = roundCurrency(currentBalance + amount);

    tx.set(
      walletRef(args.uid),
      {
        balanceBrl: balanceAfter,
        totalTopupBrl: FieldValue.increment(amount),
        version: Number(walletSnap.data()?.version || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(ledgerRef, {
      type: "topup_manual",
      amountBrl: amount,
      balanceAfterBrl: balanceAfter,
      requestId: sanitizedKey,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { balanceAfterBrl: balanceAfter, amountBrl: amount, ledgerId };
  });
}

export async function getBillingMe(uid: string) {
  await ensureWallet(uid);
  const walletSnap = await walletRef(uid).get();
  const wallet = walletSnap.data() || {};

  const todayId = getDateId();
  const todayUsageSnap = await usageDailyCollection(uid).doc(todayId).get();
  const todayUsage = todayUsageSnap.data() || {};

  // Avoid Firestore index requirements on orderBy(__name__) by reading
  // deterministic daily docs directly (YYYY-MM-DD) for the last 7 UTC days.
  const recentDateIds = getRecentDateIds(7);
  const recentUsageDocs = await Promise.all(
    recentDateIds.map(async (dateId) => {
      const snap = await usageDailyCollection(uid).doc(dateId).get();
      return snap.exists ? snap.data() || {} : null;
    }),
  );
  const modelAggregate = new Map<string, { provider: string; inputTokens: number; outputTokens: number; costBrl: number; requests: number }>();
  const addAggregate = (entry: {
    model?: string;
    provider?: string;
    inputTokens?: number;
    outputTokens?: number;
    costBrl?: number;
    requests?: number;
  }) => {
    const model = normalizeModelName(String(entry.model || ""));
    if (!model) return;
    const current = modelAggregate.get(model) || {
      provider: String(entry?.provider || inferProviderFromModel(model)),
      inputTokens: 0,
      outputTokens: 0,
      costBrl: 0,
      requests: 0,
    };
    current.inputTokens += Number(entry?.inputTokens || 0);
    current.outputTokens += Number(entry?.outputTokens || 0);
    current.costBrl += Number(entry?.costBrl || 0);
    current.requests += Number(entry?.requests || 0);
    modelAggregate.set(model, current);
  };

  for (const usageData of recentUsageDocs) {
    if (!usageData) continue;
    const models = (usageData as any)?.models || {};
    for (const value of Object.values(models) as any[]) {
      addAggregate({
        model: value?.model,
        provider: value?.provider,
        inputTokens: value?.inputTokens,
        outputTokens: value?.outputTokens,
        costBrl: value?.costBrl,
        requests: value?.requests,
      });
    }
  }

  // Fallback: if daily aggregation is empty/incomplete, rebuild from ledger usage entries.
  if (modelAggregate.size === 0) {
    try {
      const ledgerSnap = await ledgerCollection(uid)
        .orderBy("createdAt", "desc")
        .limit(200)
        .get();
      for (const doc of ledgerSnap.docs) {
        const data = doc.data() as any;
        const usages = Array.isArray(data?.usage) ? data.usage : [];
        for (const usage of usages) {
          addAggregate({
            model: usage?.model || data?.model,
            provider: usage?.provider || data?.provider,
            inputTokens: usage?.inputTokens,
            outputTokens: usage?.outputTokens,
            costBrl: usage?.costBrl,
            requests: 1,
          });
        }
      }
    } catch (ledgerErr) {
      console.warn("[BILLING] fallback modelSnapshot via ledger falhou:", ledgerErr);
    }
  }

  return {
    wallet: {
      balanceBrl: Number(wallet.balanceBrl || 0),
      totalTopupBrl: Number(wallet.totalTopupBrl || 0),
      totalSpentBrl: Number(wallet.totalSpentBrl || 0),
      updatedAt: wallet.updatedAt || null,
      version: Number(wallet.version || 0),
    },
    usageToday: {
      date: todayId,
      totalCostBrl: Number(todayUsage.totalCostBrl || 0),
      totalInputTokens: Number(todayUsage.totalInputTokens || 0),
      totalOutputTokens: Number(todayUsage.totalOutputTokens || 0),
      totalRequests: Number(todayUsage.totalRequests || 0),
      models: todayUsage.models || {},
    },
    modelSnapshot: [...modelAggregate.entries()]
      .map(([model, agg]) => ({ model, ...agg }))
      .sort((a, b) => b.costBrl - a.costBrl),
  };
}

export async function getBillingLedger(uid: string, limit = 50) {
  const safeLimit = Math.min(200, Math.max(1, Math.floor(limit || 50)));
  const snap = await ledgerCollection(uid)
    .orderBy("createdAt", "desc")
    .limit(safeLimit)
    .get();

  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

export async function estimateReserveForModels(args: {
  models: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  safetyMultiplier?: number;
  endpoint?: string;
  /** Number of vision images included (adds estimated image tokens to input) */
  imageCount?: number;
  /** Image dimensions for per-image token estimation (default 1024x768) */
  imageWidthPx?: number;
  imageHeightPx?: number;
}): Promise<number> {
  const { rate } = await getUsdBrlRate();
  const safeModels = args.models.map((model) => normalizeModelName(model)).filter(Boolean);
  if (safeModels.length === 0) return MIN_CHARGE_BRL;

  // Add image token overhead to input estimate when vision images are provided
  let imageTokens = 0;
  const imgCount = Math.max(0, Math.floor(args.imageCount || 0));
  if (imgCount > 0) {
    const imgW = Math.max(256, args.imageWidthPx || 1024);
    const imgH = Math.max(256, args.imageHeightPx || 768);
    imageTokens = imgCount * estimateImageTokens(imgW, imgH);
  }

  const estimateInput = Math.max(1, sanitizeTokenCount(args.estimatedInputTokens) + imageTokens);
  const estimateOutput = Math.max(1, sanitizeTokenCount(args.estimatedOutputTokens));

  let maxCost = 0;
  const endpointMultiplier = endpointCostMultiplier(args.endpoint);
  for (const model of safeModels) {
    const tier = getPricingTier(model, estimateInput);
    const cost =
      ((estimateInput / 1_000_000) * tier.inputUsdPer1M + (estimateOutput / 1_000_000) * tier.outputUsdPer1M) *
      rate *
      BILLING_MARGIN *
      endpointMultiplier;
    if (cost > maxCost) maxCost = cost;
  }

  const safety = Number.isFinite(args.safetyMultiplier) ? Math.max(1, Number(args.safetyMultiplier)) : 1.25;
  const estimated = roundCurrency(Math.max(MIN_CHARGE_BRL, maxCost * safety));
  return Math.min(estimated, MAX_RESERVE_BRL);
}

export function buildUsageFromGroq(model: string, usage: any, endpoint: string): UsageRecordInput {
  const prompt = sanitizeTokenCount(usage?.prompt_tokens);
  const completion = sanitizeTokenCount(usage?.completion_tokens);
  const hasUsage = prompt > 0 || completion > 0;
  return {
    provider: "groq",
    model,
    inputTokens: prompt,
    outputTokens: completion,
    endpoint,
    estimated: !hasUsage,
  };
}

export function buildUsageFromGemini(model: string, usageMetadata: any, endpoint: string): UsageRecordInput {
  const prompt = sanitizeTokenCount(usageMetadata?.promptTokenCount);
  const completion = sanitizeTokenCount(usageMetadata?.candidatesTokenCount);
  const hasUsage = prompt > 0 || completion > 0;
  return {
    provider: "gemini",
    model,
    inputTokens: prompt,
    outputTokens: completion,
    endpoint,
    estimated: !hasUsage,
  };
}

export function createRequestId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
