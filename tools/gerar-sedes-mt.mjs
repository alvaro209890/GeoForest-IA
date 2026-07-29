/**
 * Gera `config/sedes-mt.json` — a coordenada da sede de cada município de MT,
 * usada como ponto de partida do croqui de acesso.
 *
 * Execução única (ou quando a malha do IBGE for atualizada):
 *
 *   node tools/gerar-sedes-mt.mjs
 *
 * Para cada município da malha IBGE:
 *   1. consulta o Nominatim (1 req/s, conforme a política de uso);
 *   2. só aceita o resultado que cai DENTRO do polígono do município;
 *   3. encaixa o ponto na via mais próxima com o OSRM `/nearest`.
 *
 * Os municípios que não passarem na validação saem listados no final para
 * conferência manual — melhor faltar uma sede do que gravar uma sede errada.
 */
import fs from "node:fs";
import path from "node:path";
import { booleanPointInPolygon, point } from "@turf/turf";

const ROOT = path.resolve(import.meta.dirname, "..");
const MALHA = path.join(ROOT, "config", "municipios-mt.geojson");
const SAIDA = path.join(ROOT, "config", "sedes-mt.json");

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const OSRM = String(process.env.CROQUI_OSRM_BASE_URL || "https://router.project-osrm.org").replace(
  /\/$/,
  "",
);
const UA = "GeoForest-IA/1.0 (croqui de acesso; contato via github.com/alvaro209890/GeoForest-IA)";

const TIPOS_PREFERIDOS = ["city", "town", "village", "municipality", "administrative"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function buscarNominatim(nome) {
  const url = `${NOMINATIM}?${new URLSearchParams({
    q: `${nome}, Mato Grosso, Brasil`,
    format: "jsonv2",
    limit: "5",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "pt-BR" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const items = await res.json();
  return items.map((item) => ({
    lon: Number(item.lon),
    lat: Number(item.lat),
    classe: String(item.class || ""),
    tipo: String(item.type || ""),
  }));
}

async function snapNaVia(lon, lat) {
  try {
    const res = await fetch(`${OSRM}/nearest/v1/driving/${lon},${lat}?number=1`, {
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const wp = data?.waypoints?.[0];
    if (!wp?.location) return null;
    return { lon: wp.location[0], lat: wp.location[1], distanciaM: Math.round(wp.distance || 0) };
  } catch {
    return null;
  }
}

function ordenarCandidatos(candidatos) {
  return [...candidatos].sort((a, b) => {
    const pa = TIPOS_PREFERIDOS.indexOf(a.tipo);
    const pb = TIPOS_PREFERIDOS.indexOf(b.tipo);
    return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
  });
}

async function main() {
  const malha = JSON.parse(fs.readFileSync(MALHA, "utf8"));
  const municipios = malha.features;
  console.log(`Municípios na malha: ${municipios.length}`);

  const itens = [];
  const falhas = [];

  for (let i = 0; i < municipios.length; i++) {
    const feature = municipios[i];
    const { ibge, nome } = feature.properties;
    const prefixo = `[${String(i + 1).padStart(3, " ")}/${municipios.length}] ${nome}`;
    try {
      const candidatos = ordenarCandidatos(await buscarNominatim(nome));
      const dentro = candidatos.find((c) =>
        booleanPointInPolygon(point([c.lon, c.lat]), feature),
      );
      if (!dentro) {
        falhas.push({ ibge, nome, motivo: "nenhum resultado dentro do polígono" });
        console.log(`${prefixo}: SEM SEDE VÁLIDA`);
        await sleep(1100);
        continue;
      }
      const via = await snapNaVia(dentro.lon, dentro.lat);
      itens.push({
        ibge,
        nome,
        lon: Number(dentro.lon.toFixed(7)),
        lat: Number(dentro.lat.toFixed(7)),
        lonVia: via ? Number(via.lon.toFixed(7)) : null,
        latVia: via ? Number(via.lat.toFixed(7)) : null,
        snapM: via ? via.distanciaM : null,
      });
      console.log(`${prefixo}: ${dentro.lat.toFixed(5)},${dentro.lon.toFixed(5)} (${dentro.tipo}) snap ${via ? via.distanciaM + "m" : "n/d"}`);
    } catch (error) {
      falhas.push({ ibge, nome, motivo: String(error?.message || error) });
      console.log(`${prefixo}: ERRO ${error?.message || error}`);
    }
    await sleep(1100);
  }

  itens.sort((a, b) => a.ibge.localeCompare(b.ibge));
  fs.writeFileSync(
    SAIDA,
    JSON.stringify(
      {
        edition: new Date().toISOString().slice(0, 10),
        source: "OpenStreetMap/Nominatim, validado contra a malha municipal IBGE 2024",
        items: itens,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(`\nGravado ${SAIDA}: ${itens.length} sedes.`);
  if (falhas.length) {
    console.log(`\nConferir manualmente (${falhas.length}):`);
    for (const f of falhas) console.log(` - ${f.nome} (${f.ibge}): ${f.motivo}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
