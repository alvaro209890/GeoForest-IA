import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Gate live do D7 (T17): processa o ZIP da Santa Clara SEM a camada AREA_UMIDA
 * no CAR-teste 270069. Prova que, removida a úmida (decisão D7, só no CAR-teste),
 * o ProcessarGeo real não retorna nenhum erro de contenção de área úmida — o que
 * restar é pendência cadastral (reservatório/ARL) classificada como naoCorrigivel.
 *
 * Opt-in: SIMCAR_LIVE=1 + credenciais + fixture fora do repo público.
 *   set -a && source .oraculo-scratch/simcar-oraculo.env && set +a
 *   SIMCAR_LIVE=1 npx vitest run --root . backend/simcar-oraculo/pipeline-process-d7-live.test.ts
 */
const LIVE = process.env.SIMCAR_LIVE === "1";
const SEM_UMIDA_SHA256 =
  "98a9f5f21a1088d1d3868acca2ee644071cf37236800a613f0152493934d98ec";

function isWetlandContainment(error: {
  camada?: string;
  erro?: string;
}): boolean {
  const layer = String(error.camada || "").toUpperCase();
  const message = String(error.erro || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  return (
    layer.includes("AREA_UMIDA") &&
    /completamente contid|deve (?:estar|ser) contid/.test(message)
  );
}

describe.skipIf(!LIVE)("pipeline SIMCAR live — D7 (sem AREA_UMIDA)", () => {
  it(
    "importa e processa o ZIP sem AREA_UMIDA sem nenhuma contenção de úmida",
    async () => {
      const zipPath = path.resolve(
        process.env.SIMCAR_SEM_UMIDA_ZIP ||
          ".oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_SEM_UMIDA.zip"
      );
      if (!fs.existsSync(zipPath))
        throw new Error(`Fixture live SEM_UMIDA ausente: ${zipPath}`);
      const zip = fs.readFileSync(zipPath);
      expect(crypto.createHash("sha256").update(zip).digest("hex")).toBe(
        SEM_UMIDA_SHA256
      );
      expect(String(process.env.SIMCAR_CPF || "").trim()).not.toBe("");
      expect(String(process.env.SIMCAR_SENHA || "").trim()).not.toBe("");

      const { startOraculoPipeline } = await import("./pipeline");
      const jobId = `live-d7-semumida-${crypto.randomUUID()}`;
      const started = startOraculoPipeline({
        uid: "live-d7",
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
            `[D7 live] r${notification.event.round} ${notification.event.step}: ${notification.event.message}`
          );
        },
      });

      const completed = await started.completion;
      const firstRound = completed.rounds?.[0];
      expect(completed.status).toBe("completed");
      expect(firstRound).toMatchObject({
        n: 1,
        import: { ok: true, resultado: expect.stringContaining("FINALIZADO") },
        process: expect.objectContaining({ errosResumo: expect.any(Array) }),
      });

      // O ZIP não tem AREA_UMIDA → o ProcessarGeo não pode acusar contenção de úmida.
      const wetlandContainment = (firstRound.process.errosResumo || [])
        .filter(isWetlandContainment)
        .reduce(
          (total: number, error: any) =>
            total + Math.max(0, Number(error.qtd) || 0),
          0
        );
      expect(wetlandContainment).toBe(0);

      // Não deve existir camada AREA_UMIDA em erro algum.
      const anyUmida = (firstRound.process.errosResumo || []).some((error: any) =>
        String(error.camada || "")
          .toUpperCase()
          .includes("AREA_UMIDA")
      );
      expect(anyUmida).toBe(false);

      // Sem erro de contenção mecanicamente corrigível, o loop não deve aplicar clip:
      // ou processa limpo, ou para com pendência cadastral (naoCorrigivel).
      const usedClip = (completed.rounds || []).some((round: any) =>
        (round.fixPlan?.acoes || []).some(
          (action: any) => action.type === "clip_layer_to_cover"
        )
      );
      expect(usedClip).toBe(false);

      console.info(
        "[D7 live] resumo seguro",
        JSON.stringify({
          jobId,
          status: completed.status,
          ok: completed.ok,
          rounds: completed.rounds.length,
          round1Import: firstRound.import.resultado,
          round1Process: firstRound.process.resultado,
          round1Errors: firstRound.process.errosResumo,
          wetlandContainment,
          stopReason: completed.autofixStopReason || null,
        })
      );
    },
    30 * 60 * 1000
  );
});
