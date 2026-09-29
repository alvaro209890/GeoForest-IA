import { afterEach, describe, expect, it, vi } from "vitest";
import { describeOsrmFailure, fetchDrivingRoutes, OsrmRequestError } from "./routing";

// Respostas reais do router.project-osrm.org (conferidas em 29/09/2026).
const NO_SEGMENT = { code: "NoSegment", message: "Could not find a matching segment for any coordinate." };
const NO_ROUTE = { code: "NoRoute", message: "Impossible route between points" };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OSRM — motivo real da falha", () => {
  it("traduz NoSegment e NoRoute sem perder o código do OSRM", () => {
    expect(describeOsrmFailure(400, NO_SEGMENT)).toMatch(/longe demais de qualquer via/);
    expect(describeOsrmFailure(400, NO_SEGMENT)).toContain("NoSegment");
    expect(describeOsrmFailure(400, NO_ROUTE)).toMatch(/Não existe rota viária/);
    expect(describeOsrmFailure(400, null)).toContain("OSRM 400");
  });

  it("4xx do OSRM não é repetido e chega com o motivo real", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(400, NO_SEGMENT));
    vi.stubGlobal("fetch", fetchMock);

    const erro = await fetchDrivingRoutes([
      [-51.8, -13.0],
      [-51.81, -13.01],
    ]).catch((e) => e);

    expect(erro).toBeInstanceOf(OsrmRequestError);
    expect(erro.osrmCode).toBe("NoSegment");
    expect(erro.message).toMatch(/longe demais de qualquer via/);
    // antes: 3 tentativas com sleep de 1 s + 2 s (os ~3,8 s vistos nos 400 de produção)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("200 com code != Ok também devolve o motivo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, NO_ROUTE)));
    await expect(
      fetchDrivingRoutes([
        [-51.8, -13.0],
        [-51.81, -13.01],
      ]),
    ).rejects.toThrow(/Não existe rota viária/);
  });
});
