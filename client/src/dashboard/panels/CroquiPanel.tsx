import { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FolderOpen,
  Loader2,
  Map,
  RefreshCw,
  Route,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import RoutePicker from '../croqui/RoutePicker';
import type { CroquiUploadSummary } from '../croqui/types';
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
    croquiFilename,
    croquiRoutes,
    croquiRouteId,
    setCroquiRouteId,
    croquiLoadingRoutes,
    loadCroquiRouteOptions,
    recalculateCroquiFromPoint,
    applyZipFile,
    startCroquiProcessing,
    downloadCroquiZip,
    resetCroquiDraft,
    fileInputRef,
    availableUploads,
    availableUploadsLoading,
    loadAvailableUploads,
    selectExistingUpload,
  } = croqui;

  const [dragActive, setDragActive] = useState(false);
  const [uploadsOpen, setUploadsOpen] = useState(false);
  const busy = croquiProcessing || croquiUploading || croquiLoadingRoutes;
  const dropDisabled = busy;
  const hasChoice = !!croquiRoutes && croquiRoutes.options.length > 1;
  const hasRemoteFile = !croquiFile && !!croquiUploadId;
  const lastCompleted = croquiDownload && !croquiProcessing;
  const missingBasemap = lastCompleted && croqui.croquiHistory.find((h) => h.jobId === croqui.croquiJobId)?.hasBasemapImage === false;

  const handleMoveStart = (lon: number, lat: number) => {
    void recalculateCroquiFromPoint(lon, lat);
  };

  const acceptZip = (file: File | null | undefined) => {
    if (!file || dropDisabled) return;
    if (!isZipFile(file)) {
      toast.error('Envie um arquivo .zip com o shapefile ATP.');
      return;
    }
    applyZipFile(file);
  };

  const toggleUploads = () => {
    const opening = !uploadsOpen;
    setUploadsOpen(opening);
    if (opening && availableUploads.length === 0) {
      void loadAvailableUploads();
    }
  };

  const handleSelectUpload = (summary: CroquiUploadSummary) => {
    selectExistingUpload(summary);
    setUploadsOpen(false);
  };

  const formatDate = (iso: string): string => {
    if (!iso) return '';
    try {
      const d = new Date(iso);
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch {
      return iso;
    }
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
                O sistema detecta o município e procura os caminhos de acesso; havendo mais de um,
                você escolhe por onde o croqui segue antes de gerar o PDF, o Word e o KML.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center shrink-0">
              {[
                { label: 'Entrada', value: 'ZIP ATP' },
                { label: 'Rota', value: 'Você escolhe' },
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

          {/* ATP guardados — reuso de uploads anteriores */}
          <div className="space-y-2">
            <button
              type="button"
              onClick={toggleUploads}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-2.5 text-sm text-slate-300 hover:bg-white/5 hover:border-amber-400/30 disabled:opacity-50 transition-colors"
            >
              <FolderOpen size={16} className={uploadsOpen ? 'text-amber-300' : 'text-slate-400'} />
              ATP guardados
              {availableUploads.length > 0 && (
                <span className="ml-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
                  {availableUploads.length}
                </span>
              )}
              {uploadsOpen ? <ChevronUp size={14} className="text-slate-500" /> : <ChevronDown size={14} className="text-slate-500" />}
            </button>

            {uploadsOpen && (
              <div className="rounded-xl border border-white/10 bg-[#0a1210] p-3 space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                {availableUploadsLoading ? (
                  <div className="flex items-center gap-2 py-4 justify-center text-sm text-slate-400">
                    <Loader2 size={16} className="animate-spin" />
                    Carregando ATPs salvos...
                  </div>
                ) : availableUploads.length === 0 ? (
                  <p className="py-3 text-center text-sm text-slate-500">
                    Nenhum ATP salvo. Arraste um ZIP para começar.
                  </p>
                ) : (
                  availableUploads.map((u) => (
                    <button
                      key={u.uploadId}
                      type="button"
                      disabled={busy}
                      onClick={() => handleSelectUpload(u)}
                      className={`w-full flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        croquiUploadId === u.uploadId
                          ? 'bg-amber-500/10 border border-amber-400/20'
                          : 'bg-white/[0.02] border border-transparent hover:bg-white/[0.05] hover:border-amber-400/15'
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{u.filename}</p>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="flex items-center gap-1 text-[11px] text-slate-500">
                            <Clock size={11} />
                            {formatDate(u.createdAt)}
                          </span>
                          {u.municipioNome && (
                            <span className="text-[11px] text-amber-300/70">{u.municipioNome}</span>
                          )}
                          <span className="text-[11px] text-slate-600">{u.polygonCount} pol.</span>
                        </div>
                      </div>
                      {croquiUploadId === u.uploadId && (
                        <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-200">
                          Em uso
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
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
                  : croquiFile || hasRemoteFile
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
                    croquiFile || hasRemoteFile ? 'bg-amber-500/15 text-amber-200' : 'bg-white/5 text-slate-400'
                  }`}
                >
                  {hasRemoteFile ? <FolderOpen size={18} /> : <Upload size={18} />}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-200 truncate">
                    {croquiFile
                      ? croquiFile.name
                      : hasRemoteFile
                        ? croquiFilename
                        : dragActive
                          ? 'Solte o ZIP aqui'
                          : 'Arraste o ZIP da ATP aqui'}
                  </p>
                  <p className="text-xs text-slate-500 mt-1">
                    {croquiFile
                      ? `${(croquiFile.size / 1024).toFixed(0)} KB${croquiUploadId ? ' — importado' : ''}`
                      : hasRemoteFile
                        ? `ATP salvo${croquiMunicipio ? ` — ${croquiMunicipio}` : ''}`
                        : 'Ou clique para selecionar · .shp, .shx, .dbf e .prj'}
                  </p>
                </div>
              </div>
              <span className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-200">
                {hasRemoteFile ? <FolderOpen size={16} /> : <Upload size={16} />}
                {hasRemoteFile ? 'Substituir ZIP' : 'Selecionar ZIP'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={busy || (!croquiFile && !hasRemoteFile)}
              onClick={() => void startCroquiProcessing()}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 px-5 py-3 text-sm font-semibold text-white disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Map size={16} />}
              {croquiLoadingRoutes
                ? 'Procurando caminhos...'
                : hasChoice
                  ? 'Gerar croqui com este caminho'
                  : 'Gerar croqui'}
            </button>
            {!!croquiRoutes && (
              <button
                type="button"
                disabled={busy || !croquiUploadId}
                onClick={() => void loadCroquiRouteOptions(croquiUploadId as string)}
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
              >
                <RefreshCw size={15} />
                Recalcular caminhos
              </button>
            )}
            <button
              type="button"
              onClick={resetCroquiDraft}
              className="rounded-xl border border-white/10 px-4 py-3 text-sm text-slate-300 hover:bg-white/5"
            >
              Limpar
            </button>
          </div>

          {croquiLoadingRoutes && (
            <p className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 size={13} className="animate-spin" />
              Procurando os caminhos de acesso possíveis — isso leva alguns segundos.
            </p>
          )}

          {croquiRoutes && !croquiProcessing && (
            <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-start gap-2">
                <Route size={16} className="mt-0.5 shrink-0 text-amber-300" />
                <div>
                  <p className="text-sm font-semibold text-white">
                    {hasChoice
                      ? `${croquiRoutes.options.length} caminhos de acesso encontrados`
                      : 'Caminho de acesso encontrado'}
                  </p>
                  <p className="text-xs text-slate-400">
                    {hasChoice
                      ? 'O mais curto nem sempre é o que se usa em campo. Escolha o traçado correto antes de gerar — ele vai para o PDF, o Word e o KML.'
                      : 'Confira o traçado sobre o mapa de satélite antes de gerar o croqui.'}
                    {' '}Navegue livremente pelo mapa e arraste ou clique para mudar de onde o croqui parte.
                  </p>
                </div>
              </div>
              <RoutePicker
                data={croquiRoutes}
                selectedId={croquiRouteId}
                onSelect={setCroquiRouteId}
                disabled={busy}
                onMoveStart={handleMoveStart}
              />
            </div>
          )}

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

          {missingBasemap && (
            <p className="flex items-center gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              <AlertTriangle size={14} className="shrink-0" />
              Este croqui saiu sem a imagem de satélite (provedor indisponível no momento). O
              roteiro e o traçado estão corretos; se quiser a imagem, recalcule os caminhos e gere de novo.
            </p>
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
