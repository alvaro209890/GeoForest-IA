import { useState } from 'react';
import {
  CheckCircle2,
  Download,
  Loader2,
  Map,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import type { UseCroquiJobsReturn } from '../hooks/useCroquiJobs';

export type CroquiPanelProps = {
  croqui: UseCroquiJobsReturn;
};

function isZipFile(file: File): boolean {
  const name = String(file.name || '').toLowerCase();
  if (name.endsWith('.zip')) return true;
  const type = String(file.type || '').toLowerCase();
  return type === 'application/zip' || type === 'application/x-zip-compressed';
}

export default function CroquiPanel({ croqui }: CroquiPanelProps) {
  const {
    croquiFile,
    croquiTitle,
    setCroquiTitle,
    croquiPropertyName,
    setCroquiPropertyName,
    croquiUploading,
    croquiUploadId,
    croquiProcessing,
    croquiProgress,
    croquiMessage,
    croquiError,
    croquiDownload,
    croquiFiles,
    croquiMunicipio,
    applyZipFile,
    startCroquiProcessing,
    downloadCroquiZip,
    resetCroquiDraft,
    fileInputRef,
  } = croqui;

  const [dragActive, setDragActive] = useState(false);
  const dropDisabled = croquiProcessing || croquiUploading;

  const acceptZip = (file: File | null | undefined) => {
    if (!file || dropDisabled) return;
    if (!isZipFile(file)) {
      toast.error('Envie um arquivo .zip com o shapefile ATP.');
      return;
    }
    applyZipFile(file);
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-300/20 bg-amber-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-amber-100">
                <Map size={13} />
                Croqui de acesso
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Gerar croqui a partir da ATP
              </h2>
              <p className="max-w-3xl text-sm text-slate-400">
                Arraste o ZIP da ATP (ou selecione o arquivo), informe título e nome da propriedade.
                O sistema detecta o município, calcula o roteiro de acesso e gera PDF, Word e KML no padrão SEMA.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center shrink-0">
              {[
                { label: 'Entrada', value: 'ZIP ATP' },
                { label: 'Rota', value: 'Automática' },
                { label: 'Saída', value: 'PDF + DOCX + KML' },
              ].map((item) => (
                <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xs font-semibold text-amber-100">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Título do croqui</span>
              <input
                type="text"
                value={croquiTitle}
                onChange={(e) => setCroquiTitle(e.target.value)}
                placeholder="Ex.: LOTE 04 – P.A PINGOS D'ÁGUA"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-amber-400/40 focus:outline-none"
              />
            </label>
            <label className="block space-y-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Nome da propriedade</span>
              <input
                type="text"
                value={croquiPropertyName}
                onChange={(e) => setCroquiPropertyName(e.target.value)}
                placeholder="Ex.: Fazenda Pingos D'água"
                className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:border-amber-400/40 focus:outline-none"
              />
            </label>
          </div>

          <div
            role="button"
            tabIndex={0}
            aria-disabled={dropDisabled}
            onKeyDown={(e) => {
              if (dropDisabled) return;
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onClick={() => {
              if (!dropDisabled) fileInputRef.current?.click();
            }}
            onDragEnter={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!dropDisabled) setDragActive(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = dropDisabled ? 'none' : 'copy';
              if (!dropDisabled) setDragActive(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragActive(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setDragActive(false);
              acceptZip(e.dataTransfer.files?.[0]);
            }}
            className={`rounded-xl border-2 border-dashed p-5 transition-colors ${
              dropDisabled
                ? 'cursor-not-allowed border-white/10 bg-white/[0.01] opacity-60'
                : dragActive
                  ? 'cursor-pointer border-amber-400/50 bg-amber-500/10'
                  : croquiFile
                    ? 'cursor-pointer border-amber-500/35 bg-amber-500/5'
                    : 'cursor-pointer border-white/15 bg-white/[0.02] hover:border-amber-400/30 hover:bg-white/[0.03]'
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,application/zip"
              className="hidden"
              disabled={dropDisabled}
              onChange={(e) => {
                acceptZip(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pointer-events-none">
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`mt-0.5 rounded-xl p-2.5 ${
                    croquiFile ? 'bg-amber-500/15 text-amber-200' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  <Upload size={18} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {croquiFile
                      ? croquiFile.name
                      : dragActive
                        ? 'Solte o ZIP aqui'
                        : 'Arraste o ZIP da ATP aqui'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {croquiFile
                      ? `${(croquiFile.size / 1024).toFixed(0)} KB${croquiUploadId ? ' — importado' : ''}`
                      : 'Ou clique para selecionar · .shp, .shx, .dbf e .prj'}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200">
                <Upload size={16} />
                Selecionar ZIP
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={croquiProcessing || croquiUploading || !croquiFile}
              onClick={() => void startCroquiProcessing()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {croquiProcessing || croquiUploading ? <Loader2 size={16} className="animate-spin" /> : <Map size={16} />}
              Gerar croqui
            </button>
            <button
              type="button"
              onClick={resetCroquiDraft}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
            >
              Limpar
            </button>
          </div>

          {(croquiProcessing || croquiProgress > 0) && (
            <div className="space-y-2">
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-amber-500 to-orange-500 transition-all"
                  style={{ width: `${croquiProgress}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">{croquiMessage || 'Processando...'}</p>
            </div>
          )}

          {croquiMunicipio && (
            <p className="text-xs text-amber-200/80">Município detectado: {croquiMunicipio}</p>
          )}

          {croquiError && (
            <p className="text-sm text-red-300">{croquiError}</p>
          )}

          {croquiDownload && !croquiProcessing && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-2 text-emerald-200">
                <CheckCircle2 size={18} />
                <span className="text-sm font-medium">Croqui pronto</span>
                {croquiFiles.length > 0 && (
                  <span className="text-xs text-emerald-300/80">({croquiFiles.join(', ')})</span>
                )}
              </div>
              <button
                type="button"
                onClick={() => downloadCroquiZip()}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white"
              >
                <Download size={16} />
                Baixar ZIP
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
