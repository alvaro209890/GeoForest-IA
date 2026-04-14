import { auth } from "./firebase";

type DocRef = { kind: "doc"; path: string };
type CollectionRef = { kind: "collection"; path: string };
type QueryRef = {
  kind: "query";
  path: string;
  orderBy?: string;
  direction?: "asc" | "desc";
};

type Snapshot<T> = {
  id: string;
  exists: () => boolean;
  data: () => T;
};

async function authHeaders() {
  const headers = new Headers();
  const token = await auth.currentUser?.getIdToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

function apiUrl(path: string) {
  const base = String(import.meta.env.VITE_API_BASE || "").trim().replace(/\/+$/, "");
  return base ? `${base}${path}` : path;
}

function buildPath(parts: string[]) {
  return parts.filter(Boolean).join("/");
}

export function serverTimestamp() {
  return { __serverTimestamp: true };
}

export function collection(_db: unknown, ...segments: string[]): CollectionRef {
  return { kind: "collection", path: buildPath(segments) };
}

export function doc(arg0: unknown, ...segments: string[]): DocRef {
  if ((arg0 as CollectionRef)?.kind === "collection") {
    return {
      kind: "doc",
      path: buildPath([String((arg0 as CollectionRef).path || ""), ...segments]),
    };
  }
  return { kind: "doc", path: buildPath(segments) };
}

export function orderBy(field: string, direction: "asc" | "desc" = "asc") {
  return { type: "orderBy" as const, field, direction };
}

export function query(ref: CollectionRef, ...clauses: Array<{ type: "orderBy"; field: string; direction: "asc" | "desc" }>): QueryRef {
  const ordered = clauses.find((item) => item.type === "orderBy");
  return {
    kind: "query",
    path: ref.path,
    orderBy: ordered?.field,
    direction: ordered?.direction,
  };
}

function toSnapshot<T>(id: string, raw: T | null | undefined): Snapshot<T> {
  return {
    id,
    exists: () => raw !== null && raw !== undefined,
    data: () => (raw as T),
  };
}

export async function getDoc<T>(ref: DocRef): Promise<Snapshot<T>> {
  const res = await fetch(
    apiUrl(`/api/store/doc?path=${encodeURIComponent(ref.path)}`),
    { headers: await authHeaders() },
  );
  const payload = await res.json();
  return toSnapshot<T>(payload?.id || ref.path.split("/").pop() || "", payload?.data || null);
}

export async function setDoc(ref: DocRef, data: any, options?: { merge?: boolean }) {
  await fetch(apiUrl(`/api/store/doc?path=${encodeURIComponent(ref.path)}`), {
    method: "PUT",
    headers: await authHeaders(),
    body: JSON.stringify({
      data,
      merge: Boolean(options?.merge),
    }),
  });
}

export async function deleteDoc(ref: DocRef) {
  await fetch(apiUrl(`/api/store/doc?path=${encodeURIComponent(ref.path)}`), {
    method: "DELETE",
    headers: await authHeaders(),
  });
}

export async function getDocs<T>(ref: CollectionRef | QueryRef) {
  const res = await fetch(
    apiUrl(
      `/api/store/collection?path=${encodeURIComponent(ref.path)}&orderBy=${encodeURIComponent(
        (ref as QueryRef).orderBy || "updatedAtMs",
      )}&direction=${encodeURIComponent((ref as QueryRef).direction || "desc")}`,
    ),
    { headers: await authHeaders() },
  );
  const payload = await res.json();
  const docs = Array.isArray(payload?.docs)
    ? payload.docs.map((item: any) => toSnapshot<T>(String(item.id || ""), item.data as T))
    : [];
  return {
    docs,
    forEach(cb: (snap: Snapshot<T>) => void) {
      docs.forEach(cb);
    },
  };
}
