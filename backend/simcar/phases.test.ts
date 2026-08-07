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
  it("F1 disponível quando há AUAS e bloco V2 vazio", () => {
    const phases = derivePhases(base());
    expect(phases.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(phases.phases.POS_2008.state).toBe("BLOCKED");
    expect(phases.phases.POS_2008.blockedReason).toBe("requires_PRE_2008");
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

  it("F1 concluída libera F2 (AVAILABLE); F3 espera POS_2008", () => {
    const phases = derivePhases(base({ auasMeta: phase1Done }));
    expect(phases.phases.PRE_2008.state).toBe("COMPLETED");
    expect(phases.phases.POS_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.blockedReason).toBe("requires_POS_2008");
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
    expect(phases.phases.POS_2008.state).toBe("COMPLETED");
    expect(phases.phases.POS_2008.stale).toBe(true);
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

  it("trava com PHASE_NOT_READY quando requer fase anterior", () => {
    const phases = derivePhases(base());
    const gate = checkPhaseGate(phases, "POS_2008");
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