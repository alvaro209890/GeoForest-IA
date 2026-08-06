/**
 * Estado das 3 fases pós-recorte — regra de desbloqueio do servidor.
 * Cobre R-03 e a parte de gating de U-15 do plano
 * `docs/planos/analise-pos-recorte/09-testes-e-validacao.md`.
 */
import { describe, expect, it } from "vitest";

import {
  PHASE1_SECONDS_PER_POLYGON,
  checkPhaseGate,
  derivePhases,
  estimatePhase1,
  isPhase1Completed,
} from "./phases";

const auasMetaV2Completo = {
  schemaVersion: 2,
  rulesVersion: "auas-pre2008-v1",
  status: "ALERTA_PRE_2008",
  pre2008Alert: true,
  completedAt: "2026-08-05T14:20:00.000Z",
  summary: {
    polygonCount: 17,
    alertCount: 3,
    inconclusiveCount: 2,
    noEvidenceCount: 12,
    totalAuasAreaHa: 210.5,
    alertAreaHa: 42.1,
  },
};

function base(overrides: Record<string, unknown> = {}) {
  return derivePhases({
    jobId: "job-1",
    auasPolygonCount: 17,
    acPolygonCount: 9,
    ...overrides,
  } as any);
}

describe("derivePhases", () => {
  it("R-03: logo após o recorte, Fase 1 AVAILABLE e as outras BLOCKED com motivo legível", () => {
    const payload = base();
    expect(payload.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(payload.phases.PRE_2008.blockedMessage).toBeNull();
    expect(payload.phases.POS_2008.state).toBe("BLOCKED");
    expect(payload.phases.POS_2008.blockedReason).toBe("requires_PRE_2008");
    expect(payload.phases.POS_2008.blockedMessage).toMatch(/Fase 1/);
    expect(payload.phases.AC_VEG.state).toBe("BLOCKED");
    expect(payload.phases.AC_VEG.blockedReason).toBe("requires_PRE_2008");
    expect(payload.layers).toEqual({ auasPolygonCount: 17, acPolygonCount: 9 });
  });

  it("a prévia da Fase 1 sai da contagem de polígonos (3 janelas, 6 cenas)", () => {
    const estimate = base().phases.PRE_2008.estimate!;
    expect(estimate).toEqual({
      polygons: 17,
      scenesPerPolygon: 6,
      windowsPerPolygon: 3,
      etaSeconds: 17 * PHASE1_SECONDS_PER_POLYGON,
    });
    expect(estimatePhase1(0).etaSeconds).toBe(0);
  });

  it("recorte sem camada AUAS bloqueia as fases 1 e 2 com motivo próprio (não é erro)", () => {
    const payload = base({ auasPolygonCount: 0 });
    expect(payload.phases.PRE_2008.blockedReason).toBe("layer_empty_AUAS");
    expect(payload.phases.PRE_2008.blockedMessage).toMatch(/AUAS/);
    expect(payload.phases.POS_2008.blockedReason).toBe("layer_empty_AUAS");
  });

  it("recorte sem AREA_CONSOLIDADA bloqueia só a Fase 3", () => {
    const payload = base({ acPolygonCount: 0 });
    expect(payload.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(payload.phases.AC_VEG.blockedReason).toBe("layer_empty_AREA_CONSOLIDADA");
  });

  it("Fase 1 concluída (V2) vira COMPLETED e traz o resumo do laudo", () => {
    const payload = base({ auasMeta: auasMetaV2Completo });
    const fase1 = payload.phases.PRE_2008;
    expect(fase1.state).toBe("COMPLETED");
    expect(fase1.completedAt).toBe("2026-08-05T14:20:00.000Z");
    expect(fase1.rulesVersion).toBe("auas-pre2008-v1");
    expect(fase1.summary).toMatchObject({ alertCount: 3, inconclusiveCount: 2, pre2008Alert: true });
  });

  it("card antigo V1 não conta como Fase 1 concluída (janela 2008–2024 é outra pergunta)", () => {
    const v1 = { finalStatus: "AUAS_VALIDA", firstDeforestationYear: 2015 };
    expect(isPhase1Completed(v1)).toBe(false);
    const payload = base({ auasMeta: v1 });
    expect(payload.phases.PRE_2008.state).toBe("AVAILABLE");
    expect(payload.phases.POS_2008.blockedReason).toBe("requires_PRE_2008");
  });

  it("bloco V2 sem completedAt (execução interrompida) não destrava a Fase 2", () => {
    const parcial = { ...auasMetaV2Completo, completedAt: "" };
    expect(isPhase1Completed(parcial)).toBe(false);
    expect(base({ auasMeta: parcial }).phases.POS_2008.blockedReason).toBe("requires_PRE_2008");
  });

  it("com a Fase 1 concluída, a Fase 2 informa que ainda não foi implementada", () => {
    const payload = base({ auasMeta: auasMetaV2Completo });
    expect(payload.phases.POS_2008.blockedReason).toBe("phase_not_implemented");
    expect(payload.phases.AC_VEG.blockedReason).toBe("requires_POS_2008");
  });

  it("Fase 3 só sai de requires_POS_2008 quando a Fase 2 tiver completedAt", () => {
    const payload = base({
      auasMeta: auasMetaV2Completo,
      auasPos2008Meta: { schemaVersion: 1, completedAt: "2026-08-06T10:00:00.000Z" },
    });
    expect(payload.phases.AC_VEG.blockedReason).toBe("phase_not_implemented");
  });

  it("resultado de fase posterior a uma Fase 1 refeita fica marcado como stale, não some", () => {
    const payload = base({
      auasMeta: auasMetaV2Completo,
      auasPos2008Meta: { schemaVersion: 1, completedAt: "2026-08-06T10:00:00.000Z" },
      acVegetacaoMeta: { schemaVersion: 1, completedAt: "2026-08-06T12:00:00.000Z" },
    });
    expect(payload.phases.POS_2008.stale).toBe(true);
    expect(payload.phases.AC_VEG.stale).toBe(true);
  });

  it("fase em execução aparece como RUNNING e as outras não largam junto", () => {
    const payload = base({ runningPhase: "PRE_2008" });
    expect(payload.phases.PRE_2008.state).toBe("RUNNING");
    expect(payload.phases.POS_2008.state).toBe("BLOCKED");
  });
});

describe("checkPhaseGate", () => {
  it("U-15: Fase 2 sem Fase 1 concluída → 409 PHASE_NOT_READY apontando a fase que falta", () => {
    const gate = checkPhaseGate(base(), "POS_2008");
    expect(gate?.status).toBe(409);
    expect(gate?.body.code).toBe("PHASE_NOT_READY");
    expect(gate?.body.requires).toBe("PRE_2008");
  });

  it("fase disponível ou concluída passa pelo gate", () => {
    expect(checkPhaseGate(base(), "PRE_2008")).toBeNull();
    expect(checkPhaseGate(base({ auasMeta: auasMetaV2Completo }), "PRE_2008")).toBeNull();
  });

  it("fase já rodando → 409 PHASE_ALREADY_RUNNING", () => {
    const gate = checkPhaseGate(base({ runningPhase: "PRE_2008" }), "PRE_2008");
    expect(gate?.status).toBe(409);
    expect(gate?.body.code).toBe("PHASE_ALREADY_RUNNING");
  });

  it("camada vazia também não deixa a fase rodar, com mensagem própria", () => {
    const gate = checkPhaseGate(base({ auasPolygonCount: 0 }), "PRE_2008");
    expect(gate?.status).toBe(409);
    expect(gate?.body.error).toMatch(/AUAS/);
  });
});
