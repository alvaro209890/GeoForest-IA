import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function parseJsonSafe(raw: string | undefined): any | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function resolveProjectId(): string {
  const envProjectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "";
  if (envProjectId.trim()) return envProjectId.trim();

  const serviceAccount = parseJsonSafe(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  const serviceProjectId = String(serviceAccount?.project_id || "").trim();
  if (serviceProjectId) return serviceProjectId;

  const firebaseConfig = parseJsonSafe(process.env.FIREBASE_CONFIG);
  const firebaseConfigProjectId = String(firebaseConfig?.projectId || "").trim();
  if (firebaseConfigProjectId) return firebaseConfigProjectId;

  // Explicit fallback to avoid project-id autodetection failures on Render.
  return "ia-florestal";
}

function resolveCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      return cert(parsed);
    } catch (error) {
      console.warn("[FIREBASE ADMIN] Invalid FIREBASE_SERVICE_ACCOUNT_JSON, trying applicationDefault.", error);
    }
  }
  return applicationDefault();
}

function getOrInitAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!;
  const projectId = resolveProjectId();
  if (!projectId) {
    throw new Error("[FIREBASE ADMIN] projectId not resolved.");
  }
  return initializeApp({
    credential: resolveCredential(),
    projectId,
  });
}

export const adminApp = getOrInitAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
