/**
 * Regressão: `importZipOnTestProject` retornava `ok: reallyOk || ok` — como `ok`
 * era mais frouxo, o OR virava `ok` e uma reprovação FINALIZADO … REPROVADO saía
 * com `ok: true`: o autofix não disparava e o pipeline anunciava "aprovada pela
 * SEMA". A regra única agora mora em `isImportOk` (compartilhada com process-geo).
 */
import { describe, expect, it } from "vitest";
import { isImportOk } from "./import-shape";

describe("isImportOk", () => {
  it("FINALIZADO sozinho é sucesso", () => {
    expect(isImportOk("[FINALIZADO]")).toBe(true);
  });

  it("COM_PENDENCIA reprova mesmo acompanhando FINALIZADO", () => {
    expect(isImportOk("[FINALIZADO][COM_PENDENCIA]")).toBe(false);
    expect(isImportOk("FINALIZADO COM_PENDENCIA")).toBe(false);
  });

  it("REPROVADO reprova mesmo acompanhando FINALIZADO", () => {
    expect(isImportOk("FINALIZADO … REPROVADO")).toBe(false);
    expect(isImportOk("[FINALIZADO] [REPROVADO]")).toBe(false);
  });

  it("qualquer outro estado não é sucesso", () => {
    expect(isImportOk("[PROCESSANDO]")).toBe(false);
    expect(isImportOk("")).toBe(false);
  });
});
