/**
 * Orquestrador: resolve as parcelas alvo e roda a análise de sobreposição.
 */
import archiver from "archiver";
import fs from "node:fs";
import { getAbsoluteStoragePath, saveUserBuffer } from "../local-storage";
import { finishJob, isCancelRequested } from "../processing-jobs";
import { parseUserShapefile } from "../simcar";
import { fetchParcelByCode } from "../sigef-client";
import { fetchSicarFeaturesByBbox, fetchWfsFeaturesByBbox, mergeCarEstadualCandidates, toFederalCandidates } from "./car-intersection";
import { MIN_OVERLAP_M2, SEMA_CAR_ATP_LAYER, SEMA_CAR_REQ_LAYER, SICAR_WFS_LAYER } from "./constants";
import { buildCarEstadualVsCarEstadualXlsx, buildSigefCarEstadualXlsx, buildSigefCarFederalXlsx } from "./excel-builder";
import { closeSubscribers, progress } from "./sse";
import { CarEstadualCandidate, CarFederalCandidate, OverlapDetailEstadual, OverlapDetailFederal, OverlapMode, TargetParcel } from "./types";
import { expandBbox, featureAreaHa, intersectionAreaHa, isCancelledSituacao, isFederalCancelled } from "./utils";

export async function resolveTargetsFromUpload(upload: Record<string, any>): Promise<TargetParcel[]> {
  if (Array.isArray(upload.parcelCodes) && upload.parcelCodes.length) {
    const targets: TargetParcel[] = [];
    for (const code of upload.parcelCodes as string[]) {
      const feature = await fetchParcelByCode(code);
      const areaHa = featureAreaHa(feature.geometry);
      targets.push({
        id: code,
        label: code,
        parcelaCodigo: code,
        geometry: feature.geometry,
        areaHa,
      });
    }
    return targets;
  }

  const relative = String(upload.inputRelativePath || "");
  if (!relative) throw new Error("Upload sem geometria.");
  const absolute = getAbsoluteStoragePath(relative);
  const zipBuffer = fs.readFileSync(absolute);
  const parsed = parseUserShapefile(zipBuffer);
  return parsed.polygons.map((poly, idx) => {
    const code = String((poly.properties as any)?.parcela_codigo || "").trim();
    const label =
      code ||
      String((poly.properties as any)?.nome || (poly.properties as any)?.NOME || "").trim() ||
      `Poligono_${idx + 1}`;
    return {
      id: code || `poly_${idx + 1}`,
      label,
      parcelaCodigo: code || undefined,
      geometry: poly.geometry,
      areaHa: featureAreaHa(poly.geometry),
    };
  });
}

export async function runOverlapJob(args: {
  uid: string;
  jobId: string;
  upload: Record<string, any>;
  modes: OverlapMode[];
  bufferMeters: number;
}): Promise<void> {
  const { uid, jobId, upload, modes, bufferMeters } = args;
  try {
    progress(uid, jobId, {
      status: "processing",
      stage: "targets",
      percent: 5,
      message: "Resolvendo polígonos alvo...",
    });
    if (isCancelRequested(jobId)) throw new Error("Cancelado pelo usuário.");

    const targets = await resolveTargetsFromUpload(upload);
    if (!targets.length) throw new Error("Nenhum polígono alvo encontrado.");

    const files: Array<{ name: string; buffer: Buffer }> = [];
    const warnings: string[] = [];
    let estadualDetails: OverlapDetailEstadual[] = [];
    let federalDetails: OverlapDetailFederal[] = [];
    let carTargetsForCarCar: Array<TargetParcel & { numeroEstadual?: string; situacao?: string }> = [];
    const ourNumeros = new Set<string>();

    const needEstadual =
      modes.includes("sigef-car-estadual") || modes.includes("car-estadual-car-estadual");
    const needFederal = modes.includes("sigef-car-federal");

    // Preload candidates per target
    const perTargetEstadual = new Map<string, CarEstadualCandidate[]>();
    const perTargetFederal = new Map<string, CarFederalCandidate[]>();

    for (let i = 0; i < targets.length; i += 1) {
      const t = targets[i];
      const pct = 10 + Math.round((i / Math.max(1, targets.length)) * 50);
      progress(uid, jobId, {
        status: "processing",
        stage: "wfs",
        percent: pct,
        message: `Consultando WFS para ${t.label} (${i + 1}/${targets.length})...`,
      });
      if (isCancelRequested(jobId)) throw new Error("Cancelado pelo usuário.");

      const bbox = expandBbox(t.geometry, bufferMeters);

      if (needEstadual) {
        try {
          const [atp, req] = await Promise.all([
            fetchWfsFeaturesByBbox({ typeName: SEMA_CAR_ATP_LAYER, bbox }),
            fetchWfsFeaturesByBbox({ typeName: SEMA_CAR_REQ_LAYER, bbox }),
          ]);
          const map = new Map<string, CarEstadualCandidate>();
          for (const [feats, label] of [
            [atp, "ATP"] as const,
            [req, "Requerido"] as const,
          ]) {
            for (const c of mergeCarEstadualCandidates(feats, label)) {
              const existing = map.get(c.numeroEstadual);
              if (!existing) {
                map.set(c.numeroEstadual, c);
              } else {
                for (const s of c.encontradoEm) {
                  if (!existing.encontradoEm.includes(s)) existing.encontradoEm.push(s);
                }
                if (!existing.nomePropriedade && c.nomePropriedade) existing.nomePropriedade = c.nomePropriedade;
                if (!existing.carFederal && c.carFederal) existing.carFederal = c.carFederal;
                if (!existing.protocolo && c.protocolo) existing.protocolo = c.protocolo;
              }
            }
          }
          perTargetEstadual.set(t.id, Array.from(map.values()));
        } catch (error: any) {
          warnings.push(`CAR estadual (${t.label}): ${error?.message || error}`);
          perTargetEstadual.set(t.id, []);
        }
      }

      if (needFederal) {
        try {
          const feats = await fetchSicarFeaturesByBbox(bbox);
          perTargetFederal.set(t.id, toFederalCandidates(feats));
        } catch (error: any) {
          warnings.push(`CAR federal (${t.label}): ${error?.message || error}`);
          perTargetFederal.set(t.id, []);
        }
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "intersect",
      percent: 65,
      message: "Calculando interseções...",
    });

    if (modes.includes("sigef-car-estadual") || modes.includes("car-estadual-car-estadual")) {
      for (const t of targets) {
        const cands = perTargetEstadual.get(t.id) || [];
        // Identify "own" CAR as the one with largest overlap
        let best: CarEstadualCandidate | null = null;
        let bestHa = 0;
        for (const c of cands) {
          const ha = intersectionAreaHa(t.geometry, c.geometry);
          if (ha > bestHa) {
            bestHa = ha;
            best = c;
          }
        }
        if (best && bestHa / Math.max(t.areaHa, 1e-9) >= 0.5) {
          ourNumeros.add(best.numeroEstadual);
          carTargetsForCarCar.push({
            ...t,
            id: `car_${best.numeroEstadual}`,
            label: `${t.label} (${best.numeroEstadual})`,
            numeroEstadual: best.numeroEstadual,
            situacao: best.situacao,
            geometry: best.geometry,
            areaHa: best.areaHa,
          });
        }

        for (const c of cands) {
          const overlapHa = intersectionAreaHa(t.geometry, c.geometry);
          const overlapM2 = overlapHa * 10000;
          if (overlapM2 < MIN_OVERLAP_M2) continue;
          estadualDetails.push({
            targetId: t.id,
            targetLabel: t.label,
            targetAreaHa: t.areaHa,
            numeroEstadual: c.numeroEstadual,
            nomePropriedade: c.nomePropriedade,
            carFederal: c.carFederal,
            situacao: c.situacao,
            encontradoEm: c.encontradoEm.join(", "),
            carAreaHa: c.areaHa,
            overlapHa,
            overlapPct: t.areaHa > 0 ? (overlapHa / t.areaHa) * 100 : 0,
            protocolo: c.protocolo,
            isOwn: Boolean(best && c.numeroEstadual === best.numeroEstadual),
            isCancelled: isCancelledSituacao(c.situacaoRaw),
          });
        }
      }
    }

    if (modes.includes("sigef-car-federal")) {
      for (const t of targets) {
        const cands = perTargetFederal.get(t.id) || [];
        for (const c of cands) {
          const overlapHa = intersectionAreaHa(t.geometry, c.geometry);
          const overlapM2 = overlapHa * 10000;
          if (overlapM2 < MIN_OVERLAP_M2) continue;
          federalDetails.push({
            targetId: t.id,
            targetLabel: t.label,
            targetAreaHa: t.areaHa,
            codImovel: c.codImovel,
            status: c.status,
            condicao: c.condicao,
            carAreaHa: c.areaHa,
            overlapHa,
            overlapPct: t.areaHa > 0 ? (overlapHa / t.areaHa) * 100 : 0,
            isCancelled: isFederalCancelled(c.status),
          });
        }
      }
      if (!federalDetails.length && warnings.some((w) => /CAR federal/i.test(w))) {
        warnings.push(
          `Modo federal indisponível ou sem feições. Camada configurada: ${SICAR_WFS_LAYER}`,
        );
      }
    }

    progress(uid, jobId, {
      status: "processing",
      stage: "xlsx",
      percent: 80,
      message: "Gerando planilhas...",
    });

    if (modes.includes("sigef-car-estadual")) {
      files.push({
        name: "SIGEF_sobreposicao_CAR_ESTADUAL.xlsx",
        buffer: await buildSigefCarEstadualXlsx({ targets, details: estadualDetails }),
      });
    }
    if (modes.includes("sigef-car-federal")) {
      files.push({
        name: "SIGEF_sobreposicao_CAR_Federal.xlsx",
        buffer: await buildSigefCarFederalXlsx({ targets, details: federalDetails }),
      });
    }
    if (modes.includes("car-estadual-car-estadual")) {
      // Build CAR×CAR details: for each our CAR target, compare against all candidates in region
      const carCarDetails: OverlapDetailEstadual[] = [];
      // Dedupe car targets by numero
      const uniqueCars = new Map<string, (typeof carTargetsForCarCar)[0]>();
      for (const c of carTargetsForCarCar) {
        if (c.numeroEstadual && !uniqueCars.has(c.numeroEstadual)) uniqueCars.set(c.numeroEstadual, c);
      }
      const carList = Array.from(uniqueCars.values());
      for (const car of carList) {
        // Use candidates from the matching SIGEF target bbox set — union all candidates seen
        const allCands = new Map<string, CarEstadualCandidate>();
        for (const list of perTargetEstadual.values()) {
          for (const c of list) allCands.set(c.numeroEstadual, c);
        }
        for (const c of allCands.values()) {
          if (c.numeroEstadual === car.numeroEstadual) continue;
          const overlapHa = intersectionAreaHa(car.geometry, c.geometry);
          if (overlapHa * 10000 < MIN_OVERLAP_M2) continue;
          carCarDetails.push({
            targetId: car.id,
            targetLabel: car.label,
            targetAreaHa: car.areaHa,
            numeroEstadual: c.numeroEstadual,
            nomePropriedade: c.nomePropriedade,
            carFederal: c.carFederal,
            situacao: c.situacao,
            encontradoEm: c.encontradoEm.join(", "),
            carAreaHa: c.areaHa,
            overlapHa,
            overlapPct: car.areaHa > 0 ? (overlapHa / car.areaHa) * 100 : 0,
            protocolo: c.protocolo,
            isOwn: ourNumeros.has(c.numeroEstadual),
            isCancelled: isCancelledSituacao(c.situacaoRaw),
          });
        }
      }
      files.push({
        name: "CAR_Estadual_sobreposicao_CAR_Estadual.xlsx",
        buffer: await buildCarEstadualVsCarEstadualXlsx({
          targets: carList,
          details: carCarDetails,
          ourNumeros,
        }),
      });
    }

    if (!files.length) throw new Error("Nenhuma planilha gerada. Selecione ao menos um modo.");

    progress(uid, jobId, {
      status: "processing",
      stage: "zip",
      percent: 92,
      message: "Empacotando ZIP...",
    });

    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver("zip", { zlib: { level: 9 } });
      const chunks: Buffer[] = [];
      archive.on("data", (c: Buffer) => chunks.push(c));
      archive.on("end", () => resolve(Buffer.concat(chunks)));
      archive.on("error", reject);
      for (const f of files) archive.append(f.buffer, { name: f.name });
      if (warnings.length) {
        archive.append(Buffer.from(warnings.join("\n"), "utf8"), { name: "avisos.txt" });
      }
      void archive.finalize();
    });

    const stored = saveUserBuffer({
      uid,
      area: "overlap/output",
      filename: `${jobId}_sobreposicoes.zip`,
      buffer: zipBuffer,
    });

    const payload = {
      status: "completed",
      stage: "completed",
      percent: 100,
      message: `${files.length} planilha(s) gerada(s) para ${targets.length} imóvel(is).`,
      outputRelativePath: stored.relativePath,
      outputUrl: stored.publicUrl,
      downloadUrl: `/api/overlap/download/${jobId}`,
      files: files.map((f) => f.name),
      targetCount: targets.length,
      warnings,
      createdAt: upload.createdAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
    progress(uid, jobId, payload);
    finishJob({ jobId, status: "completed" });
  } catch (error: any) {
    const message = String(error?.message || error || "Falha na análise de sobreposição.");
    progress(uid, jobId, {
      status: /cancel/i.test(message) ? "cancelled" : "failed",
      stage: "error",
      percent: 100,
      message,
      error: message,
    });
    finishJob({
      jobId,
      status: /cancel/i.test(message) ? "cancelled" : "failed",
      error: message,
    });
  } finally {
    closeSubscribers(jobId);
  }
}

/* ─────────────────────────── routes ─────────────────────────── */
