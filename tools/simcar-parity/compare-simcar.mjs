/**
 * Cliente mínimo da API SIMCAR (tecnico.api) para calibração.
 * Não processa shapes por padrão — só autentica e opcionalmente busca status.
 *
 * Uso:
 *   SIMCAR_LOGIN=... SIMCAR_SENHA=... node tools/simcar-parity/compare-simcar.mjs
 *   SIMCAR_REQUERIMENTO_ID=123 node tools/simcar-parity/compare-simcar.mjs --status
 */
import https from "node:https";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = "https://monitoramento.sema.mt.gov.br/simcar/tecnico.api/api";

// scramble extraído do bundle do tecnico.app (IIFE)
function loadScramble() {
  // Implementação compacta equivalente: reutiliza trecho se bundle local existir
  // Fallback: tenta carregar de research scratch; senão documenta falha.
  const candidates = [
    path.join(process.cwd(), "tools/simcar-parity/scramble.snippet.js"),
    "/tmp/grok-goal-2512cc4ac348/implementer/simcar-research/scramble_raw.js",
  ];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, "utf8");
    // scramble_raw is "t.scramble=function(){...}()" — wrap
    const wrapped = `
      var t = {};
      ${src.startsWith("t.scramble") ? src : "t.scramble=" + src}
      if (typeof t.scramble === "function" && t.scramble.length === 0) {
        try { t.scramble = t.scramble(); } catch (_) {}
      }
      module.exports = t.scramble;
    `;
    const tmp = path.join(path.dirname(fileURLToPath(import.meta.url)), ".scramble.tmp.cjs");
    fs.writeFileSync(tmp, wrapped);
    try {
      const require = createRequire(import.meta.url);
      return require(tmp);
    } catch {
      /* try next */
    }
  }
  return null;
}

function request(method, apiPath, body, token) {
  return new Promise((resolve, reject) => {
    const data = body != null ? JSON.stringify(body) : null;
    const headers = {
      "User-Agent": "GeoForest-simcar-parity/1.0",
      Accept: "application/json",
      Origin: "https://monitoramento.sema.mt.gov.br",
      Referer: "https://monitoramento.sema.mt.gov.br/simcar/tecnico.app/",
    };
    if (token) headers.authorization = token;
    if (data) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const url = new URL(ROOT + apiPath);
    const req = https.request(
      { hostname: url.hostname, path: url.pathname + url.search, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => resolve({ status: res.statusCode, body: buf }));
      },
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

const login = process.env.SIMCAR_LOGIN || "";
const senha = process.env.SIMCAR_SENHA || "";
const reqId = process.env.SIMCAR_REQUERIMENTO_ID || "";
const wantStatus = process.argv.includes("--status");

if (!login || !senha) {
  console.error("Defina SIMCAR_LOGIN e SIMCAR_SENHA (veja .env.example).");
  process.exit(1);
}

const scramble = loadScramble();
if (!scramble) {
  console.error(
    "Função scramble não encontrada. Salve o trecho t.scramble=...() do bundle em tools/simcar-parity/scramble.snippet.js",
  );
  process.exit(1);
}

const v = scramble(JSON.stringify({ Login: login.replace(/\D/g, ""), Senha: senha, NovaSenha: "" }));
const auth = await request("POST", "/Autenticacao/Autenticar", { v });
console.log("AUTH", auth.status, auth.body.slice(0, 80));
if (auth.status !== 200) process.exit(1);
const token = JSON.parse(auth.body);

const user = await request("GET", "/Autenticacao/BuscarUsuarioLogado", null, token);
console.log("USER", user.status, user.body.slice(0, 200));

const versao = await request("GET", "/Autenticacao/BuscarVersao", null, token);
console.log("VERSAO", versao.status, versao.body);

if (wantStatus && reqId) {
  const st = await request("GET", `/Requerimento/BuscarStatusProcessamento/${reqId}`, null, token);
  console.log("STATUS", st.status, st.body.slice(0, 500));
} else if (wantStatus) {
  console.log("Informe SIMCAR_REQUERIMENTO_ID para --status");
}

console.log("OK — login e endpoints básicos respondendo.");
console.log("Para processar shapes use o técnico.app ou estenda este script com cuidado (efeito em rascunhos reais).");
