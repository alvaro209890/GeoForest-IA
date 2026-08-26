import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import type { UseFiscalizacaoJobsReturn } from '../hooks/useFiscalizacaoJobs';
import { FISCALIZACAO_SOURCE_LABELS, type FiscalizacaoSource } from '../fiscalizacao/types';

export type FiscalizacaoPanelProps = {
  fiscalizacao: UseFiscalizacaoJobsReturn;
};

const FONTES: Array<{ id: FiscalizacaoSource; descricao: string }> = [
  { id: 'ibama', descricao: 'Embargos federais — PAMGIA' },
  { id: 'sema', descricao: 'Embargos, desembargos e autos estaduais' },
  { id: 'siga', descricao: 'Embargos, desembargos e autos do SIGA' },
];

export default function FiscalizacaoPanel({ fiscalizacao }: FiscalizacaoPanelProps) {
  const {
    fiscFile,
    fiscUploading,
    fiscUploadId,
    fiscPolygonCount,
    fiscAreaHa,
    fiscProcessing,
    fiscProgress,
    fiscMessage,
    fiscError,
    fiscDownload,
    fiscFiles,
    fiscWarnings,
    fiscResumo,
    fiscTotalIncidentes,
    applyZipFile,
    startFiscProcessing,
    downloadFiscZip,
    resetFiscDraft,
    fileInputRef,
  } = fiscalizacao;

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 rounded-full border border-rose-300/20 bg-rose-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] text-rose-100">
                <ShieldAlert size={13} />
                Fiscalização
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Embargos e autos de infração
              </h2>
              <p className="max-w-3xl text-sm text-slate-400">
                Importe a ATP do imóvel e o sistema cruza com as bases de fiscalização do IBAMA,
                da SEMA-MT e do SIGA, gerando um mapa por fonte com imagem de satélite.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center shrink-0">
              {[
                { label: 'Entrada', value: 'ZIP da ATP' },
                { label: 'Fontes', value: 'IBAMA + SEMA + SIGA' },
                { label: 'Saída', value: 'PDF + XLSX + SHP' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2"
                >
                  <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                  <p className="mt-1 text-xs font-semibold text-rose-100">{item.value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-white">1. ATP do imóvel</h3>
              <p className="text-xs text-slate-500 mt-1">
                Um imóvel por vez — envie o ZIP com o shapefile da ATP (com o arquivo .prj).
              </p>
            </div>
            {fiscUploading && <Loader2 size={18} className="animate-spin text-rose-300" />}
          </div>

          <label
            className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${
              fiscFile
                ? 'border-rose-500/40 bg-rose-500/5'
                : 'border-white/10 bg-white/[0.02] hover:border-rose-500/30 hover:bg-white/[0.03]'
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
                fiscFile
                  ? 'bg-rose-500/15 text-rose-200'
                  : 'bg-white/5 text-slate-400 group-hover:text-rose-300'
              }`}
            >
              <Upload size={22} />
            </div>
            <div className="text-center min-w-0">
              <p className="text-sm font-semibold text-white truncate">
                {fiscFile ? fiscFile.name : 'Arraste ou selecione o ZIP da ATP'}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {fiscFile ? `${(fiscFile.size / 1024).toFixed(0)} KB` : 'Shapefile compactado em .zip'}
              </p>
            </div>
            {fiscFile && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  resetFiscDraft();
                }}
                className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                aria-label="Remover ZIP"
              >
                <Trash2 size={16} />
              </button>
            )}
          </label>

          {fiscUploadId && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100 flex items-center gap-2">
              <CheckCircle2 size={16} />
              <span>
                ATP pronta: {fiscPolygonCount} polígono(s) · {fiscAreaHa.toFixed(4)} ha
              </span>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div>
            <h3 className="text-base font-semibold text-white">2. Fontes consultadas</h3>
            <p className="text-xs text-slate-500 mt-1">
              As três são consultadas sempre e geram um mapa cada.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {FONTES.map((fonte) => {
              const resumo = fiscResumo.find((r) => r.source === fonte.id);
              return (
                <div
                  key={fonte.id}
                  className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3"
                >
                  <p className="text-sm font-semibold text-white">
                    {FISCALIZACAO_SOURCE_LABELS[fonte.id]}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-500">{fonte.descricao}</p>
                  {resumo && (
                    <p
                      className={`mt-2 text-xs font-semibold ${
                        resumo.error
                          ? 'text-amber-300'
                          : resumo.incidentes > 0
                            ? 'text-red-300'
                            : 'text-emerald-300'
                      }`}
                    >
                      {resumo.error
                        ? 'Falha na consulta'
                        : `${resumo.total} feição(ões) · ${resumo.incidentes} incidente(s)`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void startFiscProcessing()}
              disabled={!fiscUploadId || fiscProcessing}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-rose-600 to-red-600 hover:from-rose-500 hover:to-red-500 disabled:opacity-40 py-2.5 px-4 text-sm font-semibold text-white shadow-lg shadow-rose-900/30"
            >
              {fiscProcessing ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <ShieldAlert size={16} />
              )}
              {fiscProcessing ? 'Processando...' : 'Gerar mapas'}
            </button>
            {fiscDownload && (
              <button
                type="button"
                onClick={() => void downloadFiscZip()}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 py-2.5 px-4 text-sm font-semibold text-white"
              >
                <Download size={16} />
                Baixar ZIP
              </button>
            )}
          </div>

          {(fiscProcessing || fiscProgress > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>{fiscMessage || 'Processando...'}</span>
                <span>{fiscProgress}%</span>
              </div>
              <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-rose-500 to-red-400 transition-all"
                  style={{ width: `${Math.max(2, fiscProgress)}%` }}
                />
              </div>
            </div>
          )}

          {typeof fiscTotalIncidentes === 'number' && !fiscProcessing && (
            <div
              className={`rounded-xl border p-3 text-sm flex items-center gap-2 ${
                fiscTotalIncidentes > 0
                  ? 'border-red-500/20 bg-red-500/10 text-red-100'
                  : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
              }`}
            >
              {fiscTotalIncidentes > 0 ? <AlertTriangle size={16} /> : <CheckCircle2 size={16} />}
              <span className="font-semibold">
                {fiscTotalIncidentes > 0
                  ? `${fiscTotalIncidentes} ocorrência(s) incidente(s) na ATP.`
                  : 'Nenhuma ocorrência incidente na ATP.'}
              </span>
            </div>
          )}

          {fiscError && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
              <AlertTriangle size={16} />
              <span>{fiscError}</span>
            </div>
          )}

          {fiscFiles.length > 0 && (
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100 space-y-1">
              <p className="font-semibold">Arquivos gerados</p>
              {fiscFiles.map((f) => (
                <p key={f} className="text-xs">
                  {f}
                </p>
              ))}
            </div>
          )}

          {fiscWarnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-xs text-amber-100 space-y-1">
              {fiscWarnings.map((w, i) => (
                <p key={`${w}-${i}`}>{w}</p>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
