import crypto from "node:crypto";

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

type WalletSnapshot = {
  wallet: {
    balanceBrl: number;
    totalTopupBrl: number;
    totalSpentBrl: number;
    updatedAt: string | null;
    version: number;
  };
  usageToday: {
    date: string;
    totalCostBrl: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    models: Record<string, unknown>;
  };
  modelSnapshot: Array<{
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    costBrl: number;
    requests: number;
  }>;
};

const usageStore: UsageRecordInput[] = [];

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

export function runWithBillingUsageSession<T>(fn: () => Promise<T>): Promise<T> {
  return fn();
}

export function recordModelUsage(input: UsageRecordInput): void {
  usageStore.push(input);
}

export function getBillingUsageSessionRecords(): UsageRecordInput[] {
  return [...usageStore];
}

export function estimateTokensFromText(text: string): number {
  const normalized = String(text || "").trim();
  if (!normalized) return 0;
  const words = normalized.split(/\s+/).length;
  return Math.max(1, Math.round((normalized.length / 3.7 + words * 1.35) / 2));
}

export function estimateImageTokens(widthPx: number, heightPx: number): number {
  const w = Math.max(1, widthPx);
  const h = Math.max(1, heightPx);
  return Math.max(258, Math.round((w * h) * 0.00175));
}

export function estimateTokensFromMessages(messages: Array<{ role: string; content: any }>): number {
  let tokens = 0;
  for (const message of messages || []) {
    tokens += 4;
    const content = message?.content;
    if (typeof content === "string") {
      tokens += estimateTokensFromText(content);
      continue;
    }
    if (Array.isArray(content)) {
      for (const part of content) {
        if (typeof part?.text === "string") tokens += estimateTokensFromText(part.text);
        if (typeof part?.input_text === "string") tokens += estimateTokensFromText(part.input_text);
        if (part?.type === "image_url" || part?.inline_data) {
          tokens += estimateImageTokens(1024, 768);
        }
      }
    }
  }
  return Math.max(1, tokens);
}

export async function getUsdBrlRate(): Promise<{ rate: number; source: string }> {
  return { rate: 1, source: "billing_disabled" };
}

export async function getBillingPricingSnapshot() {
  return {
    enabled: false,
    usdBrlRate: 1,
    usdBrlSource: "billing_disabled",
    margin: 0,
    minChargeBrl: 0,
  };
}

export async function reserveCredits(_args: {
  uid: string;
  amountBrl: number;
  requestId: string;
  endpoint: string;
}) {
  return { reservedBrl: 0 };
}

export async function refundReserve(_args: {
  uid: string;
  requestId: string;
  amountBrl: number;
  endpoint: string;
  reason?: string;
}) {
  return { balanceAfterBrl: 0 };
}

function settleUsage(usageInputs: UsageRecordInput[], endpoint: string) {
  return (usageInputs || []).map((item) => {
    const provider = item.provider || inferProviderFromModel(item.model);
    const inputTokens = Math.max(0, Math.round(Number(item.inputTokens || 0)));
    const outputTokens = Math.max(0, Math.round(Number(item.outputTokens || 0)));
    return {
      provider,
      model: normalizeModelName(item.model),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      costBrl: 0,
      endpoint,
      estimated: Boolean(item.estimated),
    } satisfies SettledUsageRecord;
  });
}

export async function settleReservedCredits(args: {
  uid: string;
  requestId: string;
  endpoint: string;
  reservedBrl: number;
  usageInputs: UsageRecordInput[];
}) {
  return {
    chargedBrl: 0,
    balanceAfterBrl: 0,
    usage: settleUsage(args.usageInputs, args.endpoint),
  };
}

export async function applyCancelFloorDebit(_args: {
  uid: string;
  requestId: string;
  endpoint: string;
  chargedBrl: number;
}) {
  return { finalChargedBrl: 0, floorDeltaBrl: 0, balanceAfterBrl: 0 };
}

export async function estimateCloudinaryStorageReserve(_args: {
  bytesStored: number;
  safetyMultiplier?: number;
}) {
  return 0;
}

export async function settleCloudinaryStorageReserve(args: {
  uid: string;
  requestId: string;
  endpoint: string;
  reservedBrl: number;
  bytesStored: number;
  assetKind?: string;
}) {
  return {
    chargedBrl: 0,
    balanceAfterBrl: 0,
    usage: settleUsage(
      [
        {
          provider: "cloudinary",
          model: args.assetKind || "local-storage",
          inputTokens: 0,
          outputTokens: 0,
          endpoint: args.endpoint,
          estimated: false,
        },
      ],
      args.endpoint,
    ),
  };
}

export async function chargeMapSnapshot(_args: {
  uid: string;
  requestId: string;
  endpoint: string;
  feeBrl: number;
}) {
  return { chargedBrl: 0, balanceAfterBrl: 0 };
}

export async function createManualTopup(args: {
  uid: string;
  amountBrl: number;
  idempotencyKey?: string;
}) {
  return {
    uid: args.uid,
    amountBrl: Number(args.amountBrl || 0),
    balanceAfterBrl: 0,
    createdAt: new Date().toISOString(),
    idempotencyKey: args.idempotencyKey || null,
  };
}

export async function getBillingMe(_uid: string): Promise<WalletSnapshot> {
  return {
    wallet: {
      balanceBrl: 0,
      totalTopupBrl: 0,
      totalSpentBrl: 0,
      updatedAt: null,
      version: 0,
    },
    usageToday: {
      date: new Date().toISOString().slice(0, 10),
      totalCostBrl: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      models: {},
    },
    modelSnapshot: [],
  };
}

export async function getBillingLedger(_uid: string, _limit = 50) {
  return [];
}

export async function estimateReserveForModels(_args: {
  models: string[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  safetyMultiplier?: number;
  endpoint?: string;
  imageCount?: number;
  imageWidthPx?: number;
  imageHeightPx?: number;
}) {
  return 0;
}

export function buildUsageFromGroq(model: string, usage: any, endpoint: string): UsageRecordInput {
  return {
    provider: "groq",
    model,
    inputTokens: Number(usage?.prompt_tokens || 0),
    outputTokens: Number(usage?.completion_tokens || 0),
    endpoint,
    estimated: !usage,
  };
}

export function buildUsageFromGemini(model: string, usageMetadata: any, endpoint: string): UsageRecordInput {
  return {
    provider: "gemini",
    model,
    inputTokens: Number(usageMetadata?.promptTokenCount || 0),
    outputTokens: Number(usageMetadata?.candidatesTokenCount || 0),
    endpoint,
    estimated: !usageMetadata,
  };
}

export function createRequestId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}
