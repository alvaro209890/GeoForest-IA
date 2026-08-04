/**
 * Entry point do painel administrativo.
 *
 * NOTA (Plano 07, 03/08/2026): as 1.310 linhas originais foram desmembradas em
 * types/constants/format/components + AdminApp/StorageTab/ServerTab.
 */
import "@/index.css";
import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./AdminApp";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>,
);

