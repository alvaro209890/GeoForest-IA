import { describe, expect, it } from "vitest";

import {
  findLegalVerdict,
  MAX_TEXT_LENGTH,
  sanitizeVisionPayload,
} from "./text-sanitizer";

describe("findLegalVerdict", () => {
  it("não acusa 'regular' descrevendo textura ou forma", () => {
    // Era o falso positivo mais caro: a lista antiga casava por substring, e
    // esta frase derrubava a janela inteira (13/30 janelas da Fase 2).
    expect(findLegalVerdict("Textura de padrão regular, típica de cultivo.")).toBeNull();
    expect(findLegalVerdict("Bordas de formato regular e limites retilíneos.")).toBeNull();
  });

  it("não acusa 'legal' no nome da camada do CAR", () => {
    expect(findLegalVerdict("O polígono sobrepõe a Área de Reserva Legal declarada.")).toBeNull();
  });

  it("acusa conclusão jurídica de verdade", () => {
    expect(findLegalVerdict("Há infração ambiental no polígono.")).not.toBeNull();
    expect(findLegalVerdict("Situação irregular perante o órgão.")).not.toBeNull();
    expect(findLegalVerdict("Área sob embargo.")).not.toBeNull();
    expect(findLegalVerdict("Desmatamento ilegal evidente.")).not.toBeNull();
  });
});

describe("sanitizeVisionPayload", () => {
  it("trunca frase longa em vez de invalidar a observação", () => {
    const longText = "a".repeat(MAX_TEXT_LENGTH + 60);
    const { value, counters } = sanitizeVisionPayload({ conflicts: [longText] });
    const conflicts = (value as any).conflicts as string[];
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].length).toBe(MAX_TEXT_LENGTH);
    expect(counters.truncated).toBe(1);
  });

  it("descarta só a frase com conclusão jurídica e preserva o resto", () => {
    const { value, counters } = sanitizeVisionPayload({
      observations: [
        {
          sceneId: "AUAS-0001:landsat5:2009",
          evidence: ["Solo exposto com padrão regular.", "Constatada infração ambiental."],
          limitations: [],
        },
      ],
    });
    const evidence = (value as any).observations[0].evidence as string[];
    expect(evidence).toEqual(["Solo exposto com padrão regular."]);
    expect(counters.droppedLegal).toBe(1);
    expect((value as any).observations[0].sceneId).toBe("AUAS-0001:landsat5:2009");
  });

  it("sanea evidence de transitions e não mexe em campos desconhecidos", () => {
    const { value } = sanitizeVisionPayload({
      schemaVersion: 1,
      transitions: [{ fromYear: 2009, toYear: 2010, evidence: ["Mudança visível."] }],
    });
    expect((value as any).schemaVersion).toBe(1);
    expect((value as any).transitions[0].evidence).toEqual(["Mudança visível."]);
    expect((value as any).transitions[0].fromYear).toBe(2009);
  });

  it("devolve a entrada intacta quando não é objeto", () => {
    expect(sanitizeVisionPayload(null).value).toBeNull();
    expect(sanitizeVisionPayload("texto").value).toBe("texto");
  });
});
