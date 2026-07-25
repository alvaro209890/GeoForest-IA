import React from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CheckSquare,
  Cpu,
  Download,
  Loader2,
  Satellite,
  Search,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { CbersMapPreview } from '@/dashboard/components/CbersMapPreview';
import {
  cbersArchiveZipFilename,
  cbersArchiveZipUrl,
  cbersBatchZipFilename,
} from '@/dashboard/cbers/filenames';
import type { UseCbersJobsReturn } from '@/dashboard/hooks/useCbersJobs';

export type CbersPanelProps = {
  cbers: UseCbersJobsReturn;
};

export default function CbersPanel({ cbers }: CbersPanelProps) {
  const {
    cbersFile,
    setCbersFile,
    setCbersPropertyZipB64,
    cbersSearching,
    setCbersScenes,
    setCbersSelectedSceneId,
    cbersSelectedSceneIds,
    setCbersSelectedSceneIds,
    cbersPreviewScene,
    setCbersPreviewScene,
    cbersOrbit,
    setCbersOrbit,
    cbersPoint,
    setCbersPoint,
    cbersCarNumber,
    setCbersCarNumber,
    cbersDateStart,
    setCbersDateStart,
    cbersDateEnd,
    setCbersDateEnd,
    cbersMaxCloudCover,
    setCbersMaxCloudCover,
    setCbersLevelFilter,
    cbersSortOrder,
    setCbersSortOrder,
    cbersAreaHa,
    setCbersAreaHa,
    cbersPropertyGeometry,
    setCbersPropertyGeometry,
    cbersEstimating,
    cbersProcessing,
    setCbersProcessing,
    cbersHistory,
    cbersJobId,
    cbersProgress,
    cbersError,
    setCbersError,
    cbersWmsDownloadingId,
    cbersFileInputRef,
    cbersVisibleScenes,
    cbersSelectedScenes,
    toggleCbersSceneSelection,
    applyCbersZipFile,
    searchCbersScenes,
    startCbersProcessing,
    downloadCbersWmsZip,
    downloadZip: downloadSimcarZip,
    requestProcessCancel,
    cbersScenes,
  } = cbers;

  return (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-6xl mx-auto space-y-5 sm:space-y-6">
              <section className="rounded-2xl border border-cyan-500/15 bg-[#071113]/80 p-5 sm:p-6 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-cyan-200">
                      <Satellite size={13} />
                      CBERS-4A WPM
                    </div>
                    <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">GeoTIFF 3-4-2 com pancromática</h2>
                    <p className="max-w-3xl text-sm text-slate-400">
                      Busque por ZIP/SHP ou por órbita, ponto e data, escolha uma cena L4 pública do STAC INPE e gere a folha completa em .tif para ArcMap.
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'Fonte', value: 'INPE STAC' },
                      { label: 'Coleção', value: 'L4-DN' },
                      { label: 'Saída', value: 'GeoTIFF' },
                    ].map((item) => (
                      <div key={item.label} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">{item.label}</p>
                        <p className="mt-1 text-xs font-semibold text-cyan-100">{item.value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
                <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-semibold text-white">Área de interesse</h3>
                      <p className="text-xs text-slate-500 mt-1">Use ZIP/SHP da ATP, Nº do CAR estadual ou filtre direto por órbita e ponto.</p>
                    </div>
                    {cbersAreaHa !== null && (
                      <span className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs font-semibold text-cyan-200">
                        {cbersAreaHa.toFixed(2)} ha
                      </span>
                    )}
                  </div>

                  <div>
                    <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nº do CAR estadual</label>
                    <input
                      type="text"
                      value={cbersCarNumber}
                      onChange={(e) => {
                        const value = e.target.value.trim();
                        setCbersCarNumber(value);
                        if (value) {
                          setCbersFile(null);
                          setCbersPropertyZipB64(null);
                          setCbersScenes([]);
                          setCbersSelectedSceneId(null);
                          setCbersSelectedSceneIds([]);
                          setCbersPreviewScene(null);
                          setCbersPropertyGeometry(null);
                          setCbersAreaHa(null);
                          setCbersError(null);
                          if (cbersFileInputRef.current) cbersFileInputRef.current.value = '';
                        }
                      }}
                      disabled={Boolean(cbersFile)}
                      placeholder="Ex: MT-5107768-XXXXXXX..."
                      className={`w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-cyan-500/50 ${cbersFile ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
                    />
                    <p className="mt-1 text-[10px] text-slate-500">
                      {cbersCarNumber.trim()
                        ? 'A ATP será buscada automaticamente no WFS da SEMA, pelo mesmo sistema do recorte SIMCAR.'
                        : cbersFile
                          ? 'Remova o ZIP para buscar pelo Nº do CAR.'
                          : 'Preencha para usar a geometria do CAR estadual sem enviar ZIP.'}
                    </p>
                  </div>

                  <label
                    className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${cbersCarNumber.trim()
                      ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
                      : cbersFile
                        ? 'border-cyan-500/40 bg-cyan-500/5 cursor-pointer'
                        : 'border-white/10 bg-white/[0.02] hover:border-cyan-500/30 hover:bg-white/[0.03] cursor-pointer'
                      }`}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (!cbersCarNumber.trim()) e.dataTransfer.dropEffect = 'copy';
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      if (cbersCarNumber.trim()) return;
                      applyCbersZipFile(e.dataTransfer.files?.[0] || null);
                    }}
                  >
                    <input
                      ref={cbersFileInputRef}
                      type="file"
                      accept=".zip,application/zip"
                      className="hidden"
                      disabled={Boolean(cbersCarNumber.trim())}
                      onChange={(e) => {
                        applyCbersZipFile(e.target.files?.[0] || null);
                      }}
                    />
                    <div className={`rounded-xl p-3 ${cbersFile ? 'bg-cyan-500/15 text-cyan-200' : cbersCarNumber.trim() ? 'bg-white/5 text-slate-600' : 'bg-white/5 text-slate-400 group-hover:text-cyan-300'}`}>
                      <Upload size={22} />
                    </div>
                    <div className="text-center min-w-0">
                      <p className="text-sm font-semibold text-white truncate">
                        {cbersCarNumber.trim() ? 'Upload desabilitado pelo Nº do CAR' : cbersFile ? cbersFile.name : 'Arraste ou selecione o ZIP da ATP'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {cbersFile ? `${(cbersFile.size / 1024).toFixed(0)} KB` : cbersCarNumber.trim() ? 'Limpe o CAR para enviar ZIP/SHP.' : 'Shapefile compactado em .zip'}
                      </p>
                    </div>
                    {cbersFile && !cbersCarNumber.trim() && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCbersFile(null);
                          setCbersPropertyZipB64(null);
                          setCbersScenes([]);
                          setCbersSelectedSceneId(null);
                          setCbersSelectedSceneIds([]);
                          setCbersPreviewScene(null);
                          setCbersPropertyGeometry(null);
                          setCbersAreaHa(null);
                          setCbersError(null);
                          if (cbersFileInputRef.current) cbersFileInputRef.current.value = '';
                        }}
                        className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
                        aria-label="Remover ZIP CBERS"
                      >
                        <X size={16} />
                      </button>
                    )}
                  </label>

                  {cbersError && (
                    <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
                      <AlertTriangle size={16} />
                      <span>{cbersError}</span>
                    </div>
                  )}

                  <div className="rounded-2xl border border-cyan-500/10 bg-[#071113]/70 p-3 sm:p-4 space-y-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Filtros da busca</p>
                        <p className="text-xs text-slate-500">Combine órbita/ponto, nuvem e período sem perder a seleção da área. A geração usa somente cenas L4.</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setCbersOrbit('');
                          setCbersPoint('');
                          setCbersDateStart('');
                          setCbersDateEnd('');
                          setCbersMaxCloudCover('');
                          setCbersLevelFilter('L4');
                          setCbersSortOrder('desc');
                        }}
                        className="self-start rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:bg-white/5 hover:text-white sm:self-auto"
                      >
                        Limpar filtros
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
                      <div className="md:col-span-3 lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Órbita</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cbersOrbit}
                          onChange={(e) => setCbersOrbit(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                          placeholder="213"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                        />
                      </div>
                      <div className="md:col-span-3 lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ponto</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={cbersPoint}
                          onChange={(e) => setCbersPoint(e.target.value.replace(/\D+/g, '').slice(0, 3))}
                          placeholder="129"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                        />
                      </div>
                      <div className="md:col-span-6 lg:col-span-3">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nível CBERS</label>
                        <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2.5 text-sm font-semibold text-emerald-100">
                          Somente L4-DN
                        </div>
                      </div>
                      <div className="md:col-span-4 lg:col-span-2">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nuvem máx.</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          max="100"
                          step="1"
                          value={cbersMaxCloudCover}
                          onChange={(e) => {
                            const value = e.target.value;
                            if (value === '') {
                              setCbersMaxCloudCover('');
                              return;
                            }
                            const numeric = Math.max(0, Math.min(100, Number(value)));
                            setCbersMaxCloudCover(Number.isFinite(numeric) ? String(numeric) : '');
                          }}
                          placeholder="100"
                          className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-cyan-500/50"
                        />
                      </div>
                      <div className="md:col-span-4 lg:col-span-3">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ordenação</label>
                        <select
                          value={cbersSortOrder}
                          onChange={(e) => setCbersSortOrder(e.target.value === 'asc' ? 'asc' : 'desc')}
                          className="w-full rounded-xl border border-white/10 bg-[#0b1412] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                        >
                          <option value="desc">Mais novas primeiro</option>
                          <option value="asc">Mais antigas primeiro</option>
                        </select>
                      </div>
                      <div className="md:col-span-6">
                        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Período</label>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="date"
                            value={cbersDateStart}
                            onChange={(e) => setCbersDateStart(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                          />
                          <input
                            type="date"
                            value={cbersDateEnd}
                            onChange={(e) => setCbersDateEnd(e.target.value)}
                            className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-cyan-500/50"
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3">
                    <button
                      type="button"
                      onClick={() => void searchCbersScenes()}
                      disabled={(!cbersFile && !cbersCarNumber.trim() && (!cbersOrbit.trim() || !cbersPoint.trim())) || cbersSearching || cbersProcessing}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cbersSearching ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
                      Buscar cenas
                    </button>
                    <button
                      type="button"
                      onClick={() => void startCbersProcessing()}
                      disabled={cbersSelectedSceneIds.length === 0 || cbersProcessing || cbersSelectedScenes.some((scene) => scene.coversArea === false || scene.wmsAvailable || (scene.level && scene.level !== 'L4'))}
                      className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {cbersProcessing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
                      Gerar L4 {cbersSelectedSceneIds.length > 1 ? `${cbersSelectedSceneIds.length} GeoTIFFs` : 'GeoTIFF'}
                    </button>
                  </div>

                  {cbersScenes.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-white">Cenas disponíveis</h3>
                        <span className="text-xs text-slate-500">{cbersVisibleScenes.length}/{cbersScenes.length} cena(s)</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cbersVisibleScenes.map((scene) => {
                          const selected = cbersSelectedSceneIds.includes(scene.id);
                          const date = scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : 'Sem data';
                          const coverage = Number(scene.coveragePercent ?? 0);
                          const hasCoverage = typeof scene.coveragePercent === 'number' && Number.isFinite(scene.coveragePercent);
                          const availableOnWms = scene.wmsAvailable && scene.wmsUrl;
                          const legacyNonL4 = Boolean(scene.level && scene.level !== 'L4');
                          const blocked = scene.coversArea === false || Boolean(availableOnWms) || legacyNonL4;
                          return (
                            <button
                              key={scene.id}
                              type="button"
                              onClick={() => setCbersPreviewScene(scene)}
                              className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-cyan-500/40 bg-cyan-500/10' : availableOnWms ? 'border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-400/40' : blocked ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-white/10 bg-white/[0.03] hover:border-cyan-500/25 hover:bg-cyan-500/[0.04]'}`}
                            >
                              <div className="flex gap-3">
                                <div className="h-16 w-16 rounded-lg border border-white/10 bg-black/30 overflow-hidden shrink-0">
                                  {scene.thumbnailUrl ? (
                                    <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="h-full w-full flex items-center justify-center text-slate-600">
                                      <Satellite size={20} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-semibold text-white truncate">{scene.id}</p>
                                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                    <p className="text-xs text-slate-400">{date}</p>
                                    {scene.level && (
                                      <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${scene.level === 'L4' ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200' : 'border-red-400/25 bg-red-400/10 text-red-200'}`}>
                                        {scene.level === 'L4' ? 'L4' : 'Legado'}
                                      </span>
                                    )}
                                  </div>
                                  <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                                    {scene.cloudCover === null ? 'Nuvem n/d' : `Nuvem ${scene.cloudCover.toFixed(1)}%`}
                                  </p>
                                  <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${scene.coversArea === false ? 'text-red-300' : hasCoverage ? 'text-emerald-300' : 'text-cyan-300'}`}>
                                    {hasCoverage ? `Cobertura ${coverage.toFixed(1)}%` : 'Busca por órbita/ponto'}
                                  </p>
                                  {availableOnWms && (
                                    <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                                        Disponível no WMS
                                      </p>
                                      <a
                                        href={scene.wmsUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="mt-1 inline-flex max-w-full items-center gap-1 text-[10px] font-medium text-cyan-200 hover:text-cyan-100"
                                      >
                                        <ArrowUpRight size={12} />
                                        <span className="truncate">{scene.wmsLayerName || scene.wmsUrl}</span>
                                      </a>
                                      <span
                                        role="button"
                                        tabIndex={0}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void downloadCbersWmsZip(scene);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key !== 'Enter' && e.key !== ' ') return;
                                          e.preventDefault();
                                          e.stopPropagation();
                                          void downloadCbersWmsZip(scene);
                                        }}
                                        className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                                      >
                                        {cbersWmsDownloadingId === scene.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        <span className="truncate">Baixar ZIP</span>
                                      </span>
                                    </div>
                                  )}
                                  {scene.alignmentStatus === 'failed_private' && (
                                    <div className="mt-2 rounded-lg border border-amber-500/25 bg-amber-500/10 p-2">
                                      <p className="text-[10px] font-semibold uppercase tracking-wider text-amber-200">Apenas download privado</p>
                                      <p className="mt-1 text-[10px] text-amber-100/80">{scene.alignmentWarning || 'Imagem com aviso de deslocamento; sem publicação WMS.'}</p>
                                    </div>
                                  )}
                                </div>
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleCbersSceneSelection(scene);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key !== 'Enter' && e.key !== ' ') return;
                                    e.preventDefault();
                                    e.stopPropagation();
                                    toggleCbersSceneSelection(scene);
                                  }}
                                  className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border ${selected ? 'border-cyan-500/40 bg-cyan-500/15 text-cyan-200' : 'border-white/10 bg-white/[0.04] text-slate-500'} ${blocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-cyan-200'}`}
                                  title={availableOnWms ? 'Já disponível no WMS' : selected ? 'Remover seleção' : 'Selecionar cena'}
                                >
                                  {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                                </span>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      {cbersVisibleScenes.length === 0 && (
                        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
                          Nenhuma cena dentro do filtro de data atual.
                        </div>
                      )}
                    </div>
                  )}
                  {cbersSelectedScenes.length > 0 && (
                    <div className="space-y-3 rounded-2xl border border-cyan-500/15 bg-cyan-500/[0.04] p-4">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-white">Selecionadas lado a lado</h3>
                          <p className="text-xs text-slate-500">Cada cena gera um GeoTIFF separado no mesmo lote.</p>
                        </div>
                        {cbersEstimating && (
                          <span className="inline-flex items-center gap-2 text-xs font-semibold text-cyan-200">
                            <Loader2 size={13} className="animate-spin" />
                            Estimando arquivos
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {cbersSelectedScenes.map((scene) => {
                          const estimate = scene.estimate;
                          return (
                            <div key={`selected-${scene.id}`} className="rounded-xl border border-white/10 bg-[#071113]/80 p-3">
                              <div className="flex gap-3">
                                <div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                                  {scene.thumbnailUrl ? (
                                    <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                                  ) : (
                                    <div className="flex h-full items-center justify-center text-slate-600">
                                      <Satellite size={22} />
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-semibold text-white">{scene.id}</p>
                                  <p className="mt-1 text-xs text-slate-400">
                                    {scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : 'Sem data'}
                                  </p>
                                  {scene.wmsAvailable && scene.wmsUrl && (
                                    <a
                                      href={scene.wmsUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-200 hover:bg-emerald-500/15"
                                    >
                                      <ArrowUpRight size={12} />
                                      <span className="truncate">Disponível no WMS</span>
                                    </a>
                                  )}
                                  <div className="mt-2 grid grid-cols-2 gap-2 text-[10px]">
                                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-300">
                                      Download: {estimate ? `${estimate.downloadMb.toFixed(1)} MB` : 'estimando'}
                                    </span>
                                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-300">
                                      Saída: {estimate ? `${estimate.outputMbEstimated.toFixed(1)} MB` : 'estimando'}
                                    </span>
                                    <span className="rounded-md bg-white/[0.04] px-2 py-1 text-slate-300">
                                      Tempo: {estimate ? `${Math.ceil(estimate.timeSecondsEstimated / 60)} min` : 'estimando'}
                                    </span>
                                    <span className={`rounded-md px-2 py-1 ${scene.coversArea === false ? 'bg-red-500/10 text-red-200' : typeof scene.coveragePercent === 'number' ? 'bg-emerald-500/10 text-emerald-200' : 'bg-cyan-500/10 text-cyan-200'}`}>
                                      {typeof scene.coveragePercent === 'number' ? `Cobertura: ${scene.coveragePercent.toFixed(1)}%` : 'Folha completa'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </section>

                <aside className="rounded-2xl border border-white/10 bg-[#071113]/80 p-5 sm:p-6 space-y-5">
                  {(() => {
                    const activeCbers = cbersJobId ? cbersHistory.find((item) => item.jobId === cbersJobId) : null;
                    const pct = Math.max(0, Math.min(100, Math.round(Number(cbersProgress?.percent ?? activeCbers?.percent ?? 0))));
                    const done = activeCbers?.status === 'completed';
                    const activeCbersZipUrl = cbersArchiveZipUrl(activeCbers);

                    let totalEstimatedSeconds = 0;
                    if (activeCbers?.mode === 'batch' && Array.isArray(activeCbers?.scenes)) {
                      totalEstimatedSeconds = activeCbers.scenes.reduce((acc, s) => acc + (s.estimate?.timeSecondsEstimated || 0), 0);
                    } else if (activeCbers?.scene?.estimate?.timeSecondsEstimated) {
                      totalEstimatedSeconds = activeCbers.scene.estimate.timeSecondsEstimated;
                    } else if (activeCbers?.estimate?.timeSecondsEstimated) {
                      totalEstimatedSeconds = activeCbers.estimate.timeSecondsEstimated;
                    }

                    let timeRemainingStr = '';
                    if (!done && pct > 0 && pct < 100 && (activeCbers?.status === 'processing' || cbersProcessing)) {
                      let secondsRemaining = 0;
                      if (totalEstimatedSeconds > 0) {
                        secondsRemaining = Math.max(0, Math.round(totalEstimatedSeconds * (100 - pct) / 100));
                      } else if (activeCbers?.createdAt || activeCbers?.timestamp) {
                        const startedAtMs = new Date(activeCbers.createdAt || activeCbers.timestamp).getTime();
                        const elapsedSeconds = Number.isFinite(startedAtMs)
                          ? Math.max(0, (Date.now() - startedAtMs) / 1000)
                          : 0;
                        secondsRemaining = elapsedSeconds > 0 ? Math.round((elapsedSeconds * (100 - pct)) / pct) : 0;
                      }
                      if (secondsRemaining > 60) {
                        timeRemainingStr = `~ ${Math.ceil(secondsRemaining / 60)} min restantes`;
                      } else if (secondsRemaining > 0) {
                        timeRemainingStr = `~ ${secondsRemaining} s restantes`;
                      } else {
                        timeRemainingStr = 'Concluindo...';
                      }
                    }

                    const activeStage = String(cbersProgress?.stage || activeCbers?.stage || '').toLowerCase();
                    const stageLabelByKey: Record<string, string> = {
                      queued: 'Na fila',
                      geometry: 'Lendo área',
                      scene: 'Validando cena',
                      download: 'Baixando bandas',
                      pansharpen: 'Fusionando folha completa',
                      geotiff: 'Gerando GeoTIFF',
                      alignment_check: 'Validando georreferenciamento',
                      alignment_correction: 'Ajustando georreferenciamento',
                      save: 'Salvando arquivo',
                      publish: 'Publicando WMS',
                      private_zip: 'Gerando ZIP privado',
                      zip: 'Compactando entrega',
                      completed: 'Concluído',
                      failed: 'Falhou',
                      cancelled: 'Cancelado',
                    };
                    const stageLabel = stageLabelByKey[activeStage] || cbersProgress?.stage || activeCbers?.stage || 'Aguardando';
                    const heavyServerStage = ['pansharpen', 'geotiff', 'publish'].includes(activeStage) && !done;
                    const progressMessage = cbersProgress?.message || activeCbers?.message || 'Envie uma área e busque cenas para iniciar.';

                    return (
                      <>
                        <div>
                          <h3 className="text-base font-semibold text-white">Processamento</h3>
                          <p className="mt-1 text-xs text-slate-500">{activeCbers?.scene?.id || activeCbers?.itemId || 'Nenhum job selecionado'}</p>
                        </div>
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs items-end">
                            <span className="font-medium text-slate-300">{stageLabel}</span>
                            <div className="flex flex-col items-end">
                              <span className="font-bold tabular-nums text-cyan-300">{pct}%</span>
                              {timeRemainingStr && (
                                <span className="text-[10px] text-cyan-200/70 font-medium">{timeRemainingStr}</span>
                              )}
                            </div>
                          </div>
                          <div className="h-3 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-emerald-400 transition-all duration-500" style={{ width: `${pct}%` }} />
                          </div>
                          {heavyServerStage && (
                            <div className="flex items-center gap-2 rounded-lg border border-cyan-400/10 bg-cyan-400/5 px-2.5 py-1.5 text-[10px] font-medium text-cyan-100/80">
                              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 animate-pulse" />
                              GDAL processando no servidor; nesta etapa o avanço pode ser estimado.
                            </div>
                          )}
                          <p className="min-h-[2rem] text-xs leading-relaxed text-slate-400">{progressMessage}</p>
                        </div>
                        {activeCbers?.alignmentStatus === 'failed_private' && (
                          <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-xs leading-relaxed text-amber-100">
                            <p className="font-semibold uppercase tracking-wider text-amber-200">Aviso de deslocamento</p>
                            <p className="mt-1">{activeCbers.alignmentWarning || 'A correção automática não validou a imagem. O arquivo está disponível apenas para este usuário e não foi publicado no WMS.'}</p>
                          </div>
                        )}
                        {cbersProcessing && cbersJobId && (
                          <button
                            type="button"
                            onClick={async () => {
                              await requestProcessCancel(cbersJobId);
                              setCbersProcessing(false);
                              setCbersError('Cancelamento solicitado.');
                            }}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/15 transition-colors"
                          >
                            <X size={16} />
                            Cancelar
                          </button>
                        )}
                        {done && activeCbersZipUrl && (
                          <button
                            type="button"
                            onClick={() => downloadSimcarZip(activeCbersZipUrl, cbersArchiveZipFilename(activeCbers))}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 transition-colors"
                          >
                            <Download size={17} />
                            Baixar cena em ZIP
                          </button>
                        )}
                        {done && activeCbers?.batchZipUrl && (
                          <button
                            type="button"
                            onClick={() => downloadSimcarZip(activeCbers.batchZipUrl, activeCbers.batchZipFilename || cbersBatchZipFilename(activeCbers.jobId))}
                            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors"
                          >
                            <Download size={17} />
                            Baixar todos em ZIP
                          </button>
                        )}
                        {Array.isArray(activeCbers?.scenes) && activeCbers.scenes.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Cenas do lote</p>
                            {activeCbers.scenes.map((sceneState) => (
                              <div key={sceneState.itemId} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-white">{sceneState.scene?.id || sceneState.itemId}</p>
                                    {sceneState.level || sceneState.scene?.level ? (
                                      <p className="mt-0.5 text-[10px] font-semibold text-cyan-200">{sceneState.level || sceneState.scene?.level}</p>
                                    ) : null}
                                    <p className="mt-1 text-[10px] text-slate-500">{sceneState.message || sceneState.stage || sceneState.status}</p>
                                  </div>
                                  <span className={`text-[10px] font-semibold uppercase ${sceneState.status === 'completed' ? 'text-emerald-300' : sceneState.status === 'failed' ? 'text-red-300' : sceneState.status === 'cancelled' ? 'text-orange-300' : 'text-cyan-300'}`}>
                                    {sceneState.percent}%
                                  </span>
                                </div>
                                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                                  <div className="h-full rounded-full bg-cyan-400" style={{ width: `${Math.max(0, Math.min(100, sceneState.percent))}%` }} />
                                </div>
                                {sceneState.status === 'completed' && cbersArchiveZipUrl(sceneState) && (
                                  <button
                                    type="button"
                                    onClick={() => downloadSimcarZip(cbersArchiveZipUrl(sceneState), cbersArchiveZipFilename(sceneState))}
                                    className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:bg-cyan-500"
                                  >
                                    <Download size={14} />
                                    Baixar cena em ZIP
                                  </button>
                                )}
                                {sceneState.alignmentStatus === 'failed_private' && (
                                  <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-2 text-[10px] text-amber-100">
                                    {sceneState.alignmentWarning || 'Cena disponível apenas como ZIP privado; não publicada no WMS.'}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {activeCbers?.outputBytes && (
                          <p className="text-center text-[10px] text-slate-500">
                            Arquivo final: {(activeCbers.outputBytes / 1024 / 1024).toFixed(1)} MB
                          </p>
                        )}
                        {activeCbers?.batchZipBytes && (
                          <p className="text-center text-[10px] text-slate-500">
                            ZIP do lote: {(activeCbers.batchZipBytes / 1024 / 1024).toFixed(1)} MB
                          </p>
                        )}
                      </>
                    );
                  })()}
                </aside>
              </div>
              {cbersPreviewScene && (() => {
                const previewDate = cbersPreviewScene.datetime
                  ? new Date(cbersPreviewScene.datetime).toLocaleString('pt-BR')
                  : 'Sem data';
                const selected = cbersSelectedSceneIds.includes(cbersPreviewScene.id);
                const availableOnWms = cbersPreviewScene.wmsAvailable && cbersPreviewScene.wmsUrl;
                const blocked = cbersPreviewScene.coversArea === false || Boolean(availableOnWms) || Boolean(cbersPreviewScene.level && cbersPreviewScene.level !== 'L4');
                const estimate = cbersPreviewScene.estimate;
                return createPortal(
                  <div
                    className="fixed inset-0 z-[999] flex items-center justify-center bg-black/80 backdrop-blur-md p-3 sm:p-4"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Pré-visualização da cena CBERS"
                    onClick={() => setCbersPreviewScene(null)}
                  >
                    <div
                      className="w-full max-w-5xl max-h-[94vh] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-[#071113] shadow-2xl custom-scrollbar"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-cyan-300">Pré-visualização da cena</p>
                          <h3 className="truncate text-base font-semibold text-white">{cbersPreviewScene.id}</h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => setCbersPreviewScene(null)}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-slate-300 hover:bg-white/15 hover:text-white"
                          title="Fechar"
                        >
                          <X size={16} />
                        </button>
                      </div>
                      <div className="grid grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)] gap-0">
                        <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,rgba(34,211,238,0.12),transparent_34%),linear-gradient(135deg,rgba(2,6,23,0.94),rgba(7,17,19,0.98))] p-3 sm:p-4">
                          {cbersPreviewScene.thumbnailUrl ? (
                            <>
                              <img
                                src={cbersPreviewScene.thumbnailUrl}
                                alt={cbersPreviewScene.id}
                                className="max-h-[64vh] min-h-[220px] w-full rounded-xl border border-white/10 bg-black/30 object-contain shadow-2xl"
                              />
                              <div className="pointer-events-none absolute bottom-4 left-4 rounded-full border border-white/10 bg-black/55 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-300 backdrop-blur">
                                Miniatura completa
                              </div>
                            </>
                          ) : (
                            <div className="flex h-full min-h-[220px] items-center justify-center text-slate-600">
                              <Satellite size={44} />
                            </div>
                          )}
                        </div>
                        <div className="space-y-4 p-5">
                          <CbersMapPreview
                            propertyGeometry={cbersPropertyGeometry}
                            sceneGeometry={cbersPreviewScene.geometry || null}
                          />
                          <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Data</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">{previewDate}</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Nuvem</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">
                                {cbersPreviewScene.cloudCover === null ? 'n/d' : `${cbersPreviewScene.cloudCover.toFixed(1)}%`}
                              </p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Bandas</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">3, 4, 2 + PAN</p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Nível</p>
                              <p className={`mt-1 text-sm font-semibold ${cbersPreviewScene.level && cbersPreviewScene.level !== 'L4' ? 'text-red-200' : 'text-emerald-200'}`}>
                                {cbersPreviewScene.level && cbersPreviewScene.level !== 'L4' ? 'Legado' : 'L4'}
                              </p>
                            </div>
                            <div className={`rounded-xl border p-3 ${cbersPreviewScene.coversArea === false ? 'border-red-500/20 bg-red-500/10' : typeof cbersPreviewScene.coveragePercent === 'number' ? 'border-emerald-500/20 bg-emerald-500/10' : 'border-cyan-500/20 bg-cyan-500/10'}`}>
                              <p className="text-[10px] uppercase tracking-wider text-slate-400">Cobertura</p>
                              <p className={`mt-1 text-sm font-semibold ${cbersPreviewScene.coversArea === false ? 'text-red-200' : typeof cbersPreviewScene.coveragePercent === 'number' ? 'text-emerald-200' : 'text-cyan-200'}`}>
                                {typeof cbersPreviewScene.coveragePercent === 'number' ? `${cbersPreviewScene.coveragePercent.toFixed(2)}%` : 'Folha completa'}
                              </p>
                            </div>
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Estimativa</p>
                              <p className="mt-1 text-sm font-semibold text-slate-100">
                                {estimate ? `${estimate.downloadMb.toFixed(1)} MB` : cbersEstimating ? 'Calculando...' : 'Pendente'}
                              </p>
                            </div>
                          </div>
                          {estimate && (
                            <div className="grid grid-cols-3 gap-3">
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Download</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-100">{estimate.downloadMb.toFixed(1)} MB</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">GeoTIFF</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-100">{estimate.outputMbEstimated.toFixed(1)} MB</p>
                              </div>
                              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500">Tempo</p>
                                <p className="mt-1 text-sm font-semibold text-cyan-100">{Math.ceil(estimate.timeSecondsEstimated / 60)} min</p>
                              </div>
                            </div>
                          )}
                          {cbersPreviewScene.alignmentStatus === 'failed_private' && (
                            <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-3 text-sm text-amber-100">
                              <p className="font-semibold">Imagem com aviso de deslocamento</p>
                              <p className="mt-1 text-xs text-amber-100/80">
                                {cbersPreviewScene.alignmentWarning || 'Esta imagem fica disponível apenas para download do usuário e não é publicada no WMS.'}
                              </p>
                            </div>
                          )}
                          {availableOnWms && (
                            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                              <div className="flex items-start gap-2">
                                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-300" />
                                <div className="min-w-0">
                                  <p className="font-semibold">Esta folha já está disponível no WMS.</p>
                                  <p className="mt-1 text-xs text-emerald-200/80">
                                    A mesma órbita/ponto já foi publicada no acervo local, inclusive quando ela foi gerada por outra conta. Use a imagem existente em vez de gerar novamente.
                                  </p>
                                  <a
                                    href={cbersPreviewScene.wmsUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-2 inline-flex max-w-full items-center gap-1 text-xs font-semibold text-cyan-100 hover:text-white"
                                  >
                                    <ArrowUpRight size={13} />
                                    <span className="truncate">{cbersPreviewScene.wmsLayerName || cbersPreviewScene.wmsUrl}</span>
                                  </a>
                                  <button
                                    type="button"
                                    onClick={() => void downloadCbersWmsZip(cbersPreviewScene)}
                                    disabled={cbersWmsDownloadingId === cbersPreviewScene.id}
                                    className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-50 transition-colors hover:bg-emerald-400/15 disabled:opacity-60"
                                  >
                                    {cbersWmsDownloadingId === cbersPreviewScene.id ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                    Baixar ZIP da imagem
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                          {cbersPreviewScene.coversArea === false && (
                            <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                              Esta cena não cobre 100% do imóvel e está bloqueada para evitar GeoTIFF incompleto.
                            </div>
                          )}
                          {cbersPreviewScene.bbox && (
                            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">BBox</p>
                              <p className="mt-1 break-all font-mono text-xs text-slate-300">
                                {cbersPreviewScene.bbox.map((value) => value.toFixed(5)).join(', ')}
                              </p>
                            </div>
                          )}
                          <div className="flex flex-col sm:flex-row gap-3 pt-1">
                            <button
                              type="button"
                              onClick={() => {
                                toggleCbersSceneSelection(cbersPreviewScene);
                                setCbersPreviewScene(null);
                              }}
                              disabled={blocked}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-cyan-600 px-4 py-3 text-sm font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
                            >
                              {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                              {selected ? 'Remover seleção' : 'Selecionar cena'}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (availableOnWms) return;
                                setCbersSelectedSceneId(cbersPreviewScene.id);
                                if (!cbersSelectedSceneIds.includes(cbersPreviewScene.id)) {
                                  setCbersSelectedSceneIds((prev) => [...prev, cbersPreviewScene.id]);
                                }
                                setCbersPreviewScene(null);
                                void startCbersProcessing(cbersPreviewScene.id);
                              }}
                              disabled={cbersProcessing || blocked}
                              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                            >
                              <Cpu size={17} />
                              Gerar esta imagem
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>,
                  document.body,
                );
              })()}
            </div>
          </div>

  );
}
