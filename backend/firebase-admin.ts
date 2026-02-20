import { App, applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

function resolveCredential() {
  const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccountJson) {
    try {
      const parsed = JSON.parse(serviceAccountJson);
      return cert(parsed);
    } catch (error) {
      console.warn("[FIREBASE ADMIN] FIREBASE_SERVICE_ACCOUNT_JSON inválido, tentando applicationDefault.", error);
    }
  }
  return applicationDefault();
}

function getOrInitAdminApp(): App {
  if (getApps().length > 0) return getApps()[0]!;
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
  return initializeApp({
    credential: resolveCredential(),
    ...(projectId ? { projectId } : {}),
  });
}

export const adminApp = getOrInitAdminApp();
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
