import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const LIVE = process.env.SIMCAR_LIVE === "1";
const V23_SHA256 =
  "22d79a4743af2dda54cf3d5bd35a1371e5f93235b7ecef5b46a9eb9680f21f5a";

describe.skipIf(!LIVE)("pipeline SIMCAR live — T16", () => {
  it(
    "corrige os 11 erros do V23 e importa a segunda rodada como FINALIZADO",
    async () => {
      const zipPath = path.resolve(
        process.env.SIMCAR_V23_ZIP ||
          ".oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V23_16-07-26.zip"
      );
      if (!fs.existsSync(zipPath)) {
        throw new Error(`Fixture live V23 ausente: ${zipPath}`);
      }
      const zip = fs.readFileSync(zipPath);
      expect(crypto.createHash("sha256").update(zip).digest("hex")).toBe(
        V23_SHA256
      );
      expect(String(process.env.SIMCAR_CPF || "").trim()).not.toBe("");
      expect(String(process.env.SIMCAR_SENHA || "").trim()).not.toBe("");
      expect(String(process.env.DEEPSEEK_API_KEY || "").trim()).not.toBe("");

      const { startOraculoPipeline } = await import("./pipeline");
      const jobId = `live-t16-v23-${crypto.randomUUID()}`;
      const started = startOraculoPipeline({
        uid: "live-t16",
        uploadId: `upload-${jobId}`,
        jobId,
        zip,
        fileName: path.basename(zipPath),
        carId: "270069",
        autoProcess: false,
        autofix: true,
        maxRounds: 3,
        onNotification: notification => {
          if (notification.type !== "event") return;
          console.info(
            `[T16 live] r${notification.event.round} ${notification.event.step}: ${notification.event.message}`
          );
        },
      });

      const completed = await started.completion;
      const firstRound = completed.rounds?.[0];
      const secondRound = completed.rounds?.[1];
      expect(completed).toMatchObject({
        status: "completed",
        ok: true,
        importOk: true,
        processOk: null,
        round: 2,
      });
      expect(completed.rounds).toHaveLength(2);
      expect(firstRound).toMatchObject({
        n: 1,
        import: {
          ok: false,
          errosResumo: [
            {
              camada: "AREA_UMIDA",
              erro: "A geometria contém pontos repetidos",
              qtd: 11,
            },
          ],
        },
        fixplan: "fixplan-r1",
        fixPlan: {
          fonte: "deepseek",
          acoes: [
            {
              type: "remove_duplicate_vertices",
              layers: ["AREA_UMIDA"],
            },
          ],
        },
      });
      expect(firstRound.diffResumo).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            camada: "AREA_UMIDA",
            acao: "remove_duplicate_vertices",
            alterou: true,
            verticesRemovidos: 73,
          }),
        ])
      );
      expect(secondRound).toMatchObject({
        n: 2,
        zipArtifact: "corrigido-zip-r2",
        import: { ok: true, resultado: expect.stringContaining("FINALIZADO") },
        process: null,
      });
      expect(completed.artifacts).toMatchObject({
        "corrigido-zip-r2": { source: "autofix" },
        "fixplan-r1": { source: "autofix", contentType: "application/json" },
      });

      const storageRoot = path.resolve(
        process.env.LOCAL_DATA_ROOT || "data/local-storage"
      );
      const fixPlanPayload = JSON.parse(
        fs.readFileSync(
          path.resolve(
            storageRoot,
            completed.artifacts["fixplan-r1"].relativePath
          ),
          "utf8"
        )
      );
      expect(fixPlanPayload).toMatchObject({
        input: { totalErrors: 11 },
        plan: { fonte: "deepseek" },
        resultadoRodadaSeguinte: {
          round: 2,
          import: {
            ok: true,
            resultado: expect.stringContaining("FINALIZADO"),
          },
        },
      });

      console.info(
        "[T16 live] resumo seguro",
        JSON.stringify({
          jobId,
          rounds: completed.rounds.length,
          round1Errors: firstRound.import.errosResumo,
          planSource: firstRound.fixPlan.fonte,
          actions: firstRound.fixPlan.acoes.map((action: any) => ({
            type: action.type,
            layers: action.layers,
          })),
          round2Import: secondRound.import.resultado,
        })
      );
    },
    20 * 60 * 1000
  );
});
