/**
 * Probe LIVE e reversível dos endpoints de escrita usados por prepare-project.
 *
 * Uso (credenciais sempre via env gitignored):
 *   SIMCAR_LIVE=1 npx tsx backend/simcar-oraculo/scripts/probe-escrita.ts
 */
import { assertTestCarId, getSimcarOraculoConfig } from "../config";
import {
  simcarBuscar,
  simcarBuscarStatusProcessamento,
  simcarGet,
  simcarPost,
  withSimcarAuthRetry,
} from "../client";
import { listarMunicipiosMtLocais, normalizarNomeMunicipio } from "../municipio-mt";

type Requirement = Record<string, any>;
type Bbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const nearlyEqual = (a: unknown, b: number) => Math.abs(Number(a) - b) <= 1e-9;

function requireLiveGuard(): string {
  if (process.env.SIMCAR_LIVE !== "1") {
    throw new Error("Probe bloqueado: defina SIMCAR_LIVE=1 conscientemente.");
  }
  const id = assertTestCarId(getSimcarOraculoConfig().testCarId);
  if (id !== "270069") {
    throw new Error(`Probe bloqueado: CAR-teste esperado 270069; configurado ${id}.`);
  }
  return id;
}

async function authenticated<T>(operation: (token: string) => Promise<T>): Promise<T> {
  return withSimcarAuthRetry(operation);
}

async function buscar(carId: string): Promise<Requirement> {
  return authenticated((token) => simcarBuscar(token, carId)) as Promise<Requirement>;
}

async function waitFor(
  label: string,
  read: () => Promise<Requirement>,
  predicate: (value: Requirement) => boolean,
  timeoutMs = 30_000,
): Promise<Requirement> {
  const started = Date.now();
  let last: Requirement = {};
  while (Date.now() - started <= timeoutMs) {
    last = await read();
    if (predicate(last)) return last;
    await sleep(1_000);
  }
  throw new Error(`${label} não se confirmou em ${timeoutMs}ms.`);
}

function bboxOf(req: Requirement): Bbox {
  const bbox = {
    minLat: Number(req.MenorLatitudeGdec),
    minLon: Number(req.MenorLongitudeGdec),
    maxLat: Number(req.MaiorLatitudeGdec),
    maxLon: Number(req.MaiorLongitudeGdec),
  };
  if (!Object.values(bbox).every(Number.isFinite)) {
    throw new Error("Buscar não retornou uma abrangência numérica completa.");
  }
  return bbox;
}

function bboxMatches(req: Requirement, bbox: Bbox): boolean {
  return (
    nearlyEqual(req.MenorLatitudeGdec, bbox.minLat) &&
    nearlyEqual(req.MenorLongitudeGdec, bbox.minLon) &&
    nearlyEqual(req.MaiorLatitudeGdec, bbox.maxLat) &&
    nearlyEqual(req.MaiorLongitudeGdec, bbox.maxLon)
  );
}

async function saveArea(carId: string, bbox: Bbox): Promise<void> {
  await authenticated((token) =>
    simcarPost(token, "Requerimento/SalvarAreaAbrangencia", {
      Id: Number(carId),
      MenorLatitudeGdec: bbox.minLat,
      MenorLongitudeGdec: bbox.minLon,
      MaiorLatitudeGdec: bbox.maxLat,
      MaiorLongitudeGdec: bbox.maxLon,
    }),
  );
}

async function observeBaseRef(
  carId: string,
  maxWaitMs: number,
): Promise<{ statuses: string[]; elapsedMs: number; final: string | null }> {
  const started = Date.now();
  const statuses: string[] = [];
  let nullPolls = 0;
  while (Date.now() - started <= maxWaitMs) {
    const status = (await authenticated((token) =>
      simcarBuscarStatusProcessamento(token, carId),
    )) as Requirement;
    const current = status.BaseRefStatus == null ? null : String(status.BaseRefStatus);
    const label = current || "null";
    if (statuses.at(-1) !== label) statuses.push(label);
    if (current?.includes("ERRO")) throw new Error(`BaseRef terminou em erro: ${status.BaseRefDetalhes}`);
    if (current?.includes("CONCLUIDO")) {
      return { statuses, elapsedMs: Date.now() - started, final: current };
    }
    if (current == null) {
      nullPolls += 1;
      if (nullPolls >= 3) return { statuses, elapsedMs: Date.now() - started, final: null };
    } else {
      nullPolls = 0;
    }
    await sleep(Math.max(1_000, getSimcarOraculoConfig().pollMs));
  }
  throw new Error(`BaseRef não concluiu em ${maxWaitMs}ms (estados: ${statuses.join("→")}).`);
}

async function main(): Promise<void> {
  const carId = requireLiveGuard();
  const initial = await buscar(carId);
  const originalName = String(initial.PropriedadeNome ?? "");
  const originalMunicipio = structuredClone(initial.Municipio);
  const originalBbox = bboxOf(initial);
  if (!originalName || String(initial.Id) !== carId) {
    throw new Error("Snapshot inicial inesperado; nenhuma mutação foi feita.");
  }

  const localCanarana = listarMunicipiosMtLocais().find((item) => item.ibge === "5102702");
  const rawMunicipios = (await authenticated((token) =>
    simcarGet(token, "Municipio/ListarMatoGrosso"),
  )) as any[];
  const simcarCanarana = rawMunicipios.find(
    (item) => normalizarNomeMunicipio(item?.Texto) === "CANARANA",
  );
  if (!localCanarana || !simcarCanarana) throw new Error("Canarana não foi localizada nas listas.");

  let municipioReverted = false;
  let areaReverted = false;
  const report: Record<string, unknown> = {
    carId,
    propriedadeNome: originalName,
    municipioOriginal: {
      id: originalMunicipio?.Id,
      nome: originalMunicipio?.Texto,
      ibge: originalMunicipio?.Codigo,
    },
    bboxOriginal: originalBbox,
  };

  try {
    const targetMunicipio = {
      ...structuredClone(originalMunicipio),
      Id: simcarCanarana.Chave,
      Texto: simcarCanarana.Texto,
      Codigo: localCanarana.ibge,
      Texto4Query: normalizarNomeMunicipio(simcarCanarana.Texto).replace(/\s+/g, "_"),
    };
    const propertyPayload: Requirement = {
      ...structuredClone(initial),
      Municipio: targetMunicipio,
    };
    if (propertyPayload.PropriedadeNome !== originalName) {
      throw new Error("Guard PropriedadeNome falhou antes de SalvarGrupoPropriedade.");
    }
    await authenticated((token) =>
      simcarPost(token, "Requerimento/SalvarGrupoPropriedade", propertyPayload),
    );
    const changed = await waitFor(
      "mudança para Canarana",
      () => buscar(carId),
      (req) => String(req.Municipio?.Codigo) === localCanarana.ibge,
    );
    if (String(changed.PropriedadeNome) !== originalName) {
      throw new Error("PropriedadeNome foi alterado pelo save; probe interrompido para restauração.");
    }
    report.municipioAlterado = {
      id: changed.Municipio?.Id,
      nome: changed.Municipio?.Texto,
      ibge: changed.Municipio?.Codigo,
      propriedadeNomeIntacto: changed.PropriedadeNome === originalName,
    };

    const revertPayload = {
      ...structuredClone(changed),
      PropriedadeNome: originalName,
      Municipio: originalMunicipio,
    };
    await authenticated((token) =>
      simcarPost(token, "Requerimento/SalvarGrupoPropriedade", revertPayload),
    );
    const reverted = await waitFor(
      "reversão do município",
      () => buscar(carId),
      (req) => String(req.Municipio?.Codigo) === String(originalMunicipio?.Codigo),
    );
    municipioReverted =
      String(reverted.PropriedadeNome) === originalName &&
      String(reverted.Municipio?.Codigo) === String(originalMunicipio?.Codigo);
    report.municipioRevertido = municipioReverted;
    if (!municipioReverted) throw new Error("Reversão do município não foi confirmada.");

    const expandedBbox: Bbox = {
      minLat: originalBbox.minLat - 0.01,
      minLon: originalBbox.minLon - 0.01,
      maxLat: originalBbox.maxLat + 0.01,
      maxLon: originalBbox.maxLon + 0.01,
    };
    const areaStarted = Date.now();
    await saveArea(carId, expandedBbox);
    const changedArea = await waitFor(
      "sobrescrita direta da abrangência",
      () => buscar(carId),
      (req) => bboxMatches(req, expandedBbox),
    );
    report.abrangenciaAlterada = {
      bbox: bboxOf(changedArea),
      confirmouEmMs: Date.now() - areaStarted,
      precisouLimpar: false,
    };
    report.baseRefAposAlterar = await observeBaseRef(
      carId,
      getSimcarOraculoConfig().processTimeoutMs,
    );

    const restoreStarted = Date.now();
    await saveArea(carId, originalBbox);
    await waitFor(
      "restauração da abrangência",
      () => buscar(carId),
      (req) => bboxMatches(req, originalBbox),
    );
    areaReverted = true;
    report.abrangenciaRevertida = {
      ok: true,
      confirmouEmMs: Date.now() - restoreStarted,
      bbox: originalBbox,
    };
    report.baseRefAposRestaurar = await observeBaseRef(
      carId,
      getSimcarOraculoConfig().processTimeoutMs,
    );
  } finally {
    if (!municipioReverted) {
      const current = await buscar(carId).catch(() => null);
      if (current) {
        const fallbackPayload = {
          ...structuredClone(current),
          PropriedadeNome: originalName,
          Municipio: originalMunicipio,
        };
        await authenticated((token) =>
          simcarPost(token, "Requerimento/SalvarGrupoPropriedade", fallbackPayload),
        );
        await waitFor(
          "reversão de emergência do município",
          () => buscar(carId),
          (req) => String(req.Municipio?.Codigo) === String(originalMunicipio?.Codigo),
        );
      }
    }
    if (!areaReverted) {
      const current = await buscar(carId).catch(() => null);
      if (current && !bboxMatches(current, originalBbox)) {
        await saveArea(carId, originalBbox);
        await waitFor(
          "reversão de emergência da abrangência",
          () => buscar(carId),
          (req) => bboxMatches(req, originalBbox),
        );
      }
    }
  }

  const final = await buscar(carId);
  report.estadoFinal = {
    propriedadeNome: final.PropriedadeNome,
    municipio: final.Municipio?.Texto,
    ibge: final.Municipio?.Codigo,
    bboxRestaurado: bboxMatches(final, originalBbox),
  };
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error(`PROBE_ESCRITA_FALHOU: ${error?.message || error}`);
  process.exitCode = 1;
});
