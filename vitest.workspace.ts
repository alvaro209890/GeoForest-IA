/**
 * `vite.config.ts` tem `root: client`, então um `vitest run` puro só enxergava
 * os testes do front — os de `backend/` ficavam de fora. Aqui os dois viram
 * projetos do mesmo `npm test`.
 */
import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  {
    extends: "./vite.config.ts",
    test: { name: "client" },
  },
  {
    test: {
      name: "backend",
      root: ".",
      include: ["backend/**/*.{test,spec}.ts", "shared/**/*.{test,spec}.ts"],
      environment: "node",
    },
  },
]);
