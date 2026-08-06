/**
 * Tarefa F0.1 do plano `docs/planos/analise-pos-recorte/`: levantamento WMS ao vivo.
 *
 * Faz `GetCapabilities` + um `GetMap` real por candidato (série 2009–2019 da Fase 2
 * e as cenas da Fase 3) sobre uma bbox de teste, mede tempo de resposta, confere
 * magic bytes / dimensão / uniformidade e escreve o relatório em `docs/`.
 *
 * Uso:
 *   npx tsx scripts/levantamento-wms-pos-recorte.ts [--bbox=minX,minY,maxX,maxY]
 *
 * Nenhuma URL com `authkey` é impressa ou gravada.
 */
import fs from "fs";
import path from "path";

import {
  buildYearCatalog,
  computeCatalogVersion,
  listNirStyles,
  parseWmsLayerNames,
  type WmsLayerRef,
} from "../backend/analise-pos-recorte/pos2008/catalog-discovery";
import { buildWmsGetMapUrl, sanitizeWmsUrl } from "../backend/analise-pos-recorte/wms-scenes";
import { detectUniformImage, validateImageMagicBytes } from "../backend/analise-pos-recorte/image-quality";

const SEMA_WMS_BASE = process.env.SEMA_WMS_BASE_URL || "https://geo.sema.mt.gov.br/geoserver/ows";
const SEMA_WMS_AUTHKEY = process.env.SEMA_WMS_AUTHKEY || "541085de-9a2e-454e-bdba-eb3d57a2f492";

/** Bbox padrão: recorte pequeno em área rural de MT, suficiente para validar o mosaico. */
const DEFAULT_BBOX: [number, number, number, number] = [-55.6, -12.6, -55.55, -12.55];
const WIDTH = 800;
const HEIGHT = 800;

type ProbeResult = {
  layer: string;
  style?: string;
  ok: boolean;
  httpStatus: number;
  elapsedMs: number;
  format: string | null;
  width: number | null;
  height: number | null;
  uniform: boolean | null;
  stdDev: number | null;
  note: string;
};

function parseBboxArg(): [number, number, number, number] {
  const arg = process.argv.find((value) => value.startsWith("--bbox="));
  if (!arg) return DEFAULT_BBOX;
  const parts = arg.slice("--bbox=".length).split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new Error("--bbox precisa de 4 números: minX,minY,maxX,maxY");
  }
  return parts as [number, number, number, number];
}

async function fetchCapabilities(): Promise<string> {
  const url = new URL(SEMA_WMS_BASE);
  url.searchParams.set("service", "WMS");
  url.searchParams.set("request", "GetCapabilities");
  url.searchParams.set("version", "1.3.0");
  if (SEMA_WMS_AUTHKEY) url.searchParams.set("authkey", SEMA_WMS_AUTHKEY);
  const started = Date.now();
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error(`GetCapabilities HTTP ${response.status}`);
  const xml = await response.text();
  console.log(`GetCapabilities: ${xml.length} bytes em ${Date.now() - started} ms`);
  return xml;
}

async function probeLayer(
  layer: string,
  bbox: [number, number, number, number],
  style?: string,
): Promise<ProbeResult> {
  const url = buildWmsGetMapUrl([layer], bbox, WIDTH, HEIGHT, "image/png", "EPSG:4326", style ? [style] : undefined);
  const started = Date.now();
  try {
    const response = await fetch(url);
    const elapsedMs = Date.now() - started;
    const buffer = Buffer.from(await response.arrayBuffer());
    const magic = validateImageMagicBytes(buffer);
    if (!response.ok || !magic.valid) {
      const texto = buffer.subarray(0, 300).toString("utf8").replace(/\s+/g, " ").trim();
      return {
        layer,
        style,
        ok: false,
        httpStatus: response.status,
        elapsedMs,
        format: magic.format,
        width: null,
        height: null,
        uniform: null,
        stdDev: null,
        note: magic.valid ? `HTTP ${response.status}` : `resposta não é imagem: ${texto.slice(0, 120)}`,
      };
    }
    const uniformity = await detectUniformImage(buffer);
    return {
      layer,
      style,
      ok: !uniformity.isUniform,
      httpStatus: response.status,
      elapsedMs,
      format: magic.format,
      width: WIDTH,
      height: HEIGHT,
      uniform: uniformity.isUniform,
      stdDev: Number(uniformity.stdDev.toFixed(2)),
      note: uniformity.isUniform ? "imagem uniforme (sem cobertura nesta bbox)" : "ok",
    };
  } catch (error: any) {
    return {
      layer,
      style,
      ok: false,
      httpStatus: 0,
      elapsedMs: Date.now() - started,
      format: null,
      width: null,
      height: null,
      uniform: null,
      stdDev: null,
      note: `falha de rede: ${String(error?.message || error).slice(0, 120)}`,
    };
  }
}

function tabela(results: ProbeResult[]): string {
  const linhas = results.map((r) => {
    const dim = r.width && r.height ? `${r.width}×${r.height}` : "—";
    const status = r.ok ? "✅" : "❌";
    return `| \`${r.layer}\` | ${r.style ? `\`${r.style}\`` : "—"} | ${status} | ${r.httpStatus || "—"} | ${dim} | ${r.stdDev ?? "—"} | ${r.elapsedMs} ms | ${r.note} |`;
  });
  return [
    "| Camada | Estilo | GetMap | HTTP | Dimensão | Desvio-padrão | Tempo | Observação |",
    "|---|---|---|---|---|---|---|---|",
    ...linhas,
  ].join("\n");
}

async function main(): Promise<void> {
  const bbox = parseBboxArg();
  console.log(`Bbox de teste: ${bbox.join(",")} (${WIDTH}×${HEIGHT})`);

  const xml = await fetchCapabilities();
  const names = parseWmsLayerNames(xml);
  const catalog = buildYearCatalog(names, { startYear: 2009, endYear: 2019 });
  const catalogVersion = computeCatalogVersion(catalog);
  const nirStyles = listNirStyles(xml);

  const serie: WmsLayerRef[] = catalog.flatMap((entry) =>
    entry.preferred ? [entry.preferred, ...entry.alternates] : [],
  );
  // Cena NIR: na SEMA o NIR é ESTILO do mosaico RGB do mesmo ano, não camada.
  const nirMaisRecente = nirStyles[0];
  const fase3: Array<{ layer: string; style?: string }> = [
    { layer: "Mosaicos:SENTINEL_2_2024" },
    ...(nirMaisRecente ? [{ layer: nirMaisRecente.layer, style: nirMaisRecente.style }] : []),
    { layer: "Mosaicos:MOSAICO_SPOT_SEPLAN" },
  ];

  const resultadosSerie: ProbeResult[] = [];
  for (const ref of serie) {
    const result = await probeLayer(ref.layer, bbox);
    console.log(`  ${result.ok ? "ok " : "FALHA"} ${ref.year} ${ref.layer} (${result.elapsedMs} ms)`);
    resultadosSerie.push(result);
  }

  const resultadosFase3: ProbeResult[] = [];
  for (const cena of fase3) {
    const result = await probeLayer(cena.layer, bbox, cena.style);
    console.log(
      `  ${result.ok ? "ok " : "FALHA"} F3 ${cena.layer}${cena.style ? ` [${cena.style}]` : ""} (${result.elapsedMs} ms)`,
    );
    resultadosFase3.push(result);
  }

  const okPorCamada = new Map(resultadosSerie.map((r) => [r.layer, r.ok]));
  const linhasSerie = catalog.map((entry) => {
    const preferido = entry.preferred;
    const validado = preferido ? okPorCamada.get(preferido.layer) === true : false;
    const alternativos = entry.alternates.map((alt) => `\`${alt.layer}\``).join(", ") || "—";
    return `| ${entry.year} | ${preferido ? `\`${preferido.layer}\`` : "—"} | ${preferido?.sensor || "—"} | ${
      entry.sensorBoundary ? "⚠️ troca de sensor" : ""
    } | ${validado ? "✅" : "❌"} | ${alternativos} |`;
  });

  const agora = new Date().toISOString();
  const md = `# Levantamento WMS — análise pós-recorte (tarefa F0.1)

> Gerado por \`scripts/levantamento-wms-pos-recorte.ts\` em ${agora}.
> Servidor: \`${sanitizeWmsUrl(new URL(SEMA_WMS_BASE).toString())}\` · bbox de teste
> \`${bbox.join(",")}\` · ${WIDTH}×${HEIGHT} px. Nenhuma URL com \`authkey\` é gravada aqui.

## 1. Série anual da Fase 2 (2009–2019)

\`catalogVersion\`: \`${catalogVersion}\`

| Ano | Mosaico escolhido | Sensor | Fronteira | GetMap validado | Alternativos no mesmo ano |
|---|---|---|---|---|---|
${linhasSerie.join("\n")}

Anos sem mosaico publicado: ${catalog.filter((e) => e.missing).map((e) => e.year).join(", ") || "**nenhum**"}.

### GetMap por camada da série (inclui os alternativos)

${tabela(resultadosSerie)}

## 2. Cenas da Fase 3

${tabela(resultadosFase3)}

### ⚠️ NIR é estilo, não camada

Os "mosaicos NIR" aparecem no \`GetCapabilities\` dentro de \`<Style>\`, não como camada:
pedir \`layers=Mosaicos:Geoportal_Sentinel_2_2021_NIR\` devolve
\`LayerNotDefined\`. A forma correta é
\`layers=<mosaico RGB do ano>&styles=<estilo NIR>\`.

Estilos NIR publicados (estilo → camada):

${nirStyles.map((ref) => `- \`${ref.style}\` → \`${ref.layer}\``).join("\n") || "- nenhum"}

## 3. Como reproduzir

\`\`\`bash
npx tsx scripts/levantamento-wms-pos-recorte.ts --bbox=${bbox.join(",")}
\`\`\`

Uma camada só entra na série quando aparece no \`GetCapabilities\` **e** devolve
\`GetMap\` válido e não uniforme. "Imagem uniforme" costuma significar que a bbox de
teste está fora da cobertura daquele mosaico — vale repetir com outra bbox antes de
descartar o ano.
`;

  const outPath = path.join(process.cwd(), "docs", "LEVANTAMENTO_WMS_ANALISE_POS_RECORTE.md");
  fs.writeFileSync(outPath, md);
  console.log(`\nRelatório: ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
