/**
 * Testes do estado das 3 fases da análise pós-recorte (tarefa F0.5).
 * `derivePhases` é pura — o foco está no encadeamento de gates F1→F2→F3.
 */
import { describe, expect, it } from "vitest";

import {
  derivePhases,
  estimatePhase2,
  estimatePhase3,
  checkPhaseGate,
  type DerivePhasesInput,
} from "./phases";

function base(input: Partial<DerivePhasesInput> = {}): DerivePhasesInput {
  return {
    jobId: "job-1",
    auasPolygonCount: 2,
    acPolygonCount: 1,
    auasMeta: undefined,
    auasPos2008Meta: undefined,
    acVegetacaoMeta: undefined,
    runningPhase: null,
    ...input,
  };
}

const phase1Done = {
  schemaVersion: 2,
  completedAt: "2026-01-01T00:00:00.000Z",
  rulesVersion: "auas-v1",
  summary: { polygonCount: 2, alertCount: 1 },
};
const pos2008Done = {
  schemaVersion: 1,
  completedAt: "2026-01-02T00:00:00.000Z",
  rulesVersion: "auas-pos2008-v1",
  summary: { polygonCount: 2, confirmedYearCount: 1 },
};
const acDone = {
  schemaVersion: 1,
  completedAt: "2026-01-03T00:00:00.000Z",
  rulesVersion: "ac-veg-v1",
  summary: { polygonCount: 2, declaredVegetationCount: 1, totalAcAreaHa: 10 },
};

describe("derivePhases", () => {
  it("F1 e F2 disponíveis quando há AUAS — a datação 2008–2019 não exige a Fase 1", () => {
    const phases = derivePhases(base());
    expect(phases.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(phases.phases.POS_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.blockedReason).toBe("requires_PRE_2008");
  });

  it("sem polígonos AUAS: F1/F2 bloqueiam com layer_empty_AUAS", () => {
    const phases = derivePhases(base({ auasPolygonCount: 0 }));
    expect(phases.phases.PRE_2008.blockedReason).toBe("layer_empty_AUAS");
    expect(phases.phases.POS_2008.blockedReason).toBe("layer_empty_AUAS");
  });

  it("sem AC: F3 bloqueada com layer_empty_AREA_CONSOLIDADA", () => {
    const phases = derivePhases(base({ acPolygonCount: 0 }));
    expect(phases.phases.AC_VEG.blockedReason).toBe("layer_empty_AREA_CONSOLIDADA");
  });

  it("F1 concluída deixa F2 AVAILABLE; F3 espera POS_2008", () => {
    const phases = derivePhases(base({ auasMeta: phase1Done }));
    expect(phases.phases.PRE_2008.state).toBe("COMPLETED");
    expect(phases.phases.POS_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.blockedReason).toBe("requires_POS_2008");
  });

  it("F2 pode estar COMPLETED sem a Fase 1 — a datação não espera o pré-2008", () => {
    const phases = derivePhases(base({ auasPos2008Meta: pos2008Done }));
    expect(phases.phases.POS_2008.state).toBe("COMPLETED");
    expect(phases.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.blockedReason).toBe("requires_PRE_2008");
  });

  it("F2 concluída registra summary e libera F3", () => {
    const phases = derivePhases(base({ auasMeta: phase1Done, auasPos2008Meta: pos2008Done }));
    expect(phases.phases.POS_2008.state).toBe("COMPLETED");
    expect(phases.phases.POS_2008.summary?.confirmedYearCount).toBe(1);
    expect(phases.phases.AC_VEG.state).toBe("AVAILABLE");
  });

  it("F3 concluída → COMPLETED com summary", () => {
    const phases = derivePhases(base({ auasMeta: phase1Done, auasPos2008Meta: pos2008Done, acVegetacaoMeta: acDone }));
    expect(phases.phases.AC_VEG.state).toBe("COMPLETED");
    expect(phases.phases.AC_VEG.summary?.declaredVegetationCount).toBe(1);
    expect(phases.phases.AC_VEG.summary?.totalAcAreaHa).toBe(10);
  });

  it("fase refeita depois invalida a seguinte (stale)", () => {
    const phases = derivePhases(
      base({
        auasMeta: { ...phase1Done, completedAt: "2026-02-01T00:00:00.000Z" },
        auasPos2008Meta: pos2008Done,
      })
    );
    expect(phases.phases.POS_2008.state).toBe("STALE");
    expect(phases.phases.POS_2008.stale).toBe(true);
  });

  it("a invalidação é transitiva até a Fase 3", () => {
    const phases = derivePhases(
      base({
        auasMeta: { ...phase1Done, completedAt: "2026-02-01T00:00:00.000Z" },
        auasPos2008Meta: {
          ...pos2008Done,
          pre2008JobRef: { completedAt: phase1Done.completedAt, rulesVersion: phase1Done.rulesVersion },
        },
        acVegetacaoMeta: {
          ...acDone,
          pos2008JobRef: { completedAt: pos2008Done.completedAt, rulesVersion: pos2008Done.rulesVersion },
        },
      }),
    );
    expect(phases.phases.POS_2008.state).toBe("STALE");
    expect(phases.phases.AC_VEG.state).toBe("STALE");
    expect(checkPhaseGate(phases, "AC_VEG")?.body.code).toBe("PHASE_NOT_READY");
  });

  it("flags independentes mantêm F2 e F3 bloqueadas sem apagar resultados concluídos", () => {
    const before = derivePhases(base({ auasMeta: phase1Done, pos2008Enabled: false }));
    expect(before.phases.POS_2008.blockedReason).toBe("phase_not_implemented");

    const after = derivePhases(
      base({
        auasMeta: phase1Done,
        auasPos2008Meta: pos2008Done,
        acVegetacaoEnabled: false,
      }),
    );
    expect(after.phases.POS_2008.state).toBe("COMPLETED");
    expect(after.phases.AC_VEG.blockedReason).toBe("phase_not_implemented");
  });

  it("RUNNING bloqueia as demais", () => {
    const phases = derivePhases(
      base({ auasMeta: phase1Done, auasPos2008Meta: pos2008Done, runningPhase: "POS_2008" })
    );
    expect(phases.phases.POS_2008.state).toBe("RUNNING");
    expect(phases.phases.AC_VEG.blockedReason).toBe("other_phase_running");
  });
});

describe("estimates", () => {
  it("F2: 5 janelas + 1 ponte, 12 cenas, ~280s/pol", () => {
    const e = estimatePhase2(3);
    expect(e.windowsPerPolygon).toBe(6);
    expect(e.scenesPerPolygon).toBe(12);
    expect(e.etaSeconds).toBe(3 * 280);
  });

  it("F3: 1 janela, 3 cenas, ~60s/pol", () => {
    const e = estimatePhase3(2);
    expect(e.windowsPerPolygon).toBe(1);
    expect(e.scenesPerPolygon).toBe(3);
    expect(e.etaSeconds).toBe(120);
  });
});

describe("checkPhaseGate", () => {
  it("libera AVAILABLE/COMPLETED", () => {
    const available = derivePhases(base({ auasMeta: phase1Done }));
    expect(checkPhaseGate(available, "POS_2008")).toBeNull();
    const done = derivePhases(base({ auasMeta: phase1Done, auasPos2008Meta: pos2008Done, acVegetacaoMeta: acDone }));
    expect(checkPhaseGate(done, "AC_VEG")).toBeNull();
  });

  it("F2 sem Fase 1 passa no gate; F3 ainda exige a Fase 2", () => {
    const phases = derivePhases(base());
    expect(checkPhaseGate(phases, "POS_2008")).toBeNull();
    const gate = checkPhaseGate(phases, "AC_VEG");
    expect(gate?.status).toBe(409);
    expect(gate?.body.code).toBe("PHASE_NOT_READY");
    expect(gate?.body.requires).toBe("PRE_2008");
  });

  it("trava com PHASE_ALREADY_RUNNING", () => {
    const phases = derivePhases(
      base({ auasMeta: phase1Done, auasPos2008Meta: pos2008Done, runningPhase: "AC_VEG", acPolygonCount: 1 })
    );
    const gate = checkPhaseGate(phases, "AC_VEG");
    expect(gate?.status).toBe(409);
    expect(gate?.body.code).toBe("PHASE_ALREADY_RUNNING");
  });
});

describe("STALE não pode virar deadlock", () => {
  /** F1 refeita depois da F2 ⇒ o resultado da F2 envelheceu. */
  const staleF2 = base({
    auasMeta: { ...phase1Done, completedAt: "2026-02-01T00:00:00.000Z" },
    auasPos2008Meta: pos2008Done,
  });

  it("STALE do próprio resultado libera a re-execução da fase", () => {
    // Regressão: o estado dizia "Refaça esta fase" e o gate respondia 409
    // PHASE_NOT_READY. Refazer a F1 só deixava a F2 ainda mais velha — a fase
    // ficava trancada para sempre.
    const phases = derivePhases(staleF2);
    expect(phases.phases.POS_2008.state).toBe("STALE");
    expect(phases.phases.POS_2008.blockedReason).toBe("phase_stale");
    expect(checkPhaseGate(phases, "POS_2008")).toBeNull();
  });

  it("STALE herdado da fase anterior continua barrado, com motivo próprio", () => {
    const phases = derivePhases(staleF2);
    expect(phases.phases.AC_VEG.state).toBe("STALE");
    expect(phases.phases.AC_VEG.blockedReason).toBe("previous_phase_stale");
    expect(checkPhaseGate(phases, "AC_VEG")?.body.code).toBe("PHASE_NOT_READY");
  });

  it("refeita a F2, a F3 volta a liberar", () => {
    const phases = derivePhases(
      base({
        auasMeta: { ...phase1Done, completedAt: "2026-02-01T00:00:00.000Z" },
        auasPos2008Meta: {
          ...pos2008Done,
          completedAt: "2026-02-02T00:00:00.000Z",
          pre2008JobRef: { completedAt: "2026-02-01T00:00:00.000Z", rulesVersion: phase1Done.rulesVersion },
        },
      }),
    );
    expect(phases.phases.POS_2008.state).toBe("COMPLETED");
    expect(phases.phases.AC_VEG.state).toBe("AVAILABLE");
    expect(checkPhaseGate(phases, "AC_VEG")).toBeNull();
  });
});
