/**
 * Regressão: DELETE /api/simcar/clip/:jobId apagava arquivos a partir de URLs
 * enviadas no corpo, sem token e sem checar posse — qualquer chamador removia
 * artefato de outro usuário. Agora exige uid e só apaga o que está em
 * `users/<uid>/`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type RouteHandler = (req: Record<string, any>, res: Record<string, any>) => unknown;

let storageRoot = "";
let deleteHandlers = new Map<string, RouteHandler>();

const DONO = "uid-dono";
const INTRUSO = "uid-intruso";

function userFile(uid: string, name: string): { absolute: string; url: string } {
  const relative = path.join("users", uid, "simcar", "output", name);
  const absolute = path.join(storageRoot, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, "conteudo");
  return { absolute, url: `/api/storage/users/${uid}/simcar/output/${name}` };
}

beforeAll(async () => {
  storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "geoforest-clip-delete-"));
  process.env.LOCAL_DATA_ROOT = storageRoot;
  vi.resetModules();
  const routes = await import("./routes");
  deleteHandlers = new Map();
  routes.registerSimcarClipRoutes({
    get() {},
    post() {},
    delete(pathname: string, handler: RouteHandler) {
      deleteHandlers.set(pathname, handler);
    },
  } as any);
});

afterAll(() => {
  delete process.env.LOCAL_DATA_ROOT;
  if (storageRoot) fs.rmSync(storageRoot, { recursive: true, force: true });
});

async function callDelete(body: Record<string, unknown>, authUid?: string) {
  const handler = deleteHandlers.get("/api/simcar/clip/:jobId");
  if (!handler) throw new Error("Rota DELETE /api/simcar/clip/:jobId não registrada");
  const res: Record<string, any> = {
    statusCode: 200,
    payload: null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  await handler({ authUid, params: { jobId: "job-1" }, body }, res);
  return res;
}

describe("DELETE /api/simcar/clip/:jobId", () => {
  it("recusa chamada sem token", async () => {
    const alvo = userFile(DONO, "sem-token.zip");
    const res = await callDelete({ outputZipUrl: alvo.url });
    expect(res.statusCode).toBe(401);
    expect(fs.existsSync(alvo.absolute)).toBe(true);
  });

  it("não apaga artefato de outro usuário", async () => {
    const alheio = userFile(DONO, "alheio.zip");
    const res = await callDelete({ imageUrls: [alheio.url] }, INTRUSO);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ deleted: 0, skipped: 1 });
    expect(fs.existsSync(alheio.absolute)).toBe(true);
  });

  it("apaga os próprios artefatos", async () => {
    const proprio = userFile(DONO, "proprio.zip");
    const imagem = userFile(DONO, "analise.png");
    const res = await callDelete({ outputZipUrl: proprio.url, imageUrls: [imagem.url] }, DONO);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ ok: true, deleted: 2 });
    expect(fs.existsSync(proprio.absolute)).toBe(false);
    expect(fs.existsSync(imagem.absolute)).toBe(false);
  });

  it("ignora caminho fora do storage (URL externa)", async () => {
    const res = await callDelete({ outputZipUrl: "https://exemplo.com/qualquer.zip" }, DONO);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toMatchObject({ deleted: 0, skipped: 1 });
  });
});
