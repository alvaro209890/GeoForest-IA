import { spawn } from "node:child_process";

process.env.NODE_ENV = "development";

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["tsx", "backend/index.ts"], {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
