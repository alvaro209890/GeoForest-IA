import {
  AlertTriangle,
  CheckCircle2,
  Combine,
  Download,
  Loader2,
  Trash2,
  Upload,
} from 'lucide-react';
import type { UseOverlapJobsReturn } from '../hooks/useOverlapJobs';
import type { OverlapMode } from '../sobreposicoes/types';

export type SobreposicoesPanelProps = {
  overlap: UseOverlapJobsReturn;
};

export default function SobreposicoesPanel({ overlap }: SobreposicoesPanelProps) {
  const {
    overlapFile,
    overlapParcelCodesText,
    setOverlapParcelCodesText,
    overlapUploading,
    overlapUploadId,
    overlapPolygonCount,
    overlapModes,
    overlapModeOptions,
    toggleMode,
    applyZipFile,
    uploadParcelCodes,
    startOverlapProcessing,
    overlapProcessing,
    overlapProgress,
    overlapMessage,
    overlapError,
    overlapDownload,
    overlapFiles,
    overlapWarnings,
    downloadOverlapZip,
    resetOverlapDraft,
    fileInputRef,
    federalAvailable,
    federalHealthError,
  } = overlap;

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-teal-100">
                <Combine size={13} />
                Sobreposições
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Planilhas SIGEF × CAR
              </h2>
              <p className="max-w-3xl text-sm text-slate-400">
                Gere as três planilhas de sobreposição a partir de um ZIP SIGEF ou de códigos de parcela:
                SIGEF × CAR estadual, SIGEF × CAR federal e CAR estadual × CAR estadual.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center shrink-0">
              {[
                { label: 'Entrada', value: 'ZIP / códigos' },
                { label: 'Fontes', value: 'SEMA + SICAR' },
                { label: 'Saída', value: 'XLSX' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xs font-semibold text-teal-100">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">1. Entrada dos imóveis</h3>
              <p className="text-xs text-slate-500 mt-1">
                Envie um ZIP com polígonos SIGEF ou informe códigos <code className="text-teal-200">parcela_codigo</code>.
              </p>
            </div>
            {overlapUploading && <Loader2 size={18} className="animate-spin text-teal-300" />}
          </div>

          <label
            className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
              overlapFile
                ? 'border-teal-500/40 bg-teal-500/5'
                : 'border-white/10 bg-white/[0.02] hover:border-teal-500/30 hover:bg-white/[0.03]'
            } cursor-pointer`}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = 'copy';
            }}
            onDrop={(e) => {
              e.preventDefault();
              void applyZipFile(e.dataTransfer.files?.[0] || null);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              onChange={(e) => void applyZipFile(e.target.files?.[0] || null)}
            />
            <div
              className={`rounded-xl p-3 ${
                overlapFile ? 'bg-teal-500/15 text-teal-200' : 'bg-white/5 text-slate-400 group-hover:text-teal-300'
              }`}
            >
              <Upload size={22} />
            </div>
            <div className="text-center min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {overlapFile ? overlapFile.name : 'Arraste ou selecione o ZIP SIGEF'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {overlapFile ? `${(overlapFile.size / 1024).toFixed(0)} KB` : 'Shapefiles compactados em .zip'}
              </p>
            </div>
            {overlapFile && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  resetOverlapDraft();
                }}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                aria-label="Remover ZIP"
              >
                <Trash2 size={16} />
              </button>
            )}
          </label>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ou códigos SIGEF</p>
            <textarea
              value={overlapParcelCodesText}
              onChange={(e) => setOverlapParcelCodesText(e.target.value)}
              rows={3}
              placeholder="Cole parcela_codigo (um por linha ou separados por vírgula)"
              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40"
            />
            <button
              type="button"
              onClick={() => void uploadParcelCodes()}
              disabled={overlapUploading || !overlapParcelCodesText.trim()}
              className="rounded-xl bg-white/5 hover:bg-white/10 disabled:opacity-40 px-4 py-2 text-sm font-semibold text-teal-100 border border-white/10"
            >
              Registrar códigos
            </button>
          </div>

          {overlapUploadId && (
            <div className="rounded-xl border border-teal-500/20 bg-teal-500/10 p-3 text-sm text-teal-100 flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>
                Pronto: {overlapPolygonCount} imóvel(is) · upload <code className="text-xs">{overlapUploadId.slice(0, 8)}</code>
              </span>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white">2. Modos de análise</h3>
            <p className="text-xs text-slate-500 mt-1">Escolha quais planilhas gerar no ZIP final.</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {overlapModeOptions.map((mode) => {
              const disabled = mode.id === 'sigef-car-federal' && federalAvailable === false;
              const checked = overlapModes.includes(mode.id as OverlapMode) && !disabled;
              return (
                <label
                  key={mode.id}
                  className={`rounded-xl border px-3 py-3 text-sm cursor-pointer transition-colors ${
                    checked
                      ? 'border-teal-400/40 bg-teal-500/10 text-teal-50'
                      : 'border-white/10 bg-white/[0.02] text-slate-300'
                  } ${disabled ? 'opacity-40 cursor-not-allowed' : 'hover:border-teal-400/30'}`}
                >
                  <input
                    type="checkbox"
                    className="mr-2 align-middle"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleMode(mode.id as OverlapMode)}
                  />
                  {mode.label}
                </label>
              );
            })}
          </div>
          {federalAvailable === false && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                CAR federal indisponível no momento
                {federalHealthError ? `: ${federalHealthError}` : '.'} Os outros modos seguem normalmente.
              </span>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void startOverlapProcessing()}
              disabled={!overlapUploadId || overlapProcessing || overlapModes.length === 0}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-600 to-emerald-600 hover:from-teal-500 hover:to-emerald-500 disabled:opacity-40 py-2.5 px-4 text-sm font-semibold text-white shadow-lg shadow-teal-900/30"
            >
              {overlapProcessing ? <Loader2 size={16} className="animate-spin" /> : <Combine size={16} />}
              {overlapProcessing ? 'Processando...' : 'Gerar planilhas'}
            </button>
            {overlapDownload && (
              <button
                type="button"
                onClick={() => void downloadOverlapZip()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 py-2.5 px-4 text-sm font-semibold text-white"
              >
                <Download size={16} />
                Baixar ZIP
              </button>
            )}
          </div>

          {(overlapProcessing || overlapProgress > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{overlapMessage || 'Processando...'}</span>
                <span>{overlapProgress}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-400 transition-all"
                  style={{ width: `${Math.max(2, overlapProgress)}%` }}
                />
              </div>
            </div>
          )}

          {overlapError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{overlapError}</span>
            </div>
          )}

          {overlapFiles.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100 space-y-1">
              <p className="font-semibold">Arquivos gerados</p>
              {overlapFiles.map((f) => (
                <p key={f} className="text-xs">
                  {f}
                </p>
              ))}
            </div>
          )}

          {overlapWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1">
              {overlapWarnings.map((w, i) => (
                <p key={`${w}-${i}`}>{w}</p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
