/**
 * Testes do estado das 3 fases da análise pós-recorte (tarefa F0.5).
 * `derivePhases` é pura — o foco está na **independência** das 3 fases: nenhuma
 * tranca a outra, cada uma só precisa da sua camada (pedido do Álvaro, 23/08/2026).
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
  it("as 3 fases nascem AVAILABLE juntas — nenhuma espera outra", () => {
    const phases = derivePhases(base());
    expect(phases.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(phases.phases.POS_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.state).toBe("AVAILABLE");
    expect(checkPhaseGate(phases, "PRE_2008")).toBeNull();
    expect(checkPhaseGate(phases, "POS_2008")).toBeNull();
    expect(checkPhaseGate(phases, "AC_VEG")).toBeNull();
  });

  it("F3 sozinha: sem F1 e sem F2 concluídas, continua liberada", () => {
    const phases = derivePhases(base({ auasPolygonCount: 0, acPolygonCount: 4 }));
    expect(phases.phases.AC_VEG.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.estimate?.polygons).toBe(4);
    expect(checkPhaseGate(phases, "AC_VEG")).toBeNull();
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

  it("F1 concluída não muda o estado das outras duas", () => {
    const phases = derivePhases(base({ auasMeta: phase1Done }));
    expect(phases.phases.PRE_2008.state).toBe("COMPLETED");
    expect(phases.phases.POS_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.state).toBe("AVAILABLE");
  });

  it("F2 pode estar COMPLETED sem a Fase 1 — a datação não espera o pré-2008", () => {
    const phases = derivePhases(base({ auasPos2008Meta: pos2008Done }));
    expect(phases.phases.POS_2008.state).toBe("COMPLETED");
    expect(phases.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(phases.phases.AC_VEG.state).toBe("AVAILABLE");
  });

  it("F3 pode estar COMPLETED sozinha, sem F1 nem F2", () => {
    const phases = derivePhases(base({ acVegetacaoMeta: acDone }));
    expect(phases.phases.AC_VEG.state).toBe("COMPLETED");
    expect(phases.phases.AC_VEG.summary?.declaredVegetationCount).toBe(1);
    expect(phases.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(phases.phases.POS_2008.state).toBe("AVAILABLE");
  });

  it("F2 concluída registra summary e F3 segue liberada", () => {
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

  it("refazer a F1 NÃO invalida a F2 nem a F3", () => {
    // Antes a F2 virava STALE e a F3 herdava `previous_phase_stale` (barrada).
    // As perguntas são independentes: refazer o pré-2008 não muda em que ano a
    // supressão ocorreu, nem se sobrou vegetação dentro da AC.
    const phases = derivePhases(
      base({
        auasMeta: { ...phase1Done, completedAt: "2026-02-01T00:00:00.000Z" },
        auasPos2008Meta: pos2008Done,
        acVegetacaoMeta: acDone,
      })
    );
    expect(phases.phases.POS_2008.state).toBe("COMPLETED");
    expect(phases.phases.POS_2008.stale).toBe(false);
    expect(phases.phases.AC_VEG.state).toBe("COMPLETED");
    expect(phases.phases.AC_VEG.stale).toBe(false);
    expect(checkPhaseGate(phases, "AC_VEG")).toBeNull();
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

  it("nenhuma fase devolve PHASE_NOT_READY por causa de outra", () => {
    const phases = derivePhases(base());
    for (const phase of ["PRE_2008", "POS_2008", "AC_VEG"] as const) {
      expect(checkPhaseGate(phases, phase)).toBeNull();
    }
  });

  it("flag desligada é o único PHASE_NOT_READY que sobra", () => {
    const phases = derivePhases(base({ acVegetacaoEnabled: false }));
    const gate = checkPhaseGate(phases, "AC_VEG");
    expect(gate?.status).toBe(409);
    expect(gate?.body.code).toBe("PHASE_NOT_READY");
    expect(gate?.body.requires).toBeUndefined();
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

describe("nenhuma fase tranca a outra", () => {
  const todasConcluidas = base({
    auasMeta: { ...phase1Done, completedAt: "2026-02-01T00:00:00.000Z" },
    auasPos2008Meta: pos2008Done,
    acVegetacaoMeta: acDone,
  });

  it("as 3 podem ser refeitas em qualquer ordem", () => {
    const phases = derivePhases(todasConcluidas);
    for (const phase of ["PRE_2008", "POS_2008", "AC_VEG"] as const) {
      expect(phases.phases[phase].state).toBe("COMPLETED");
      expect(checkPhaseGate(phases, phase)).toBeNull();
    }
  });

  it("nenhum blockedReason de dependência sobra no payload", () => {
    const payload = JSON.stringify(derivePhases(todasConcluidas)) + JSON.stringify(derivePhases(base()));
    expect(payload).not.toContain("requires_");
    expect(payload).not.toContain("previous_phase_stale");
    expect(payload).not.toContain("phase_stale");
  });

  it("uma fase por vez: o gate recusa até fase já COMPLETED enquanto outra roda", () => {
    // A fase concluída continua COMPLETED (o resultado existe), então quem
    // recusa a segunda execução é o gate — as duas gravariam o mesmo JSON do job.
    const rodando = derivePhases({ ...todasConcluidas, runningPhase: "PRE_2008" });
    expect(rodando.phases.PRE_2008.state).toBe("RUNNING");
    expect(rodando.phases.POS_2008.state).toBe("COMPLETED");
    expect(checkPhaseGate(rodando, "POS_2008")?.body.code).toBe("PHASE_ALREADY_RUNNING");
    expect(checkPhaseGate(rodando, "AC_VEG")?.body.code).toBe("PHASE_ALREADY_RUNNING");
  });

  it("as 3 fases reagem igual a uma execução alheia (COMPLETED continua COMPLETED)", () => {
    // A F3 tinha a checagem de `other_phase_running` ANTES da de COMPLETED e,
    // sozinha entre as três, virava BLOCKED — o card perdia o resumo e o laudo
    // enquanto outra fase rodava.
    const rodando = derivePhases({ ...todasConcluidas, runningPhase: "POS_2008" });
    expect(rodando.phases.PRE_2008.state).toBe("COMPLETED");
    expect(rodando.phases.AC_VEG.state).toBe("COMPLETED");
    expect(rodando.phases.AC_VEG.summary).not.toBeNull();
  });

  it("fase ainda não rodada mostra other_phase_running enquanto outra roda", () => {
    const rodando = derivePhases(base({ runningPhase: "PRE_2008" }));
    expect(rodando.phases.POS_2008.blockedReason).toBe("other_phase_running");
    expect(rodando.phases.AC_VEG.blockedReason).toBe("other_phase_running");
  });

  it("terminada a execução, as 3 voltam a liberar", () => {
    const parado = derivePhases(todasConcluidas);
    for (const phase of ["PRE_2008", "POS_2008", "AC_VEG"] as const) {
      expect(checkPhaseGate(parado, phase)).toBeNull();
    }
  });
});
