/**
 * Relatório fotográfico IMAP.
 *   POST /api/relatorio-fotografico/analisar  — vê as fotos e devolve a seleção
 *   POST /api/relatorio-fotografico/docx      — gera o Word no modelo IMAP
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../auth";
import { writeSse } from "../lib/sse";
import { buildRelatorioFotograficoDocx, relatorioFilename } from "./docx";
import { requestSelecaoFotos } from "./ninerouter";
import { prepareFotos } from "./photos";
import { normalizeSelecao } from "./selecao";
import { RELATORIO_FOTO_MAX_FOTOS, RelatorioFotoError, type FotoEntrada, type FotoPronta } from "./types";

function lerTexto(value: unknown, max: number): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function lerFotos(value: unknown): FotoEntrada[] {
  if (!Array.isArray(value)) {
    throw new RelatorioFotoError("Envie a lista de fotografias.", 400, "SEM_FOTOS");
  }
  return value.map((item) => {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    return {
      id: String(record.id || "").trim(),
      nome: String(record.nome || record.name || "foto.jpg"),
      base64: String(record.base64 || ""),
    };
  });
}

function sendError(res: Response, error: unknown): void {
  if (res.headersSent) {
    const message = error instanceof RelatorioFotoError ? error.message : "Falha ao montar o relatório.";
    writeSse(res, { type: "error", message });
    res.end();
    return;
  }
  if (error instanceof RelatorioFotoError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  console.error("[relatorio-fotografico]", error);
  res.status(500).json({ error: "Falha ao montar o relatório fotográfico.", code: "INTERNO" });
}

function startSse(res: Response): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

async function handleAnalisar(req: Request, res: Response): Promise<void> {
  const objetivo = String(req.body?.objetivo || "").trim();
  if (objetivo.length < 8) {
    sendError(
      res,
      new RelatorioFotoError(
        "Descreva o objetivo do relatório com pelo menos uma frase.",
        400,
        "OBJETIVO_CURTO",
      ),
    );
    return;
  }
  if (objetivo.length > 4000) {
    sendError(res, new RelatorioFotoError("O objetivo passou de 4000 caracteres.", 400, "OBJETIVO_LONGO"));
    return;
  }
  const projeto = lerTexto(req.body?.projeto, 120);

  let fotos: FotoPronta[];
  try {
    fotos = await prepareFotos(lerFotos(req.body?.fotos), "ia");
  } catch (error) {
    sendError(res, error);
    return;
  }

  startSse(res);
  const heartbeat = setInterval(() => writeSse(res, { type: "heartbeat" }), 12_000);
  const abort = new AbortController();
  const onAbort = () => abort.abort();
  req.on("aborted", onAbort);
  try {
    writeSse(res, {
      type: "progress",
      message: "DeepSeek v4.1 Flash está vendo as fotos, com raciocínio máximo.",
    });
    const resposta = await requestSelecaoFotos({
      projeto,
      objetivo,
      fotos,
      signal: abort.signal,
    });
    const selecao = normalizeSelecao(resposta.content, fotos.map((foto) => foto.id));
    writeSse(res, {
      type: "complete",
      modelo: resposta.model,
      raciocinio: resposta.reasoning,
      selecao,
    });
    res.end();
  } catch (error) {
    sendError(res, error);
  } finally {
    clearInterval(heartbeat);
    req.off("aborted", onAbort);
  }
}

async function handleDocx(req: Request, res: Response): Promise<void> {
  try {
    const projeto = lerTexto(req.body?.projeto, 120);
    const parciaisEntrada = Array.isArray(req.body?.parciais) ? req.body.parciais : [];
    if (!parciaisEntrada.length) {
      throw new RelatorioFotoError("Monte ao menos uma parcial antes de gerar o Word.", 400, "SEM_PARCIAIS");
    }
    const parciais = [];
    let totalFotos = 0;
    for (const item of parciaisEntrada) {
      const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const caption = String(record.legenda || record.caption || "").trim().slice(0, 1200);
      const entradas = lerFotos(record.fotos);
      if (!caption || entradas.length === 0) continue;
      totalFotos += entradas.length;
      if (totalFotos > RELATORIO_FOTO_MAX_FOTOS) {
        throw new RelatorioFotoError(
          `O limite é ${RELATORIO_FOTO_MAX_FOTOS} fotografias por relatório.`,
          400,
          "MUITAS_FOTOS",
        );
      }
      const fotos = await prepareFotos(entradas, "docx");
      parciais.push({ caption, photos: fotos });
    }
    const buffer = await buildRelatorioFotograficoDocx(parciais);
    const filename = relatorioFilename(projeto);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(buffer);
  } catch (error) {
    sendError(res, error);
  }
}

export function registerRelatorioFotograficoRoutes(app: Express): void {
  app.post("/api/relatorio-fotografico/analisar", requireAuth, (req, res) => {
    void handleAnalisar(req, res);
  });
  app.post("/api/relatorio-fotografico/docx", requireAuth, (req, res) => {
    void handleDocx(req, res);
  });
}
