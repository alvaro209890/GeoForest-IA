import fs from "node:fs";
import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

type ServiceAccountLike = {
  project_id?: string;
  client_email?: string;
  private_key?: string;
  [key: string]: unknown;
};

function parseJsonSafe(raw: string | undefined): ServiceAccountLike | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as ServiceAccountLike;
  } catch {
    return null;
  }
}

function parseBase64JsonSafe(raw: string | undefined): ServiceAccountLike | null {
  if (!raw) return null;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8");
    return parseJsonSafe(decoded);
  } catch {
    return null;
  }
}

function getServiceAccountFromEnv(): ServiceAccountLike | null {
  const fromJson = parseJsonSafe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (fromJson) return fromJson;

  const fromBase64 = parseBase64JsonSafe(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64);
  if (fromBase64) return fromBase64;

  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "";
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || "";
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY || "";
  const privateKey = privateKeyRaw.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return {
      project_id: projectId,
      client_email: clientEmail,
      private_key: privateKey,
    };
  }

  return null;
}

function resolveProjectId(serviceAccount: ServiceAccountLike | null): string {
  const envProjectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "";
  if (envProjectId.trim()) return envProjectId.trim();

  const serviceProjectId = String(serviceAccount?.project_id || "").trim();
  if (serviceProjectId) return serviceProjectId;

  const firebaseConfig = parseJsonSafe(process.env.FIREBASE_CONFIG);
  const firebaseConfigProjectId = String(firebaseConfig?.project_id || firebaseConfig?.projectId || "").trim();
  if (firebaseConfigProjectId) return firebaseConfigProjectId;

  return "";
}

function hasGoogleApplicationCredentialsFile(): boolean {
  const p = String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!p) return false;
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function resolveCredential() {
  const serviceAccount = getServiceAccountFromEnv();
  if (serviceAccount) {
    try {
      return cert(serviceAccount as any);
    } catch (error) {
      console.error("[FIREBASE ADMIN] Invalid service account from env.", error);
    }
  }

  if (hasGoogleApplicationCredentialsFile()) {
    return applicationDefault();
  }

  console.warn(
    "[FIREBASE ADMIN] Missing explicit credentials; falling back to applicationDefault(). " +
      "Configure FIREBASE_SERVICE_ACCOUNT_JSON (or BASE64 / CLIENT_EMAIL+PRIVATE_KEY) on Render.",
  );
  return applicationDefault();
}

export function isFirebaseConfigError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "");
  return (
    /FIREBASE_ADMIN_CREDENTIALS_MISSING/i.test(message) ||
    /Could not load the default credentials/i.test(message) ||
    /Unable to detect a Project Id/i.test(message) ||
    /projectId.*resolved/i.test(message)
  );
}

function getOrInitAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!;

  const serviceAccount = getServiceAccountFromEnv();
  const projectId = resolveProjectId(serviceAccount) || "ia-florestal";

  return initializeApp({
    credential: resolveCredential(),
    projectId,
  });
}

export const adminApp = getOrInitAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
