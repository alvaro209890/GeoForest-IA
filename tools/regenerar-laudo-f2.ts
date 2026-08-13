/**
 * Regenera o laudo F2 (markdown + report.model) de um dourado já computado,
 * usando o DeepSeek com a chave válida. Os status/áreas NÃO mudam — o DeepSeek
 * só redige o texto. Uso: set -a; source env; set +a; npx tsx tools/regenerar-laudo-f2.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPos2008Report } from "../backend/analise-pos-recorte/pos2008/report-builder";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(process.env.DOURADO_JSON || path.join(__dirname, "../docs/dourados/santa-clara/f2-pos2008.json"));

async function main() {
  const f2 = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));
  const input = {
    rulesVersion: f2.rulesVersion,
    summary: f2.summary,
    catalog: f2.catalog,
    polygons: f2.polygons,
    limitations: f2.limitations,
    pre2008CompletedAt: f2.pre2008JobRef?.completedAt ?? null,
  };
  const report = await buildPos2008Report(input, { timeoutMs: 180_000 });
  console.log("[regenerar] model:", report.model);
  if (report.model !== "deepseek-v4-pro") {
    console.error("[regenerar] FALHOU — laudo continua no fallback:", JSON.stringify(report).slice(0, 200));
    process.exit(1);
  }
  f2.report = report;
  fs.writeFileSync(JSON_PATH, JSON.stringify(f2, null, 2));
  fs.writeFileSync(path.join(path.dirname(JSON_PATH), "f2-pos2008-laudo.md"), report.markdown);
  console.log("[regenerar] laudo salvo em", JSON_PATH.replace(/\.json$/, "-laudo.md"));
}

main().catch((err) => {
  console.error("[regenerar] FALHOU:", err);
  process.exit(1);
});
