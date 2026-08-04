/**
 * Entry point do painel administrativo.
 *
 * NOTA (Plano 07, 03/08/2026): as 1.310 linhas originais foram desmembradas em
 * types/constants/format/components + AdminRoot/AdminApp/StorageTab/ServerTab.
 */
import "@/index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { AdminRoot } from "./AdminRoot";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminRoot />
  </React.StrictMode>,
);

