/**
 * Área de interesse, filtros e lista de cenas CBERS.
 */
import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
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
import {
  CAR_ESTADUAL_PLACEHOLDER,
  cbersSceneZipFilename,
  cbersSceneZipPath,
} from '@/dashboard/cbers/filenames';
import { resolveBackendUrl } from '@/lib/api';
import type { CbersPanelProps } from '../CbersPanel';

export function CbersSceneSelector({ cbers }: CbersPanelProps) {
  const {
    cbersFile,
    setCbersFile,
    setCbersPropertyZipB64,
    cbersSearching,
    setCbersScenes,
    setCbersSelectedSceneId,
    cbersSelectedSceneIds,
    setCbersSelectedSceneIds,
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
    setCbersPropertyGeometry,
    cbersEstimating,
    cbersProcessing,
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
    cbersScenes,
  } = cbers;

  return (
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
          placeholder={CAR_ESTADUAL_PLACEHOLDER}
          className={`w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-cyan-500/50 ${cbersFile ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          {cbersCarNumber.trim()
            ? 'A ATP será buscada automaticamente no WFS da SEMA, pelo mesmo sistema do recorte SIMCAR.'
            : cbersFile
              ? 'Remova o ZIP para buscar pelo Nº do CAR.'
              : 'Use o CAR estadual (ex.: MT274719/2025), não o número federal do SICAR.'}
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
              const zipHref = resolveBackendUrl(cbersSceneZipPath(scene));
              return (
                <div
                  key={scene.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setCbersPreviewScene(scene)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    setCbersPreviewScene(scene);
                  }}
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
                          {zipHref ? (
                            <a
                              href={zipHref}
                              download={cbersSceneZipFilename(scene)}
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                            >
                              {cbersWmsDownloadingId === scene.id ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                              <span className="truncate">Baixar ZIP</span>
                            </a>
                          ) : null}
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
                </div>
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
  );
}
