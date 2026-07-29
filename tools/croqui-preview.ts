/**
 * Gera um croqui de verdade a partir de uma pasta com shapefile ATP, sem passar
 * pelo backend, para conferir o PDF/DOCX/KML contra os modelos de `Croquis/`.
 *
 *   npx tsx tools/croqui-preview.ts [pasta-do-shapefile] [pasta-de-saida]
 *
 * Padrão: `Croquis/ATP` → `$TMPDIR/croqui-preview`.
 * Precisa de rede (OSRM + base de imagem) e, para a base do Google,
 * de `GOOGLE_STATIC_MAPS_KEY` no ambiente.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import archiver from "archiver";
import { generateCroquiArtifacts } from "../backend/croqui";
import { parseUserShapefile } from "../backend/simcar-clip";

const ROOT = path.resolve(import.meta.dirname, "..");
const entrada = path.resolve(process.argv[2] || path.join(ROOT, "Croquis", "ATP"));
const saida = path.resolve(process.argv[3] || path.join(os.tmpdir(), "croqui-preview"));
const title = process.env.CROQUI_TITLE || "FAZENDA ARUANÃ I – MAT. 4242";
const propertyName = process.env.CROQUI_PROPERTY || "Fazenda Aruanã I";

async function zipDaPasta(dir: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const archive = archiver("zip");
  archive.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    archive.on("end", () => resolve(Buffer.concat(chunks)));
    archive.on("error", reject);
  });
  for (const file of fs.readdirSync(dir)) {
    archive.append(fs.readFileSync(path.join(dir, file)), { name: file });
  }
  await archive.finalize();
  return done;
}

async function main() {
  console.log(`ATP:    ${entrada}`);
  console.log(`Saída:  ${saida}`);
  console.log(`Base:   ${process.env.GOOGLE_STATIC_MAPS_KEY ? "Google Static Maps" : "Esri (sem chave do Google)"}`);

  const parsed = parseUserShapefile(await zipDaPasta(entrada));
  console.log(`Polígonos: ${parsed.polygons.length} | Área: ${parsed.areaHa.toFixed(2)} ha`);

  const inicio = Date.now();
  const resultado = await generateCroquiArtifacts({
    atpGeometry: parsed.geometry,
    title,
    propertyName,
  });

  fs.mkdirSync(saida, { recursive: true });
  for (const file of resultado.files) {
    fs.writeFileSync(path.join(saida, file.name), file.buffer);
    console.log(`  ${file.name} (${(file.buffer.length / 1024).toFixed(0)} KB)`);
  }

  console.log(`\nMunicípio: ${resultado.municipioNome}`);
  console.log(`Tempo: ${((Date.now() - inicio) / 1000).toFixed(1)}s`);
  console.log(`\nRoteiro:\n${resultado.narrative}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
