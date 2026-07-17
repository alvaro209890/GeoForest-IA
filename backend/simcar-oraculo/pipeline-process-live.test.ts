import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIVE = process.env.SIMCAR_LIVE === "1";
const V22_SHA256 =
  "58d44f6117af06861e74c82053577e45ed4fc63e7426e28c4d24e3bb13f49fed";

function isWetlandContainment(error: {
  camada?: string;
  erro?: string;
}): boolean {
  const layer = String(error.camada || "").toUpperCase();
  const message = String(error.erro || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return (
    layer.includes("AREA_UMIDA") &&
    /completamente contid|deve (?:estar|ser) contid/.test(message)
  );
}

describe.skipIf(!LIVE)("pipeline SIMCAR live — T17", () => {
  it(
    "recorta a V22, reimporta e elimina as 41 contenções no ProcessarGeo",
    async () => {
      const zipPath = path.resolve(
        process.env.SIMCAR_V22_ZIP ||
          ".oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V22_16-07-26.zip"
      );
      if (!fs.existsSync(zipPath))
        throw new Error(`Fixture live V22 ausente: ${zipPath}`);
      const zip = fs.readFileSync(zipPath);
      expect(crypto.createHash("sha256").update(zip).digest("hex")).toBe(
        V22_SHA256
      );
      expect(String(process.env.SIMCAR_CPF || "").trim()).not.toBe("");
      expect(String(process.env.SIMCAR_SENHA || "").trim()).not.toBe("");
      expect(String(process.env.DEEPSEEK_API_KEY || "").trim()).not.toBe("");

      const { startOraculoPipeline } = await import("./pipeline");
      const jobId = `live-t17-v22-${crypto.randomUUID()}`;
      const started = startOraculoPipeline({
        uid: "live-t17",
        uploadId: `upload-${jobId}`,
        jobId,
        zip,
        fileName: path.basename(zipPath),
        carId: "270069",
        autoProcess: true,
        autofix: true,
        maxRounds: 3,
        onNotification: notification => {
          if (notification.type !== "event") return;
          console.info(
            `[T17 live] r${notification.event.round} ${notification.event.step}: ${notification.event.message}`
          );
        },
      });

      const completed = await started.completion;
      const firstRound = completed.rounds?.[0];
      const secondRound = completed.rounds?.[1];
      expect(completed.status).toBe("completed");
      expect(completed.round).toBeGreaterThanOrEqual(2);
      expect(firstRound).toMatchObject({
        n: 1,
        import: { ok: true, resultado: expect.stringContaining("FINALIZADO") },
        process: {
          ok: false,
          errosResumo: [
            expect.objectContaining({
              camada: "AREA_UMIDA",
              qtd: 41,
            }),
          ],
        },
        autofixPhase: "process",
        fixplan: "fixplan-r1",
        fixPlan: {
          fonte: "deepseek",
          modelo: "deepseek-v4-pro",
          acoes: [
            expect.objectContaining({
              type: "clip_layer_to_cover",
              layers: ["AREA_UMIDA"],
            }),
          ],
        },
      });
      expect(firstRound.diffResumo).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            camada: "AREA_UMIDA",
            acao: "clip_layer_to_cover",
            alterou: true,
          }),
        ])
      );
      expect(secondRound).toMatchObject({
        n: 2,
        zipArtifact: "corrigido-zip-r2",
        import: { ok: true, resultado: expect.stringContaining("FINALIZADO") },
        process: expect.objectContaining({ errosResumo: expect.any(Array) }),
      });
      const remainingContainment = (secondRound.process.errosResumo || [])
        .filter(isWetlandContainment)
        .reduce(
          (total: number, error: any) =>
            total + Math.max(0, Number(error.qtd) || 0),
          0
        );
      expect(remainingContainment).toBe(0);
      expect(completed.artifacts).toMatchObject({
        "corrigido-zip-r2": { source: "autofix" },
        "fixplan-r1": { source: "autofix", contentType: "application/json" },
      });

      console.info(
        "[T17 live] resumo seguro",
        JSON.stringify({
          jobId,
          status: completed.status,
          ok: completed.ok,
          rounds: completed.rounds.length,
          round1ProcessErrors: firstRound.process.errosResumo,
          planSource: firstRound.fixPlan.fonte,
          actions: firstRound.fixPlan.acoes.map((action: any) => ({
            type: action.type,
            layers: action.layers,
          })),
          diffResumo: firstRound.diffResumo,
          round2Import: secondRound.import.resultado,
          round2Process: secondRound.process.resultado,
          round2Errors: secondRound.process.errosResumo,
          remainingContainment,
          stopReason: completed.autofixStopReason || null,
        })
      );
    },
    30 * 60 * 1000
  );
});
