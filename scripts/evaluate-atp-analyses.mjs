#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const API_BASE = String(process.env.API_BASE || "http://localhost:3001").replace(/\/+$/, "");
const FIREBASE_ID_TOKEN = String(process.env.FIREBASE_ID_TOKEN || "").trim();
const ATP_ZIP = path.resolve(process.env.ATP_ZIP || "atp.zip");
const AIR_ID = String(process.env.AIR_ID || "ATP_TEST").trim();
const RUN_SIMCAR = process.env.RUN_SIMCAR !== "0";
const RUN_NOVO_CAR = process.env.RUN_NOVO_CAR !== "0";
const RUN_VECTORIZED = process.env.RUN_VECTORIZED === "1";
const AC_AVN_LAYERS = String(
  process.env.AC_AVN_LAYERS || "landsat5_2006,landsat5_2007,spot_2008,landsat5_2008",
)
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logDir = path.resolve(".run-logs", `atp-analysis-eval-${timestamp}`);

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${FIREBASE_ID_TOKEN}`,
  };
}

async function writeJson(name, value) {
  await fs.writeFile(path.join(logDir, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(name, value) {
  await fs.writeFile(path.join(logDir, name), `${String(value || "").trim()}\n`, "utf8");
}

async function parseSseResponse(response, label) {
  const text = await response.text();
  const events = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload) continue;
    try {
      events.push(JSON.parse(payload));
    } catch (err) {
      events.push({ type: "parse_error", label, payload, message: err?.message || String(err) });
    }
  }

  const errorEvent = events.find((event) => event?.type === "error");
  if (errorEvent) {
    const message = errorEvent.message || errorEvent.error || `${label} failed`;
    const err = new Error(String(message));
    err.events = events;
    throw err;
  }
  return events;
}

async function postSse(endpoint, payload, label) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${label} HTTP ${response.status}: ${body.slice(0, 800)}`);
  }
  return parseSseResponse(response, label);
}

async function postJson(endpoint, payload, label) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const body = await response.text();
  let parsed;
  try {
    parsed = body ? JSON.parse(body) : null;
  } catch {
    parsed = { raw: body };
  }
  if (!response.ok) {
    throw new Error(`${label} HTTP ${response.status}: ${body.slice(0, 800)}`);
  }
  return parsed;
}

async function fetchAsBase64(url, label) {
  const response = await fetch(url, {
    headers: FIREBASE_ID_TOKEN ? authHeaders() : undefined,
  });
  if (!response.ok) throw new Error(`${label} download HTTP ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer).toString("base64");
}

function lastEvent(events, type) {
  return [...events].reverse().find((event) => event?.type === type);
}

function compactComplete(event) {
  if (!event) return null;
  return {
    jobId: event.jobId,
    downloadUrl: event.downloadUrl,
    inputZipUrl: event.inputZipUrl,
    outputZipUrl: event.outputZipUrl,
    contextUrl: event.contextUrl,
    summary: event.summary,
    analysisMeta: event.analysisMeta,
    auasMeta: event.auasMeta,
    analysisLength: String(event.analysis || "").length,
    imageCount: Array.isArray(event.images) ? event.images.length : 0,
  };
}

async function runSimcar(propertyZip) {
  const clipEvents = await postSse(
    "/api/simcar/clip",
    { propertyZip, filename: path.basename(ATP_ZIP), airIdentificacao: AIR_ID },
    "SIMCAR clip",
  );
  await writeJson("events-simcar-clip.json", clipEvents);
  const clipComplete = lastEvent(clipEvents, "complete");
  if (!clipComplete?.jobId) throw new Error("SIMCAR clip did not return jobId.");

  const acAvnEvents = await postSse(
    "/api/simcar/clip/analyze",
    {
      jobId: clipComplete.jobId,
      selectedLayers: AC_AVN_LAYERS,
      contextUrl: clipComplete.contextUrl,
      outputZipUrl: clipComplete.outputZipUrl,
    },
    "SIMCAR AC/AVN",
  );
  await writeJson("events-simcar-acavn.json", acAvnEvents);
  const acAvnComplete = lastEvent(acAvnEvents, "complete");
  await writeJson("simcar-acavn.json", acAvnComplete || {});
  await writeText("simcar-acavn.md", acAvnComplete?.analysis || "");

  const auasEvents = await postSse(
    "/api/simcar/clip/analyze-auas",
    {
      jobId: clipComplete.jobId,
      previousAnalysis: acAvnComplete?.analysis || "",
      acAvnMeta: acAvnComplete?.analysisMeta,
      contextUrl: clipComplete.contextUrl,
      outputZipUrl: clipComplete.outputZipUrl,
    },
    "SIMCAR AUAS",
  );
  await writeJson("events-simcar-auas.json", auasEvents);
  const auasComplete = lastEvent(auasEvents, "complete");
  await writeJson("simcar-auas.json", auasComplete || {});
  await writeText("simcar-auas.md", auasComplete?.analysis || "");

  const vectorized = RUN_VECTORIZED
    ? await runVectorized(clipComplete, acAvnComplete)
    : { skipped: "Set RUN_VECTORIZED=1 to import and reanalyze the generated SIMCAR output ZIP." };

  return {
    clip: compactComplete(clipComplete),
    acAvn: compactComplete(acAvnComplete),
    auas: compactComplete(auasComplete),
    vectorized,
  };
}

async function runVectorized(clipComplete, acAvnComplete) {
  const downloadUrl = clipComplete.outputZipUrl || clipComplete.downloadUrl;
  if (!downloadUrl) return { skipped: "SIMCAR did not return a downloadable output ZIP." };

  const outputZip = await fetchAsBase64(downloadUrl, "SIMCAR vectorized ZIP");
  const imported = await postJson(
    "/api/simcar/clip/import-vectorized",
    { propertyZip: outputZip, filename: `simcar_vectorized_${clipComplete.jobId}.zip` },
    "SIMCAR vectorized import",
  );
  await writeJson("simcar-vectorized-import.json", imported || {});

  const acAvnEvents = await postSse(
    "/api/simcar/clip/analyze",
    {
      jobId: imported.jobId,
      selectedLayers: AC_AVN_LAYERS,
      contextUrl: imported.contextUrl,
      outputZipUrl: imported.outputZipUrl,
    },
    "SIMCAR vectorized AC/AVN",
  );
  await writeJson("events-simcar-vectorized-acavn.json", acAvnEvents);
  const vectorAcAvn = lastEvent(acAvnEvents, "complete");
  await writeText("simcar-vectorized-acavn.md", vectorAcAvn?.analysis || "");

  const auasEvents = await postSse(
    "/api/simcar/clip/analyze-auas",
    {
      jobId: imported.jobId,
      previousAnalysis: vectorAcAvn?.analysis || acAvnComplete?.analysis || "",
      acAvnMeta: vectorAcAvn?.analysisMeta || acAvnComplete?.analysisMeta,
      contextUrl: imported.contextUrl,
      outputZipUrl: imported.outputZipUrl,
    },
    "SIMCAR vectorized AUAS",
  );
  await writeJson("events-simcar-vectorized-auas.json", auasEvents);
  const vectorAuas = lastEvent(auasEvents, "complete");
  await writeText("simcar-vectorized-auas.md", vectorAuas?.analysis || "");

  return {
    import: imported,
    acAvn: compactComplete(vectorAcAvn),
    auas: compactComplete(vectorAuas),
  };
}

async function runNovoCar(propertyZip) {
  const events = await postSse(
    "/api/auas/analyze",
    { propertyZip, filename: path.basename(ATP_ZIP) },
    "Novo CAR AUAS",
  );
  await writeJson("events-novo-car.json", events);
  const resultEvent = lastEvent(events, "result");
  const data = resultEvent?.data || {};
  await writeJson("novo-car.json", data);
  await writeText("novo-car.md", data.analysis || "");
  return {
    jobId: resultEvent?.jobId,
    propertyAreaHa: data.propertyAreaHa,
    acAreaHa: data.acAreaHa,
    auasAreaHa: data.auasAreaHa,
    avnAreaHa: data.avnAreaHa,
    auasOpeningDate: data.auasOpeningDate,
    auasOpeningSource: data.auasOpeningSource,
    analysisRulesVersion: data.analysisRulesVersion,
    analysisMeta: data.analysisMeta,
    analysisLength: String(data.analysis || "").length,
    imageCount: Array.isArray(data.images) ? data.images.length : 0,
  };
}

async function main() {
  if (!FIREBASE_ID_TOKEN) {
    throw new Error("Defina FIREBASE_ID_TOKEN com um token Firebase válido antes de rodar a avaliação real.");
  }

  const zipBuffer = await fs.readFile(ATP_ZIP);
  const propertyZip = zipBuffer.toString("base64");
  await fs.mkdir(logDir, { recursive: true });

  const summary = {
    startedAt: new Date().toISOString(),
    apiBase: API_BASE,
    atpZip: ATP_ZIP,
    airId: AIR_ID,
    simcar: RUN_SIMCAR ? await runSimcar(propertyZip) : { skipped: "RUN_SIMCAR=0" },
    novoCar: RUN_NOVO_CAR ? await runNovoCar(propertyZip) : { skipped: "RUN_NOVO_CAR=0" },
    finishedAt: new Date().toISOString(),
    logDir,
  };

  await writeJson("summary.json", summary);
  console.log(`ATP analysis evaluation written to ${logDir}`);
}

main().catch(async (err) => {
  try {
    await fs.mkdir(logDir, { recursive: true });
    await writeJson("error.json", {
      message: err?.message || String(err),
      events: err?.events,
      logDir,
    });
  } catch {
    // ignore logging failures
  }
  console.error(err?.message || err);
  process.exit(1);
});
