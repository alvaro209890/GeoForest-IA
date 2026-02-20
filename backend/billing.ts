import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { FieldPath, FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "./firebase-admin";

export type BillingProvider = "groq" | "gemini";

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

const BILLING_MARGIN = Number.parseFloat(process.env.BILLING_MARGIN || "1.40") || 1.4;
const MIN_CHARGE_BRL = Number.parseFloat(process.env.BILLING_MIN_CHARGE_BRL || "0.01") || 0.01;
const USD_BRL_FALLBACK = Number.parseFloat(process.env.USD_BRL_FALLBACK || "5.2257") || 5.2257;
const RATE_CACHE_MS = 8 * 60 * 60 * 1000;

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

export function estimateTokensFromText(text: string): number {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  return Math.max(1, Math.ceil(normalized.length / 4));
}

export function estimateTokensFromMessages(messages: Array<{ role: string; content: any }>): number {
  let chars = 0;
  for (const message of messages || []) {
    const content = message?.content;
    if (typeof content === "string") {
      chars += content.length;
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === "string") chars += part.text.length;
        if (typeof part?.input_text === "string") chars += part.input_text.length;
      }
    }
  }
  return Math.max(1, Math.ceil(chars / 4));
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
    return { rate, source: "BCB_PTAX" };
  } catch (error) {
    console.warn("[BILLING] falha ao obter câmbio BCB, usando fallback:", error);
  }

  const configSnap = await adminDb.doc("system/billing_config/current").get();
  const storedRate = Number(configSnap.data()?.usdBrlRate);
  if (Number.isFinite(storedRate) && storedRate > 0) {
    rateCache = { value: storedRate, fetchedAt: now, source: "FIRESTORE_CACHE" };
    return { rate: storedRate, source: "FIRESTORE_CACHE" };
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
    minChargeBrl: MIN_CHARGE_BRL,
    usdBrlRate: rate,
    usdBrlSource: source,
    modelPricingUsd: MODEL_PRICING_USD,
    modelPricingBrl: pricingBrl,
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

  const normalizedUsage: SettledUsageRecord[] = args.usageInputs
    .map((item) => {
      const model = normalizeModelName(item.model);
      if (!model) return null;
      const inputTokens = sanitizeTokenCount(item.inputTokens);
      const outputTokens = sanitizeTokenCount(item.outputTokens);
      const tier = getPricingTier(model, inputTokens);
      const cost = ((inputTokens / 1_000_000) * tier.inputUsdPer1M + (outputTokens / 1_000_000) * tier.outputUsdPer1M) * rate * BILLING_MARGIN;
      return {
        provider: item.provider || inferProviderFromModel(model),
        model,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        costBrl: roundCurrency(Math.max(0, cost)),
        endpoint: item.endpoint || args.endpoint,
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

  const recentUsageSnap = await usageDailyCollection(uid)
    .orderBy(FieldPath.documentId(), "desc")
    .limit(7)
    .get();
  const modelAggregate = new Map<string, { provider: string; inputTokens: number; outputTokens: number; costBrl: number; requests: number }>();

  for (const doc of recentUsageSnap.docs) {
    const models = doc.data()?.models || {};
    for (const value of Object.values(models) as any[]) {
      const model = String(value?.model || "");
      if (!model) continue;
      const current = modelAggregate.get(model) || {
        provider: String(value?.provider || inferProviderFromModel(model)),
        inputTokens: 0,
        outputTokens: 0,
        costBrl: 0,
        requests: 0,
      };
      current.inputTokens += Number(value?.inputTokens || 0);
      current.outputTokens += Number(value?.outputTokens || 0);
      current.costBrl += Number(value?.costBrl || 0);
      current.requests += Number(value?.requests || 0);
      modelAggregate.set(model, current);
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
}): Promise<number> {
  const { rate } = await getUsdBrlRate();
  const safeModels = args.models.map((model) => normalizeModelName(model)).filter(Boolean);
  if (safeModels.length === 0) return MIN_CHARGE_BRL;

  const estimateInput = Math.max(1, sanitizeTokenCount(args.estimatedInputTokens));
  const estimateOutput = Math.max(1, sanitizeTokenCount(args.estimatedOutputTokens));

  let maxCost = 0;
  for (const model of safeModels) {
    const tier = getPricingTier(model, estimateInput);
    const cost = ((estimateInput / 1_000_000) * tier.inputUsdPer1M + (estimateOutput / 1_000_000) * tier.outputUsdPer1M) * rate * BILLING_MARGIN;
    if (cost > maxCost) maxCost = cost;
  }

  const safety = Number.isFinite(args.safetyMultiplier) ? Math.max(1, Number(args.safetyMultiplier)) : 1.25;
  return roundCurrency(Math.max(MIN_CHARGE_BRL, maxCost * safety));
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
