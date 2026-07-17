import { booleanPointInPolygon, feature, point } from "@turf/turf";
import type { Geometry, MultiPolygon, Polygon } from "geojson";
import { assertTestCarId, getSimcarOraculoConfig } from "./config";
import {
  simcarBuscar,
  simcarBuscarStatusProcessamento,
  simcarGet,
  simcarPost,
  withSimcarAuthRetry,
} from "./client";
import {
  listarMunicipiosSimcar,
  normalizarNomeMunicipio,
  type MunicipioSimcarOption,
} from "./municipio-mt";
import type { OraculoProgress, ShapeContext } from "./types";

type Requirement = Record<string, any>;
type RequestBbox = {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
};

export type PrepareProjectClient = {
  buscar: (carId: string) => Promise<Requirement>;
  buscarStatus: (carId: string) => Promise<Requirement>;
  get: (pathname: string) => Promise<unknown>;
  post: (pathname: string, payload?: unknown) => Promise<unknown>;
  listarMunicipios: () => Promise<MunicipioSimcarOption[]>;
};

export type PrepareProjectResult = {
  municipioAntes: string;
  municipioDepois: string;
  municipioChanged: boolean;
  abrangenciaChanged: boolean;
  baserefWaitedMs: number;
  warnings: string[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function defaultClient(): PrepareProjectClient {
  return {
    buscar: (carId) =>
      withSimcarAuthRetry((token) => simcarBuscar(token, carId)) as Promise<Requirement>,
    buscarStatus: (carId) =>
      withSimcarAuthRetry((token) =>
        simcarBuscarStatusProcessamento(token, carId),
      ) as Promise<Requirement>,
    get: (pathname) => withSimcarAuthRetry((token) => simcarGet(token, pathname)),
    post: (pathname, payload) =>
      withSimcarAuthRetry((token) => simcarPost(token, pathname, payload)),
    listarMunicipios: () => listarMunicipiosSimcar(),
  };
}

function validGeographicBbox(bbox: ShapeContext["bbox"]): boolean {
  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  return (
    [minLon, minLat, maxLon, maxLat].every(Number.isFinite) &&
    minLon >= -180 &&
    maxLon <= 180 &&
    minLat >= -90 &&
    maxLat <= 90 &&
    minLon < maxLon &&
    minLat < maxLat
  );
}

export function expandBboxMeters(
  bbox: ShapeContext["bbox"],
  meters: number,
): ShapeContext["bbox"] {
  const [minLon, minLat, maxLon, maxLat] = bbox.map(Number);
  const midLat = (minLat + maxLat) / 2;
  const latDegrees = Math.max(0, meters) / 111_320;
  const cosLat = Math.max(0.1, Math.abs(Math.cos((midLat * Math.PI) / 180)));
  const lonDegrees = Math.max(0, meters) / (111_320 * cosLat);
  return [
    minLon - lonDegrees,
    minLat - latDegrees,
    maxLon + lonDegrees,
    maxLat + latDegrees,
  ];
}

export function requestBbox(req: Requirement): RequestBbox | null {
  const bbox = {
    minLat: Number(req.MenorLatitudeGdec),
    minLon: Number(req.MenorLongitudeGdec),
    maxLat: Number(req.MaiorLatitudeGdec),
    maxLon: Number(req.MaiorLongitudeGdec),
  };
  return Object.values(bbox).every(Number.isFinite) ? bbox : null;
}

export function coversShapeBbox(
  req: Requirement,
  shapeBbox: ShapeContext["bbox"],
  marginM: number,
): boolean {
  const current = requestBbox(req);
  if (!current || !validGeographicBbox(shapeBbox)) return false;
  const [targetMinLon, targetMinLat, targetMaxLon, targetMaxLat] = expandBboxMeters(
    shapeBbox,
    marginM,
  );
  const epsilon = 1e-10;
  return (
    current.minLon <= targetMinLon + epsilon &&
    current.minLat <= targetMinLat + epsilon &&
    current.maxLon >= targetMaxLon - epsilon &&
    current.maxLat >= targetMaxLat - epsilon
  );
}

function bboxPayload(carId: string, bbox: ShapeContext["bbox"]): Requirement {
  return {
    Id: Number(carId),
    MenorLongitudeGdec: bbox[0],
    MenorLatitudeGdec: bbox[1],
    MaiorLongitudeGdec: bbox[2],
    MaiorLatitudeGdec: bbox[3],
  };
}

function requestMatchesBbox(req: Requirement, bbox: ShapeContext["bbox"]): boolean {
  const current = requestBbox(req);
  if (!current) return false;
  const expected = bboxPayload(String(req.Id || 0), bbox);
  return (
    Math.abs(current.minLon - expected.MenorLongitudeGdec) <= 1e-9 &&
    Math.abs(current.minLat - expected.MenorLatitudeGdec) <= 1e-9 &&
    Math.abs(current.maxLon - expected.MaiorLongitudeGdec) <= 1e-9 &&
    Math.abs(current.maxLat - expected.MaiorLatitudeGdec) <= 1e-9
  );
}

async function waitForRequest(
  client: PrepareProjectClient,
  carId: string,
  predicate: (req: Requirement) => boolean,
  label: string,
): Promise<Requirement> {
  const started = Date.now();
  let last: Requirement = {};
  while (Date.now() - started <= 30_000) {
    last = await client.buscar(carId);
    if (predicate(last)) return last;
    await sleep(Math.min(1_000, getSimcarOraculoConfig().pollMs));
  }
  throw new Error(`${label} não foi confirmado pelo Buscar em 30s.`);
}

function parseOfficialMunicipioGeometry(raw: unknown): Polygon | MultiPolygon {
  const source = raw as Record<string, any>;
  let parsed: any = source?.GeoJson ?? source?.geoJson ?? source;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (parsed?.type === "Feature") parsed = parsed.geometry;
  if (parsed?.type !== "Polygon" && parsed?.type !== "MultiPolygon") {
    throw new Error("BuscarMunicipioGeo não retornou Polygon/MultiPolygon válido.");
  }
  return parsed as Polygon | MultiPolygon;
}

async function confirmOfficialMunicipio(
  client: PrepareProjectClient,
  ibge: string,
  centroid: [number, number],
): Promise<void> {
  const raw = await client.get(`Municipio/BuscarMunicipioGeo/${ibge}`);
  const geometry = parseOfficialMunicipioGeometry(raw);
  const inside = booleanPointInPolygon(
    point(centroid),
    feature(geometry as Geometry) as any,
    { ignoreBoundary: false },
  );
  if (!inside) {
    throw new Error(
      `Centroid do shape não está dentro do polígono oficial SEMA do município ${ibge}.`,
    );
  }
}

async function waitBaseRef(args: {
  client: PrepareProjectClient;
  carId: string;
  onEvent: (event: OraculoProgress) => void;
  warnings: string[];
}): Promise<number> {
  const cfg = getSimcarOraculoConfig();
  const started = Date.now();
  let nullPolls = 0;
  let reprocessed = false;
  while (Date.now() - started <= cfg.baseRefTimeoutMs) {
    const raw = await args.client.buscarStatus(args.carId);
    const status = raw.BaseRefStatus == null ? null : String(raw.BaseRefStatus);
    const detalhes = String(raw.BaseRefDetalhes || "");
    args.onEvent({
      step: "baseref_wait",
      message: status
        ? `Base de referência SEMA: ${status} ${detalhes}`.trim()
        : "Base de referência sem processamento ativo (null).",
      percent: 18,
      data: { BaseRefStatus: status, BaseRefDetalhes: detalhes },
    });
    if (status?.includes("CONCLUIDO")) return Date.now() - started;
    if (status?.includes("ERRO")) {
      if (reprocessed) throw new Error(`BaseRef permaneceu em erro: ${detalhes}`);
      assertTestCarId(args.carId);
      await args.client.post(`Requerimento/ReprocessarBaseRef/${args.carId}`);
      reprocessed = true;
      nullPolls = 0;
    } else if (status == null) {
      nullPolls += 1;
      if (nullPolls >= 3) {
        args.warnings.push("BaseRefStatus permaneceu null após salvar a abrangência.");
        return Date.now() - started;
      }
    } else {
      nullPolls = 0;
    }
    await sleep(cfg.pollMs);
  }
  throw new Error(`Timeout aguardando BaseRef (${cfg.baseRefTimeoutMs}ms).`);
}

export async function prepareTestProject(args: {
  carId?: string;
  shape: ShapeContext;
  onEvent?: (event: OraculoProgress) => void;
  client?: PrepareProjectClient;
}): Promise<PrepareProjectResult> {
  const cfg = getSimcarOraculoConfig();
  const carId = assertTestCarId(args.carId || cfg.testCarId);
  if (!validGeographicBbox(args.shape.bbox)) {
    throw new Error("BBox geográfico do shape é inválido; nenhuma mutação SIMCAR foi feita.");
  }
  const detected = args.shape.municipioDetectado;
  if (!detected?.ibge || !detected.nome || detected.fonte === "nao-detectado") {
    throw new Error("Não detectei o município do shape — selecione manualmente.");
  }
  const client = args.client || defaultClient();
  const onEvent = args.onEvent || (() => undefined);
  const warnings = [...(args.shape.warnings || [])];

  onEvent({ step: "buscar_projeto", message: `Conferindo o CAR-teste ${carId}…`, percent: 5 });
  let req = await client.buscar(carId);
  const originalName = String(req.PropriedadeNome ?? "");
  if (String(req.Id) !== carId || !originalName) {
    throw new Error("Buscar retornou projeto inesperado ou sem PropriedadeNome.");
  }
  const municipioAntes = String(req.Municipio?.Texto || "");
  let municipioDepois = municipioAntes;
  let municipioChanged = false;

  const currentIbge = String(req.Municipio?.Codigo || "");
  onEvent({
    step: "municipio_check",
    message:
      currentIbge === detected.ibge
        ? `Município já é ${municipioAntes}.`
        : `Município do shape: ${detected.nome}; projeto-teste está em ${municipioAntes}.`,
    percent: 8,
    data: { municipioAntes, ibgeAntes: currentIbge, municipioAlvo: detected.nome, ibgeAlvo: detected.ibge },
  });
  if (currentIbge !== detected.ibge) {
    await confirmOfficialMunicipio(client, detected.ibge, args.shape.centroid);
    const options = await client.listarMunicipios();
    const target =
      options.find((item) => item.ibge === detected.ibge) ||
      options.find(
        (item) => normalizarNomeMunicipio(item.nome) === normalizarNomeMunicipio(detected.nome),
      );
    if (!target) throw new Error(`Município ${detected.nome}/${detected.ibge} ausente no SIMCAR.`);

    const targetMunicipio = {
      ...structuredClone(req.Municipio || {}),
      Id: target.chave,
      Texto: target.nome,
      Codigo: detected.ibge,
      Texto4Query: normalizarNomeMunicipio(target.nome).replace(/\s+/g, "_"),
    };
    const payload: Requirement = { ...structuredClone(req), Municipio: targetMunicipio };
    if (String(payload.PropriedadeNome) !== originalName) {
      throw new Error("Guard PropriedadeNome impediu payload alterado.");
    }
    onEvent({
      step: "municipio_saving",
      message: `Ajustando município para ${target.nome}, sem alterar o nome da propriedade…`,
      percent: 10,
    });
    assertTestCarId(carId);
    await client.post("Requerimento/SalvarGrupoPropriedade", payload);
    req = await waitForRequest(
      client,
      carId,
      (next) => String(next.Municipio?.Codigo) === detected.ibge,
      "Mudança de município",
    );
    if (String(req.PropriedadeNome) !== originalName) {
      throw new Error("SEMA alterou PropriedadeNome durante a mudança de município.");
    }
    municipioDepois = String(req.Municipio?.Texto || target.nome);
    municipioChanged = true;
    onEvent({
      step: "municipio_ok",
      message: `Município ajustado para ${municipioDepois}; PropriedadeNome preservado.`,
      percent: 12,
    });
  }

  onEvent({
    step: "abrangencia_check",
    message: "Conferindo se a área de abrangência cobre o shape…",
    percent: 14,
  });
  let abrangenciaChanged = false;
  let baserefWaitedMs = 0;
  if (!coversShapeBbox(req, args.shape.bbox, cfg.abrangenciaMarginM)) {
    const targetBbox = expandBboxMeters(args.shape.bbox, 2_000);
    const payload = bboxPayload(carId, targetBbox);
    onEvent({
      step: "abrangencia_saving",
      message: "Atualizando a área de abrangência do CAR-teste…",
      percent: 16,
      data: { targetBbox },
    });
    let directError: unknown = null;
    try {
      assertTestCarId(carId);
      await client.post("Requerimento/SalvarAreaAbrangencia", payload);
      req = await waitForRequest(
        client,
        carId,
        (next) => requestMatchesBbox(next, targetBbox),
        "Sobrescrita da abrangência",
      );
    } catch (error) {
      directError = error;
    }
    if (directError) {
      warnings.push(
        `Sobrescrita direta da abrangência falhou; Limpar foi necessário: ${
          directError instanceof Error ? directError.message : String(directError)
        }`,
      );
      onEvent({
        step: "abrangencia_saving",
        message: "A SEMA recusou sobrescrever; limpando a abrangência do CAR-teste e tentando novamente…",
        percent: 16,
      });
      assertTestCarId(carId);
      await client.post(`Requerimento/LimparAreaAbrangencia/${carId}`);
      assertTestCarId(carId);
      await client.post("Requerimento/SalvarAreaAbrangencia", payload);
      req = await waitForRequest(
        client,
        carId,
        (next) => requestMatchesBbox(next, targetBbox),
        "Abrangência após Limpar",
      );
    }
    abrangenciaChanged = true;
    baserefWaitedMs = await waitBaseRef({ client, carId, onEvent, warnings });
    onEvent({
      step: "abrangencia_ok",
      message: "Área de abrangência pronta para a importação.",
      percent: 20,
      data: { baserefWaitedMs },
    });
  } else {
    onEvent({
      step: "abrangencia_ok",
      message: "A área de abrangência atual já cobre o shape.",
      percent: 20,
    });
  }

  return {
    municipioAntes,
    municipioDepois,
    municipioChanged,
    abrangenciaChanged,
    baserefWaitedMs,
    warnings,
  };
}
