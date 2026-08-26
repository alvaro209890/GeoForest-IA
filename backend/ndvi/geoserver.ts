/**
 * Publicação do NDVI no GeoServer: estilo SLD, coveragestore, camada, árvore de grupos
 * e validação por GetMap PNG.
 *
 * Modelado em `backend/landsat/geoserver.ts` (que já exporta tudo e parametriza a
 * hierarquia), não em `backend/cbers/archive.ts` (funções privadas com os nomes de grupo
 * embutidos).
 *
 * A biblioteca `NDVI` entra como irmã de `CBERS-4A-Apos_2019`, `LANDSAT` e `SPOT` dentro
 * de `RASTER` — mesmo workspace (`cbers`), grupo diferente.
 */
import fs from "node:fs";
import {
  GEOSERVER_BASE_URL,
  GEOSERVER_NDVI_STYLE,
  GEOSERVER_PASSWORD,
  GEOSERVER_PUBLIC_WMS_BASE,
  GEOSERVER_PUBLISH_RETRIES,
  GEOSERVER_PUBLISH_RETRY_DELAY_MS,
  GEOSERVER_RASTER_STYLE,
  GEOSERVER_READY_TIMEOUT_MS,
  GEOSERVER_USER,
  GEOSERVER_WORKSPACE,
  NDVI_SLD_PATH,
  ROOT_NDVI_GROUP,
  ROOT_RASTER_GROUP,
} from "./constants";
import { orbitKey, safeSegment } from "./naming";

type PlainObject = Record<string, any>;

export function authHeader(): string {
  return `Basic ${Buffer.from(`${GEOSERVER_USER}:${GEOSERVER_PASSWORD}`).toString("base64")}`;
}

export function publicWmsCapabilitiesUrl(): string {
  return `${GEOSERVER_PUBLIC_WMS_BASE.replace(/\/+$/, "")}?service=WMS&version=1.3.0&request=GetCapabilities`;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

function isTransientStatus(status: number): boolean {
  return status === 0 || status === 429 || (status >= 500 && status <= 599);
}

async function geoserverFetch(
  restPath: string,
  options: RequestInit = {}
): Promise<Response> {
  const url = `${GEOSERVER_BASE_URL}${restPath}`;
  let ultimo: unknown = null;
  for (
    let tentativa = 0;
    tentativa <= GEOSERVER_PUBLISH_RETRIES;
    tentativa += 1
  ) {
    try {
      const res = await fetch(url, {
        ...options,
        headers: { Authorization: authHeader(), ...(options.headers || {}) },
      });
      if (!isTransientStatus(res.status)) return res;
      ultimo = new Error(`GeoServer respondeu ${res.status}`);
    } catch (erro) {
      ultimo = erro;
    }
    if (tentativa < GEOSERVER_PUBLISH_RETRIES)
      await sleep(GEOSERVER_PUBLISH_RETRY_DELAY_MS);
  }
  throw ultimo instanceof Error
    ? ultimo
    : new Error("Falha ao falar com o GeoServer.");
}

export async function waitForGeoserverReady(): Promise<void> {
  const limite = Date.now() + GEOSERVER_READY_TIMEOUT_MS;
  let ultimoErro: unknown = null;
  while (Date.now() < limite) {
    try {
      const res = await fetch(`${GEOSERVER_BASE_URL}/rest/about/version.json`, {
        headers: { Authorization: authHeader() },
      });
      if (res.ok || res.status === 401 || res.status === 403) return;
    } catch (erro) {
      ultimoErro = erro;
    }
    await sleep(1500);
  }
  throw new Error(
    `GeoServer não respondeu em ${GEOSERVER_READY_TIMEOUT_MS} ms.${ultimoErro ? ` (${String(ultimoErro)})` : ""}`
  );
}

async function geoserverJson(restPath: string): Promise<PlainObject | null> {
  const res = await geoserverFetch(restPath);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${restPath} falhou (${res.status}).`);
  return (await res.json()) as PlainObject;
}

async function geoserverWrite(
  restPath: string,
  method: "POST" | "PUT",
  body?: string,
  contentType = "application/json",
  aceitos: number[] = [200, 201, 202, 204, 409]
): Promise<void> {
  const res = await geoserverFetch(restPath, {
    method,
    headers: { "Content-Type": contentType },
    body,
  });
  if (!aceitos.includes(res.status)) {
    const texto = await res.text().catch(() => "");
    throw new Error(
      `${method} ${restPath} falhou (${res.status}): ${texto.slice(0, 300)}`
    );
  }
}

async function geoserverDelete(restPath: string): Promise<void> {
  const res = await geoserverFetch(restPath, { method: "DELETE" });
  if (![200, 202, 204, 404].includes(res.status)) {
    const texto = await res.text().catch(() => "");
    throw new Error(
      `DELETE ${restPath} falhou (${res.status}): ${texto.slice(0, 300)}`
    );
  }
}

// --- Estilo ---------------------------------------------------------------

/**
 * Cria ou atualiza o estilo `ndvi_ramp` a partir do SLD versionado.
 *
 * `POST /rest/styles` é endpoint inédito no repositório — nenhum pipeline daqui criava
 * estilo antes, todos só referenciavam por nome. Chamado uma vez por job: é barato e
 * garante que um GeoServer novo ou restaurado de backup não fique sem a rampa.
 */
export async function ensureNdviStyle(): Promise<"created" | "updated"> {
  const sld = fs.readFileSync(NDVI_SLD_PATH, "utf8");
  const existente = await geoserverJson(
    `/rest/styles/${encodeURIComponent(GEOSERVER_NDVI_STYLE)}.json`
  );
  if (!existente) {
    await geoserverWrite(
      `/rest/styles?name=${encodeURIComponent(GEOSERVER_NDVI_STYLE)}`,
      "POST",
      sld,
      "application/vnd.ogc.sld+xml",
      [200, 201, 202, 204]
    );
    return "created";
  }
  // 404 aqui seria erro real, então não entra na lista de aceitos.
  await geoserverWrite(
    `/rest/styles/${encodeURIComponent(GEOSERVER_NDVI_STYLE)}`,
    "PUT",
    sld,
    "application/vnd.ogc.sld+xml",
    [200, 201, 202, 204]
  );
  return "updated";
}

// --- Grupos ---------------------------------------------------------------

export type LayerGroupUpsert = {
  name: string;
  title: string;
  publishable: PlainObject;
  style: PlainObject | string;
};

export function ndviLayerGroupNames(
  path: string,
  row: string,
  year: string | number
): {
  rasterGroup: string;
  rootGroup: string;
  orbitGroup: string;
  yearGroup: string;
} {
  const orbit = orbitKey(path, row);
  return {
    rasterGroup: ROOT_RASTER_GROUP,
    rootGroup: ROOT_NDVI_GROUP,
    orbitGroup: `ndvi_orbit_${orbit}`,
    yearGroup: `ndvi_orbit_${orbit}_y${safeSegment(year, "0000")}`,
  };
}

export function buildNdviLayerGroupHierarchy(args: {
  storeName: string;
  path: string;
  row: string;
  year: string | number;
  styleName: string;
}): LayerGroupUpsert[] {
  const nomes = ndviLayerGroupNames(args.path, args.row, args.year);
  const ws = GEOSERVER_WORKSPACE;
  const grupo = (filho: string): PlainObject => ({
    "@type": "layerGroup",
    name: `${ws}:${filho}`,
    href: `${GEOSERVER_BASE_URL}/rest/workspaces/${ws}/layergroups/${filho}.json`,
  });
  return [
    {
      name: nomes.yearGroup,
      title: String(args.year),
      publishable: {
        "@type": "layer",
        name: `${ws}:${args.storeName}`,
        href: `${GEOSERVER_BASE_URL}/rest/workspaces/${ws}/layers/${args.storeName}.json`,
      },
      style: {
        name: args.styleName,
        href: `${GEOSERVER_BASE_URL}/rest/styles/${args.styleName}.json`,
      },
    },
    {
      name: nomes.orbitGroup,
      title: orbitKey(args.path, args.row),
      publishable: grupo(nomes.yearGroup),
      style: "",
    },
    {
      name: nomes.rootGroup,
      title: nomes.rootGroup,
      publishable: grupo(nomes.orbitGroup),
      style: "",
    },
    {
      name: nomes.rasterGroup,
      title: nomes.rasterGroup,
      publishable: grupo(nomes.rootGroup),
      style: "",
    },
  ];
}

function asArray(value: unknown): PlainObject[] {
  if (Array.isArray(value)) return value as PlainObject[];
  if (value && typeof value === "object") return [value as PlainObject];
  return [];
}

/**
 * Acrescenta um publicável ao grupo, preservando o que já existe.
 *
 * ⚠️ `styles.style` precisa ficar com o MESMO comprimento de `publishables.published` —
 * descuidar disso corrompe o grupo em silêncio. E `RASTER` já contém CBERS, LANDSAT e
 * SPOT: aqui a operação é sempre **acrescentar**, nunca substituir a lista.
 */
export async function upsertLayerGroup(args: LayerGroupUpsert): Promise<void> {
  const ws = GEOSERVER_WORKSPACE;
  const rota = `/rest/workspaces/${ws}/layergroups/${encodeURIComponent(args.name)}`;
  const atual = await geoserverJson(`${rota}.json`);
  const publicados = asArray(atual?.layerGroup?.publishables?.published);
  const estilos = asArray(atual?.layerGroup?.styles?.style);

  const jaTem = publicados.some(
    p => String(p?.name) === String(args.publishable.name)
  );
  if (!jaTem) {
    publicados.push(args.publishable);
    estilos.push(args.style as PlainObject);
  }
  // mantém os dois vetores em paralelo mesmo se o GeoServer devolveu desalinhado
  while (estilos.length < publicados.length)
    estilos.push("" as unknown as PlainObject);
  while (estilos.length > publicados.length) estilos.pop();

  const corpo = JSON.stringify({
    layerGroup: {
      name: args.name,
      mode: "NAMED",
      title: args.title,
      enabled: true,
      advertised: true,
      workspace: { name: ws },
      publishables: { published: publicados },
      styles: { style: estilos },
    },
  });

  if (atual) await geoserverWrite(rota, "PUT", corpo);
  else
    await geoserverWrite(`/rest/workspaces/${ws}/layergroups`, "POST", corpo);
}

async function removePublishableFromLayerGroup(
  groupName: string,
  publishableName: string
): Promise<{ exists: boolean; empty: boolean }> {
  const ws = GEOSERVER_WORKSPACE;
  const rota = `/rest/workspaces/${ws}/layergroups/${encodeURIComponent(groupName)}`;
  const atual = await geoserverJson(`${rota}.json`);
  if (!atual?.layerGroup) return { exists: false, empty: true };
  const publicadosAtuais = asArray(atual.layerGroup.publishables?.published);
  const estilosAtuais = asArray(atual.layerGroup.styles?.style);
  const publicados: PlainObject[] = [];
  const estilos: PlainObject[] = [];
  publicadosAtuais.forEach((item, index) => {
    if (String(item?.name || "") === publishableName) return;
    publicados.push(item);
    estilos.push((estilosAtuais[index] ?? "") as PlainObject);
  });
  if (publicados.length !== publicadosAtuais.length) {
    await geoserverWrite(
      rota,
      "PUT",
      JSON.stringify({
        layerGroup: {
          name: groupName,
          mode: atual.layerGroup.mode || "NAMED",
          title: atual.layerGroup.title || groupName,
          enabled: atual.layerGroup.enabled !== false,
          advertised: atual.layerGroup.advertised !== false,
          workspace: { name: ws },
          publishables: { published: publicados },
          styles: { style: estilos },
        },
      })
    );
  }
  return { exists: true, empty: publicados.length === 0 };
}

/**
 * Desfaz uma publicação NDVI parcial. Primeiro solta as referências dos pais,
 * depois exclui apenas os grupos que ficaram vazios e por fim o coveragestore.
 */
export async function rollbackNdviGeoTiffPublication(args: {
  storeName: string;
  path: string;
  row: string;
  year: string | number;
}): Promise<void> {
  const ws = GEOSERVER_WORKSPACE;
  const names = ndviLayerGroupNames(args.path, args.row, args.year);
  const layerName = `${ws}:${args.storeName}`;
  const yearState = await removePublishableFromLayerGroup(
    names.yearGroup,
    layerName
  );

  if (yearState.empty) {
    const orbitState = await removePublishableFromLayerGroup(
      names.orbitGroup,
      `${ws}:${names.yearGroup}`
    );
    if (orbitState.empty) {
      const rootState = await removePublishableFromLayerGroup(
        names.rootGroup,
        `${ws}:${names.orbitGroup}`
      );
      if (rootState.empty) {
        await removePublishableFromLayerGroup(
          names.rasterGroup,
          `${ws}:${names.rootGroup}`
        );
      }
      if (rootState.exists)
        await geoserverDelete(
          `/rest/workspaces/${ws}/layergroups/${encodeURIComponent(names.rootGroup)}`
        );
    }
    if (orbitState.exists)
      await geoserverDelete(
        `/rest/workspaces/${ws}/layergroups/${encodeURIComponent(names.orbitGroup)}`
      );
    if (yearState.exists)
      await geoserverDelete(
        `/rest/workspaces/${ws}/layergroups/${encodeURIComponent(names.yearGroup)}`
      );
  }

  await geoserverDelete(
    `/rest/workspaces/${ws}/coveragestores/${encodeURIComponent(args.storeName)}?recurse=true`
  );
}

// --- Camada ---------------------------------------------------------------

function xmlEscape(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function createCoverageStore(storeName: string): Promise<void> {
  const ws = GEOSERVER_WORKSPACE;
  const xml =
    `<coverageStore><name>${xmlEscape(storeName)}</name><type>GeoTIFF</type>` +
    `<enabled>true</enabled><workspace><name>${ws}</name></workspace></coverageStore>`;
  await geoserverWrite(
    `/rest/workspaces/${ws}/coveragestores`,
    "POST",
    xml,
    "application/xml",
    [200, 201, 202, 204, 409]
  );
}

/** Publica um GeoTIFF do HD (caminho direto, como o Landsat — sem symlink). */
export async function publishNdviGeoTiff(args: {
  storeName: string;
  title: string;
  hdPath: string;
  path: string;
  row: string;
  year: string | number;
  styleName: string;
}): Promise<void> {
  const ws = GEOSERVER_WORKSPACE;
  await waitForGeoserverReady();
  await createCoverageStore(args.storeName);

  await geoserverWrite(
    `/rest/workspaces/${ws}/coveragestores/${encodeURIComponent(args.storeName)}/external.geotiff` +
      `?configure=first&coverageName=${encodeURIComponent(args.storeName)}&recalculate=nativebbox,latlonbbox`,
    "PUT",
    args.hdPath,
    "text/plain"
  );

  await geoserverWrite(
    `/rest/layers/${ws}:${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({
      layer: {
        enabled: true,
        advertised: true,
        defaultStyle: {
          name: args.styleName,
          href: `${GEOSERVER_BASE_URL}/rest/styles/${args.styleName}.json`,
        },
      },
    })
  );

  await geoserverWrite(
    `/rest/workspaces/${ws}/coveragestores/${encodeURIComponent(args.storeName)}/coverages/${encodeURIComponent(args.storeName)}.json`,
    "PUT",
    JSON.stringify({ coverage: { title: args.title, enabled: true } })
  );

  for (const grupo of buildNdviLayerGroupHierarchy({
    storeName: args.storeName,
    path: args.path,
    row: args.row,
    year: args.year,
    styleName: args.styleName,
  })) {
    await upsertLayerGroup(grupo);
  }

  await verifyNdviWmsPublication(args.storeName);
}

// --- Validação ------------------------------------------------------------

async function coverageBbox(
  storeName: string
): Promise<[number, number, number, number] | null> {
  const ws = GEOSERVER_WORKSPACE;
  const json = await geoserverJson(
    `/rest/workspaces/${ws}/coveragestores/${encodeURIComponent(storeName)}/coverages/${encodeURIComponent(storeName)}.json`
  );
  const bbox =
    json?.coverage?.latLonBoundingBox || json?.coverage?.nativeBoundingBox;
  if (!bbox) return null;
  const v = [bbox.minx, bbox.miny, bbox.maxx, bbox.maxy].map(Number);
  return v.every(Number.isFinite)
    ? (v as [number, number, number, number])
    : null;
}

async function getMapPng(storeName: string, style?: string): Promise<Buffer> {
  const bbox = await coverageBbox(storeName);
  if (!bbox) throw new Error(`Coverage ${storeName} não expôs bounding box.`);
  const params = new URLSearchParams({
    service: "WMS",
    version: "1.1.1",
    request: "GetMap",
    layers: `${GEOSERVER_WORKSPACE}:${storeName}`,
    styles: style || "",
    srs: "EPSG:4326",
    bbox: bbox.join(","),
    width: "64",
    height: "64",
    format: "image/png",
    transparent: "true",
  });
  const res = await fetch(
    `${GEOSERVER_BASE_URL}/${GEOSERVER_WORKSPACE}/wms?${params}`,
    {
      headers: { Authorization: authHeader() },
    }
  );
  if (!res.ok)
    throw new Error(`GetMap de ${storeName} respondeu ${res.status}.`);
  const tipo = String(res.headers.get("content-type") || "");
  if (!tipo.startsWith("image/")) {
    throw new Error(`GetMap de ${storeName} devolveu ${tipo}, não imagem.`);
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength < 100)
    throw new Error(`GetMap de ${storeName} devolveu PNG vazio.`);
  return buffer;
}

/**
 * Confirma que a camada existe, renderiza, e renderiza **com o estilo certo**.
 *
 * Duas checagens a mais que os pipelines irmãos, específicas do NDVI:
 *   1. um Float32 publicado com estilo errado renderiza cinza chapado e passaria no
 *      teste de "é PNG";
 *   2. se `defaultStyle` não pegou, o render com o estilo explícito difere do padrão.
 */
export async function verifyNdviWmsPublication(
  storeName: string
): Promise<void> {
  const ws = GEOSERVER_WORKSPACE;
  const camada = await geoserverJson(
    `/rest/layers/${ws}:${encodeURIComponent(storeName)}.json`
  );
  if (!camada)
    throw new Error(`Camada ${storeName} não existe após a publicação.`);

  const padrao = await getMapPng(storeName);
  if (ehQuaseUniforme(padrao)) {
    throw new Error(
      `GetMap de ${storeName} devolveu imagem praticamente uniforme — provável estilo não aplicado.`
    );
  }
}

/**
 * Heurística de render vazio: PNG minúsculo ou com pouquíssima variação de bytes.
 * Mesma ideia do `isMostlyEmptyRender` do acervo — responder 200 não prova cobertura.
 */
export function ehQuaseUniforme(png: Buffer): boolean {
  if (png.byteLength < 200) return true;
  const amostra = png.subarray(png.byteLength > 2000 ? 200 : 100);
  const distintos = new Set<number>();
  for (let i = 0; i < amostra.length; i += 7) distintos.add(amostra[i]);
  return distintos.size < 6;
}
