import { useState } from 'react';

// V2: análise pré-2008 por polígono AUAS individual (Landsat 5 2003-2007 + SPOT 2008).
// Ver Analise_pos_recorte/CONTRATOS.md. Nunca reintroduzir "passivo pós-2008" neste fluxo.
export type SimcarAuasPolygonResultV2 = {
  polygonId: string;
  areaHa: number;
  bbox: [number, number, number, number];
  status: 'ALERTA_PRE_2008' | 'SINAL_DE_DUVIDA' | 'SEM_EVIDENCIA_PRE_2008' | 'INCONCLUSIVO_NO_MARCO_2008' | 'INCONCLUSIVO';
  pre2008Alert: boolean;
  evidenceKind: string;
  observedInterval: { fromYear: number | null; toYear: number | null; wording: string } | null;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INCONCLUSIVE';
  evidence: string[];
  limitations: string[];
  doubtSignals?: string[];
  geometryChecks?: {
    overlapAcHa: number;
    overlapAvnHa: number;
    hasAcLayer: boolean;
    hasAvnLayer: boolean;
  };
};

export type SimcarAuasMetaV2 = {
  schemaVersion: 2;
  rulesVersion: string;
  status: 'ALERTA_PRE_2008' | 'SINAL_DE_DUVIDA' | 'SEM_EVIDENCIA_PRE_2008' | 'INCONCLUSIVO';
  pre2008Alert: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | 'INCONCLUSIVE';
  summary: {
    polygonCount: number;
    alertCount: number;
    doubtCount?: number;
    doubtAreaHa?: number;
    inconclusiveCount: number;
    noEvidenceCount: number;
    totalAuasAreaHa: number;
    alertAreaHa: number;
  };
  sources: { required: string[]; used: string[]; missing: string[] };
  polygons: SimcarAuasPolygonResultV2[];
  limitations: string[];
};

export function formatSimcarAuasPre2008Status(status?: SimcarAuasMetaV2['status']) {
  if (status === 'ALERTA_PRE_2008') return { label: 'Alerta pré-2008', className: 'border-red-500/25 bg-red-500/10 text-red-200' };
  if (status === 'SINAL_DE_DUVIDA') return { label: 'Sinal de dúvida', className: 'border-orange-500/30 bg-orange-500/10 text-orange-200' };
  if (status === 'SEM_EVIDENCIA_PRE_2008') return { label: 'Sem evidência pré-2008', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' };
  return { label: 'Inconclusivo', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
}

export function formatSimcarAuasPolygonStatus(status: SimcarAuasPolygonResultV2['status']) {
  if (status === 'ALERTA_PRE_2008') return { label: 'Alerta pré-2008', className: 'border-red-500/25 bg-red-500/10 text-red-200' };
  if (status === 'SINAL_DE_DUVIDA') return { label: 'Sinal de dúvida', className: 'border-orange-500/30 bg-orange-500/10 text-orange-200' };
  if (status === 'SEM_EVIDENCIA_PRE_2008') return { label: 'Sem evidência pré-2008', className: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200' };
  if (status === 'INCONCLUSIVO_NO_MARCO_2008') return { label: 'Inconclusivo no marco 2008', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
  return { label: 'Inconclusivo', className: 'border-amber-500/25 bg-amber-500/10 text-amber-200' };
}

function PolygonRow({ polygon }: { polygon: SimcarAuasPolygonResultV2 }) {
  const [open, setOpen] = useState(false);
  const status = formatSimcarAuasPolygonStatus(polygon.status);
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left"
        aria-expanded={open}
      >
        <span className={`px-2 py-0.5 rounded-md border text-[10px] font-semibold ${status.className}`}>
          {status.label}
        </span>
        <span className="text-[11px] text-slate-300 font-mono">{polygon.polygonId}</span>
        <span className="text-[11px] text-slate-500">{polygon.areaHa.toFixed(2)} ha</span>
        <span className="ml-auto text-[10px] text-slate-500">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5 text-[11px] text-slate-300">
          <p>
            <span className="text-slate-500">Confiança: </span>
            {polygon.confidence}
          </p>
          {polygon.observedInterval && (
            <p className="text-slate-300">{polygon.observedInterval.wording}</p>
          )}
          {(polygon.doubtSignals?.length || 0) > 0 && (
            <div className="space-y-0.5">
              {polygon.doubtSignals!.map((item, idx) => (
                <p key={`doubt-${idx}`} className="text-orange-200/90">
                  ❓ {item}
                </p>
              ))}
            </div>
          )}
          {polygon.geometryChecks && (polygon.geometryChecks.overlapAcHa > 0.01 || polygon.geometryChecks.overlapAvnHa > 0.01) && (
            <p className="text-orange-200/90">
              📐 Sobreposição geométrica: AC {polygon.geometryChecks.overlapAcHa.toFixed(4)} ha · AVN {polygon.geometryChecks.overlapAvnHa.toFixed(4)} ha
            </p>
          )}
          {polygon.evidence.length > 0 && (
            <ul className="list-disc list-inside space-y-0.5 text-slate-400">
              {polygon.evidence.map((item, idx) => (
                <li key={idx}>{item}</li>
              ))}
            </ul>
          )}
          {polygon.limitations.length > 0 && (
            <div className="space-y-0.5">
              {polygon.limitations.map((item, idx) => (
                <p key={idx} className="text-amber-200/90">
                  ⚠ {item}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SimcarAuasPre2008PanelV2({ meta }: { meta: SimcarAuasMetaV2 }) {
  const status = formatSimcarAuasPre2008Status(meta.status);
  return (
    <div className="px-6 pt-4">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold ${status.className}`}
            role="status"
          >
            {status.label}
          </span>
          <span className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-300">
            Confiança: {meta.confidence}
          </span>
          <span className="px-2.5 py-1 rounded-lg border border-white/10 bg-white/5 text-[11px] text-slate-300">
            {meta.summary.polygonCount} polígono(s) AUAS analisado(s) individualmente
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Com alerta</p>
            <p className="mt-1 text-red-200">{meta.summary.alertCount}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Sem evidência</p>
            <p className="mt-1 text-emerald-200">{meta.summary.noEvidenceCount}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Inconclusivos</p>
            <p className="mt-1 text-amber-200">{meta.summary.inconclusiveCount}</p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500">Área total AUAS</p>
            <p className="mt-1 text-slate-200">{meta.summary.totalAuasAreaHa.toFixed(2)} ha</p>
          </div>
        </div>

        <div className="text-[11px] text-slate-400 space-y-1">
          {meta.sources.used.length > 0 && (
            <p>
              <span className="text-slate-500">Fontes usadas: </span>
              {meta.sources.used.join(', ')}
            </p>
          )}
          {meta.sources.missing.length > 0 && (
            <p className="text-amber-200/90">
              <span className="text-slate-500">Fontes ausentes: </span>
              {meta.sources.missing.join(', ')}
            </p>
          )}
        </div>

        {meta.polygons.length > 0 && (
          <div className="space-y-1.5">
            {meta.polygons.map((polygon) => (
              <PolygonRow key={polygon.polygonId} polygon={polygon} />
            ))}
          </div>
        )}

        {meta.limitations.length > 0 && (
          <div className="space-y-1 pt-1 border-t border-white/10">
            {meta.limitations.map((item, idx) => (
              <p key={idx} className="text-[11px] text-amber-200/90 leading-relaxed">
                ⚠ {item}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
