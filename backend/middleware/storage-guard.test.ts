import { describe, expect, it } from "vitest";
import { isPrivateStoragePath, storageGuard } from "./storage-guard";

describe("isPrivateStoragePath — /api/storage não expõe o banco JSON", () => {
  it.each([
    "/users/u1/conversations/c1.json",
    "/users/u1/simcar_clips/job.json",
    "/users/u1/croqui_jobs/job.json",
    "/users/u1/overlap_jobs/job.json",
    "/users/u1/profile.json",
    "/users/u1/settings/preferences.json",
    "/users/u1/simcar-oraculo/job/r1/x.zip",
    "/cbers_archive/images/abc.json",
    "/ndvi_archive/images/abc.json",
    "/auas_v2_checkpoints/x.json",
    "/users/u1/%63onversations/c1.json",
    "/users/u1/simcar/../conversations/c1.json",
    "/users/u1",
    "/",
  ])("bloqueia %s", (p) => {
    expect(isPrivateStoragePath(p)).toBe(true);
  });

  it.each([
    "/users/u1/simcar/output/SIMCAR_Recorte_x.zip",
    "/users/u1/simcar/context/ctx.json",
    "/users/u1/simcar/analysis/laudo.pdf",
    "/users/u1/croqui/output/croqui.zip",
    "/users/u1/attachments/images/1_foto.png",
    "/users/u1/cbers/output/cena.zip",
  ])("libera artefato %s", (p) => {
    expect(isPrivateStoragePath(p)).toBe(false);
  });
});

describe("storageGuard", () => {
  it("responde 404 para doc do banco e deixa artefato seguir", () => {
    const res: any = { statusCode: 200 };
    res.status = (c: number) => ((res.statusCode = c), res);
    res.json = (b: any) => ((res.body = b), res);
    let nextCalls = 0;
    storageGuard({ path: "/users/u1/conversations/c1.json" } as any, res, () => nextCalls++);
    expect(res.statusCode).toBe(404);
    expect(nextCalls).toBe(0);
    storageGuard({ path: "/users/u1/simcar/output/a.zip" } as any, res, () => nextCalls++);
    expect(nextCalls).toBe(1);
  });
});
