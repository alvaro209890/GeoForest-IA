/**
 * Guarda do `/api/storage`: fecha os JSON de perfil/jobs e mantém os
 * arquivos que o app realmente baixa — inclusive o contexto do recorte,
 * sem o qual as fases da análise pós-recorte param.
 */
import { describe, expect, it } from "vitest";
import { isPrivateStoragePath } from "./storage-guard";

describe("isPrivateStoragePath", () => {
  it("bloqueia perfil, preferências, conversas e jobs", () => {
    expect(isPrivateStoragePath("/api/storage/users/u1/profile.json")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/settings/preferences.json")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/conversations/abc.json")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/simcar_clips/job-1.json")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/croqui_jobs/job-1.json")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/processing_jobs/job-1.json")).toBe(true);
  });

  it("bloqueia dotfiles", () => {
    expect(isPrivateStoragePath("/api/storage/users/u1/.env")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/simcar/output/.hidden/x.zip")).toBe(true);
  });

  it("libera os artefatos que o app baixa", () => {
    expect(isPrivateStoragePath("/api/storage/users/u1/simcar/output/recorte.zip")).toBe(false);
    expect(isPrivateStoragePath("/api/storage/users/u1/simcar/context/ctx.json")).toBe(false);
    expect(isPrivateStoragePath("/api/storage/users/u1/attachments/pdfs/1_laudo.pdf")).toBe(false);
    expect(isPrivateStoragePath("/api/storage/users/u1/attachments/images/1_foto.png")).toBe(false);
    expect(isPrivateStoragePath("/api/storage/users/u1/croqui/output/mapa.pdf")).toBe(false);
  });

  it("ignora query string", () => {
    expect(isPrivateStoragePath("/api/storage/users/u1/profile.json?download=1")).toBe(true);
    expect(isPrivateStoragePath("/api/storage/users/u1/simcar/output/a.zip?x=1")).toBe(false);
  });
});
