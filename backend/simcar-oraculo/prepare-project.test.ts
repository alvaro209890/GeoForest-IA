import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  coversShapeBbox,
  expandBboxMeters,
  prepareTestProject,
  type PrepareProjectClient,
} from "./prepare-project";
import type { ShapeContext } from "./types";

const querencia = { Id: 751, Texto: "Querência", Codigo: "5107065", Estado: { Id: 11 } };
const canarana = { Id: 703, Texto: "Canarana", Codigo: "5102702", Estado: { Id: 11 } };

function requirement(args: {
  municipio?: Record<string, any>;
  nome?: string;
  bbox?: [number, number, number, number];
} = {}): Record<string, any> {
  const bbox = args.bbox || [-53, -13, -52, -12];
  return {
    Id: 270069,
    PropriedadeNome: args.nome ?? "Santa clara",
    Municipio: structuredClone(args.municipio || querencia),
    ZonaLocalizacao: "RURAL",
    MenorLongitudeGdec: bbox[0],
    MenorLatitudeGdec: bbox[1],
    MaiorLongitudeGdec: bbox[2],
    MaiorLatitudeGdec: bbox[3],
  };
}

function shape(args: Partial<ShapeContext> = {}): ShapeContext {
  return {
    bbox: [-52.8, -12.8, -52.4, -12.4],
    centroid: [-52.6, -12.6],
    layers: ["ATP"],
    propertyLayer: "ATP",
    municipioDetectado: { nome: "Querência", ibge: "5107065", fonte: "malha-ibge" },
    warnings: [],
    ...args,
  };
}

function unreachable(label: string): () => Promise<never> {
  return async () => {
    throw new Error(`${label} não deveria ser chamado`);
  };
}

beforeEach(() => {
  process.env.SIMCAR_TEST_CAR_ID = "270069";
  process.env.SIMCAR_POLL_MS = "1";
  process.env.SIMCAR_BASEREF_TIMEOUT_MS = "100";
  process.env.SIMCAR_ABRANGENCIA_MARGIN_M = "500";
});

afterEach(() => {
  delete process.env.SIMCAR_TEST_CAR_ID;
  delete process.env.SIMCAR_POLL_MS;
  delete process.env.SIMCAR_BASEREF_TIMEOUT_MS;
  delete process.env.SIMCAR_ABRANGENCIA_MARGIN_M;
});

describe("prepare-project bbox", () => {
  it("expande em metros e reconhece cobertura com margem", () => {
    const expanded = expandBboxMeters([-52.8, -12.8, -52.4, -12.4], 500);
    expect(expanded[0]).toBeLessThan(-52.8);
    expect(expanded[1]).toBeLessThan(-12.8);
    expect(expanded[2]).toBeGreaterThan(-52.4);
    expect(expanded[3]).toBeGreaterThan(-12.4);
    expect(coversShapeBbox(requirement(), shape().bbox, 500)).toBe(true);
    expect(
      coversShapeBbox(requirement({ bbox: [-52.7, -12.7, -52.5, -12.5] }), shape().bbox, 500),
    ).toBe(false);
  });
});

describe("prepareTestProject", () => {
  it("faz skip quando município e abrangência já estão corretos", async () => {
    const posts: string[] = [];
    const client: PrepareProjectClient = {
      buscar: async () => requirement(),
      buscarStatus: unreachable("buscarStatus"),
      get: unreachable("get"),
      post: async (pathname) => {
        posts.push(pathname);
        return {};
      },
      listarMunicipios: unreachable("listarMunicipios"),
    };

    await expect(prepareTestProject({ shape: shape(), client })).resolves.toMatchObject({
      municipioChanged: false,
      abrangenciaChanged: false,
      municipioAntes: "Querência",
      municipioDepois: "Querência",
    });
    expect(posts).toEqual([]);
  });

  it("muda município com polígono oficial e preserva PropriedadeNome byte a byte", async () => {
    let current = requirement();
    let propertyPayload: Record<string, any> | null = null;
    const client: PrepareProjectClient = {
      buscar: async () => structuredClone(current),
      buscarStatus: unreachable("buscarStatus"),
      get: async () => ({
        GeoJson: JSON.stringify({
          type: "Polygon",
          coordinates: [
            [
              [-53, -13],
              [-52, -13],
              [-52, -12],
              [-53, -12],
              [-53, -13],
            ],
          ],
        }),
      }),
      post: async (pathname, payload) => {
        expect(pathname).toBe("Requerimento/SalvarGrupoPropriedade");
        propertyPayload = structuredClone(payload as Record<string, any>);
        current = { ...(payload as Record<string, any>) };
        return {};
      },
      listarMunicipios: async () => [
        { chave: 703, nome: "Canarana", ibge: "5102702" },
      ],
    };
    const targetShape = shape({
      municipioDetectado: { nome: "Canarana", ibge: "5102702", fonte: "malha-ibge" },
    });

    const result = await prepareTestProject({ shape: targetShape, client });

    expect(result).toMatchObject({
      municipioChanged: true,
      municipioAntes: "Querência",
      municipioDepois: "Canarana",
      abrangenciaChanged: false,
    });
    expect(propertyPayload).toMatchObject({
      PropriedadeNome: "Santa clara",
      ZonaLocalizacao: "RURAL",
      Municipio: { Id: 703, Texto: "Canarana", Codigo: "5102702" },
    });
  });

  it("aborta antes de salvar se centroid não estiver no polígono oficial", async () => {
    const posts: string[] = [];
    const client: PrepareProjectClient = {
      buscar: async () => requirement(),
      buscarStatus: unreachable("buscarStatus"),
      get: async () => ({
        GeoJson: JSON.stringify({
          type: "Polygon",
          coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        }),
      }),
      post: async (pathname) => {
        posts.push(pathname);
        return {};
      },
      listarMunicipios: async () => [
        { chave: 703, nome: "Canarana", ibge: "5102702" },
      ],
    };

    await expect(
      prepareTestProject({
        shape: shape({
          municipioDetectado: { nome: "Canarana", ibge: "5102702", fonte: "malha-ibge" },
        }),
        client,
      }),
    ).rejects.toThrow(/polígono oficial/);
    expect(posts).toEqual([]);
  });

  it("salva abrangência e aceita BaseRef null estável", async () => {
    let current = requirement({ bbox: [-52.65, -12.65, -52.55, -12.55] });
    const posts: string[] = [];
    const client: PrepareProjectClient = {
      buscar: async () => structuredClone(current),
      buscarStatus: async () => ({ BaseRefStatus: null }),
      get: unreachable("get"),
      post: async (pathname, payload) => {
        posts.push(pathname);
        if (pathname === "Requerimento/SalvarAreaAbrangencia") {
          const p = payload as Record<string, number>;
          current = {
            ...current,
            MenorLongitudeGdec: p.MenorLongitudeGdec,
            MenorLatitudeGdec: p.MenorLatitudeGdec,
            MaiorLongitudeGdec: p.MaiorLongitudeGdec,
            MaiorLatitudeGdec: p.MaiorLatitudeGdec,
          };
        }
        return {};
      },
      listarMunicipios: unreachable("listarMunicipios"),
    };

    const result = await prepareTestProject({ shape: shape(), client });

    expect(result.abrangenciaChanged).toBe(true);
    expect(result.baserefWaitedMs).toBeGreaterThanOrEqual(0);
    expect(result.warnings).toContain("BaseRefStatus permaneceu null após salvar a abrangência.");
    expect(posts).toEqual(["Requerimento/SalvarAreaAbrangencia"]);
  });

  it("usa Limpar somente após falha da sobrescrita direta", async () => {
    let current = requirement({ bbox: [-52.65, -12.65, -52.55, -12.55] });
    let saveAttempts = 0;
    const posts: string[] = [];
    const client: PrepareProjectClient = {
      buscar: async () => structuredClone(current),
      buscarStatus: async () => ({ BaseRefStatus: null }),
      get: unreachable("get"),
      post: async (pathname, payload) => {
        posts.push(pathname);
        if (pathname === "Requerimento/SalvarAreaAbrangencia") {
          saveAttempts += 1;
          if (saveAttempts === 1) throw new Error("overwrite recusado");
          const p = payload as Record<string, number>;
          current = {
            ...current,
            MenorLongitudeGdec: p.MenorLongitudeGdec,
            MenorLatitudeGdec: p.MenorLatitudeGdec,
            MaiorLongitudeGdec: p.MaiorLongitudeGdec,
            MaiorLatitudeGdec: p.MaiorLatitudeGdec,
          };
        }
        return {};
      },
      listarMunicipios: unreachable("listarMunicipios"),
    };

    const result = await prepareTestProject({ shape: shape(), client });

    expect(result.abrangenciaChanged).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/Limpar foi necessário/);
    expect(posts).toEqual([
      "Requerimento/SalvarAreaAbrangencia",
      "Requerimento/LimparAreaAbrangencia/270069",
      "Requerimento/SalvarAreaAbrangencia",
    ]);
  });

  it("falha em timeout da BaseRef ativa", async () => {
    process.env.SIMCAR_BASEREF_TIMEOUT_MS = "5";
    let current = requirement({ bbox: [-52.65, -12.65, -52.55, -12.55] });
    const client: PrepareProjectClient = {
      buscar: async () => structuredClone(current),
      buscarStatus: async () => ({ BaseRefStatus: "[EXECUTANDO]" }),
      get: unreachable("get"),
      post: async (_pathname, payload) => {
        const p = payload as Record<string, number>;
        current = {
          ...current,
          MenorLongitudeGdec: p.MenorLongitudeGdec,
          MenorLatitudeGdec: p.MenorLatitudeGdec,
          MaiorLongitudeGdec: p.MaiorLongitudeGdec,
          MaiorLatitudeGdec: p.MaiorLatitudeGdec,
        };
        return {};
      },
      listarMunicipios: unreachable("listarMunicipios"),
    };

    await expect(prepareTestProject({ shape: shape(), client })).rejects.toThrow(
      /Timeout aguardando BaseRef/,
    );
  });

  it("reprocessa BaseRef uma vez após ERRO e aceita a conclusão", async () => {
    let current = requirement({ bbox: [-52.65, -12.65, -52.55, -12.55] });
    const statuses = ["[ERRO]", "[EXECUTANDO]", "[CONCLUIDO]"];
    const posts: string[] = [];
    const client: PrepareProjectClient = {
      buscar: async () => structuredClone(current),
      buscarStatus: async () => ({ BaseRefStatus: statuses.shift() || "[CONCLUIDO]" }),
      get: unreachable("get"),
      post: async (pathname, payload) => {
        posts.push(pathname);
        if (pathname === "Requerimento/SalvarAreaAbrangencia") {
          const p = payload as Record<string, number>;
          current = {
            ...current,
            MenorLongitudeGdec: p.MenorLongitudeGdec,
            MenorLatitudeGdec: p.MenorLatitudeGdec,
            MaiorLongitudeGdec: p.MaiorLongitudeGdec,
            MaiorLatitudeGdec: p.MaiorLatitudeGdec,
          };
        }
        return {};
      },
      listarMunicipios: unreachable("listarMunicipios"),
    };

    await expect(prepareTestProject({ shape: shape(), client })).resolves.toMatchObject({
      abrangenciaChanged: true,
    });
    expect(posts).toContain("Requerimento/ReprocessarBaseRef/270069");
  });

  it("propaga falha quando sobrescrita e Limpar são recusados", async () => {
    const client: PrepareProjectClient = {
      buscar: async () => requirement({ bbox: [-52.65, -12.65, -52.55, -12.55] }),
      buscarStatus: unreachable("buscarStatus"),
      get: unreachable("get"),
      post: async (pathname) => {
        throw new Error(`${pathname} recusado`);
      },
      listarMunicipios: unreachable("listarMunicipios"),
    };

    await expect(prepareTestProject({ shape: shape(), client })).rejects.toThrow(
      /LimparAreaAbrangencia.*recusado/,
    );
  });

  it("detecta violação do guard PropriedadeNome após salvar município", async () => {
    let changed = false;
    const client: PrepareProjectClient = {
      buscar: async () =>
        changed
          ? requirement({ municipio: canarana, nome: "Nome corrompido" })
          : requirement(),
      buscarStatus: unreachable("buscarStatus"),
      get: async () => ({
        GeoJson: JSON.stringify({
          type: "Polygon",
          coordinates: [[[-53, -13], [-52, -13], [-52, -12], [-53, -12], [-53, -13]]],
        }),
      }),
      post: async () => {
        changed = true;
        return {};
      },
      listarMunicipios: async () => [
        { chave: 703, nome: "Canarana", ibge: "5102702" },
      ],
    };

    await expect(
      prepareTestProject({
        shape: shape({
          municipioDetectado: { nome: "Canarana", ibge: "5102702", fonte: "malha-ibge" },
        }),
        client,
      }),
    ).rejects.toThrow(/alterou PropriedadeNome/);
  });

  it("aplica assertTestCarId antes de qualquer acesso", async () => {
    let buscarCalls = 0;
    const client: PrepareProjectClient = {
      buscar: async () => {
        buscarCalls += 1;
        return requirement();
      },
      buscarStatus: unreachable("buscarStatus"),
      get: unreachable("get"),
      post: unreachable("post"),
      listarMunicipios: unreachable("listarMunicipios"),
    };

    await expect(
      prepareTestProject({ carId: "999", shape: shape(), client }),
    ).rejects.toThrow(/projeto-teste/);
    expect(buscarCalls).toBe(0);
  });
});
