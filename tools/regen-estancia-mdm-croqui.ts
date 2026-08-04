/**
 * Regenera o croqui Estância MDM com ensureRouteReachesPolygon e sobrescreve
 * rotas + ZIP de saída do job 3116742c… (conta Álvaro).
 */
import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { parseUserShapefile } from "../backend/simcar";
import { ensureRouteReachesPolygon } from "../backend/croqui/routing";
import { generateCroquiArtifacts } from "../backend/croqui";
import { saveUserBuffer, writeDocBySegments } from "../backend/local-storage";

const UID = "Ed9LQ47ZvfPFV5x6TnUDQ10rWTI2";
const UPLOAD_ID = "9b12827e-8a44-402a-91e9-d92ac85f3e6b";
const JOB_ID = "3116742c-c7a3-4c99-b714-e00751090a9a";
const ROOT =
  process.env.LOCAL_DATA_ROOT ||
  "/media/server/HD Backup/Servidores_NAO_MEXA/Banco_de_dados/GeoForest";

async function zipFiles(files: Array<{ name: string; buffer: Buffer }>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const archive = archiver("zip", { zlib: { level: 9 } });
    archive.on("data", (c) => chunks.push(Buffer.from(c)));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    for (const f of files) archive.append(f.buffer, { name: f.name });
    void archive.finalize();
  });
}

async function main() {
  const inputZip = path.join(ROOT, "users", UID, "croqui/input", `${UPLOAD_ID}_ATP.zip`);
  const routesPath = path.join(ROOT, "users", UID, "croqui/routes", `${UPLOAD_ID}_rotas.json`);
  const rotas = JSON.parse(fs.readFileSync(routesPath, "utf8"));
  const parsed = await parseUserShapefile(fs.readFileSync(inputZip), "ATP.zip");
  const atpGeometry = (parsed as { geometry: GeoJSON.Polygon }).geometry;

  for (const opt of rotas.options) {
    opt.route = ensureRouteReachesPolygon(opt.route, atpGeometry);
    opt.totalDistanceM = opt.route.totalDistanceM;
    opt.label = `Caminho principal — ${(opt.route.totalDistanceM / 1000).toFixed(1).replace(".", ",")} km`;
  }
  fs.writeFileSync(routesPath, JSON.stringify({ uploadId: UPLOAD_ID, options: rotas.options }));

  const chosen = rotas.options[0].route;
  const artifacts = await generateCroquiArtifacts({
    atpGeometry,
    title: "Estância MDM",
    propertyName: "Estância MDM",
    route: chosen,
  });

  const zipBuf = await zipFiles(artifacts.files);
  const stored = saveUserBuffer({
    uid: UID,
    area: "croqui/output",
    filename: `${JOB_ID}_croqui.zip`,
    buffer: zipBuf,
  });

  const jobPath = ["users", UID, "croqui_jobs", JOB_ID];
  const existing = JSON.parse(
    fs.readFileSync(path.join(ROOT, ...jobPath) + ".json", "utf8"),
  );
  const updated = {
    ...existing,
    routeLabel: rotas.options[0].label,
    message: `Croqui regenerado (${artifacts.municipioNome}) — caminho até a divisa.`,
    files: artifacts.files.map((f) => f.name),
    outputRelativePath: stored.relativePath,
    outputUrl: stored.publicUrl,
    downloadUrl: stored.publicUrl,
    outputBytes: zipBuf.length,
    updatedAt: new Date().toISOString(),
    updatedAtMs: Date.now(),
    regeneratedAt: new Date().toISOString(),
    regenReason: "extendRouteToPolygon — gap OSM até porteira",
  };
  writeDocBySegments(jobPath, updated);

  const end = chosen.coordinates[chosen.coordinates.length - 1];
  console.log("OK regenerado", {
    outputBytes: zipBuf.length,
    totalDistanceM: Math.round(chosen.totalDistanceM),
    end,
    downloadUrl: stored.publicUrl,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
