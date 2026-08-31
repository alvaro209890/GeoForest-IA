/**
 * Área de interesse, filtros, composições e lista de cenas NDVI.
 */
import React from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  CheckSquare,
  Cpu,
  Download,
  Layers,
  Loader2,
  Satellite,
  Search,
  Square,
  Upload,
  X,
} from 'lucide-react';
import {
  CAR_ESTADUAL_PLACEHOLDER,
  ndviSceneZipFilename,
  ndviSceneZipPath,
} from '@/dashboard/ndvi/filenames';
import { NDVI_COMPOSITION_META } from '@/dashboard/ndvi/types';
import { resolveBackendUrl } from '@/lib/api';
import type { NdviPanelProps } from './NdviPanel';

export function NdviSceneSelector({ ndvi }: NdviPanelProps) {
  const {
    ndviFile,
    setNdviFile,
    setNdviPropertyZipB64,
    ndviSearching,
    setNdviScenes,
    ndviSelectedSceneId,
    setNdviSelectedSceneId,
    ndviSelectedSceneIds,
    setNdviSelectedSceneIds,
    setNdviPreviewScene,
    ndviOrbit,
    setNdviOrbit,
    ndviPoint,
    setNdviPoint,
    ndviCarNumber,
    setNdviCarNumber,
    ndviDateStart,
    setNdviDateStart,
    ndviDateEnd,
    setNdviDateEnd,
    ndviMaxCloudCover,
    setNdviMaxCloudCover,
    ndviAreaHa,
    setNdviAreaHa,
    setNdviPropertyGeometry,
    ndviCompositions,
    ndviProcessing,
    ndviError,
    setNdviError,
    ndviFileInputRef,
    ndviVisibleScenes,
    ndviSelectedScenes,
    toggleNdviSceneSelection,
    toggleNdviComposition,
    applyNdviZipFile,
    searchNdviScenes,
    startNdviJobs,
    ndviScenes,
  } = ndvi;

  return (
    <section className="rounded-2xl border border-white/10 bg-[#0b1412]/80 p-5 sm:p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-white">Área de interesse</h3>
          <p className="text-xs text-slate-500 mt-1">Use ZIP/SHP da ATP, Nº do CAR estadual ou filtre direto por órbita e ponto.</p>
        </div>
        {ndviAreaHa !== null && (
          <span className="rounded-full border border-lime-500/20 bg-lime-500/10 px-3 py-1 text-xs font-semibold text-lime-200">
            {ndviAreaHa.toFixed(2)} ha
          </span>
        )}
      </div>

      <div>
        <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nº do CAR estadual</label>
        <input
          type="text"
          value={ndviCarNumber}
          onChange={(e) => {
            const value = e.target.value.trim();
            setNdviCarNumber(value);
            if (value) {
              setNdviFile(null);
              setNdviPropertyZipB64(null);
              setNdviScenes([]);
              setNdviSelectedSceneId(null);
              setNdviSelectedSceneIds([]);
              setNdviPreviewScene(null);
              setNdviPropertyGeometry(null);
              setNdviAreaHa(null);
              setNdviError(null);
              if (ndviFileInputRef.current) ndviFileInputRef.current.value = '';
            }
          }}
          disabled={Boolean(ndviFile)}
          placeholder={CAR_ESTADUAL_PLACEHOLDER}
          className={`w-full rounded-xl border bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-lime-500/50 ${ndviFile ? 'border-white/5 opacity-40 cursor-not-allowed' : 'border-white/10'}`}
        />
        <p className="mt-1 text-[10px] text-slate-500">
          {ndviCarNumber.trim()
            ? 'A ATP será buscada automaticamente no WFS da SEMA, pelo mesmo sistema do recorte SIMCAR.'
            : ndviFile
              ? 'Remova o ZIP para buscar pelo Nº do CAR.'
              : 'Use o CAR estadual (ex.: MT274719/2025), não o número federal do SICAR.'}
        </p>
      </div>

      <label
        className={`group relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 transition-all ${ndviCarNumber.trim()
          ? 'border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed'
          : ndviFile
            ? 'border-lime-500/40 bg-lime-500/5 cursor-pointer'
            : 'border-white/10 bg-white/[0.02] hover:border-lime-500/30 hover:bg-white/[0.03] cursor-pointer'
          }`}
        onDragOver={(e) => {
          e.preventDefault();
          if (!ndviCarNumber.trim()) e.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (ndviCarNumber.trim()) return;
          applyNdviZipFile(e.dataTransfer.files?.[0] || null);
        }}
      >
        <input
          ref={ndviFileInputRef}
          type="file"
          accept=".zip,application/zip"
          className="hidden"
          disabled={Boolean(ndviCarNumber.trim())}
          onChange={(e) => {
            applyNdviZipFile(e.target.files?.[0] || null);
          }}
        />
        <div className={`rounded-xl p-3 ${ndviFile ? 'bg-lime-500/15 text-lime-200' : ndviCarNumber.trim() ? 'bg-white/5 text-slate-600' : 'bg-white/5 text-slate-400 group-hover:text-lime-300'}`}>
          <Upload size={22} />
        </div>
        <div className="text-center min-w-0">
          <p className="text-sm font-semibold text-white truncate">
            {ndviCarNumber.trim() ? 'Upload desabilitado pelo Nº do CAR' : ndviFile ? ndviFile.name : 'Arraste ou selecione o ZIP da ATP'}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            {ndviFile ? `${(ndviFile.size / 1024).toFixed(0)} KB` : ndviCarNumber.trim() ? 'Limpe o CAR para enviar ZIP/SHP.' : 'Shapefile compactado em .zip'}
          </p>
        </div>
        {ndviFile && !ndviCarNumber.trim() && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setNdviFile(null);
              setNdviPropertyZipB64(null);
              setNdviScenes([]);
              setNdviSelectedSceneId(null);
              setNdviSelectedSceneIds([]);
              setNdviPreviewScene(null);
              setNdviPropertyGeometry(null);
              setNdviAreaHa(null);
              setNdviError(null);
              if (ndviFileInputRef.current) ndviFileInputRef.current.value = '';
            }}
            className="absolute right-3 top-3 rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-red-300"
            aria-label="Remover ZIP NDVI"
          >
            <X size={16} />
          </button>
        )}
      </label>

      {ndviError && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200 flex items-center gap-2">
          <AlertTriangle size={16} />
          <span>{ndviError}</span>
        </div>
      )}

      <div className="rounded-2xl border border-lime-500/10 bg-[#07130a]/70 p-3 sm:p-4 space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-lime-300">Filtros da busca</p>
            <p className="text-xs text-slate-500">Combine órbita/ponto, nuvem e período sem perder a seleção da área.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setNdviOrbit('');
              setNdviPoint('');
              setNdviDateStart('');
              setNdviDateEnd('');
              setNdviMaxCloudCover('');
            }}
            className="self-start rounded-lg border border-white/10 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-colors hover:bg-white/5 hover:text-white sm:self-auto"
          >
            Limpar filtros
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Órbita</label>
            <input
              type="text"
              inputMode="numeric"
              value={ndviOrbit}
              onChange={(e) => setNdviOrbit(e.target.value.replace(/\D+/g, '').slice(0, 3))}
              placeholder="224"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-lime-500/50"
            />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ponto</label>
            <input
              type="text"
              inputMode="numeric"
              value={ndviPoint}
              onChange={(e) => setNdviPoint(e.target.value.replace(/\D+/g, '').slice(0, 3))}
              placeholder="069"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-lime-500/50"
            />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Nuvem máx.</label>
            <input
              type="number"
              inputMode="decimal"
              min="0"
              max="100"
              step="1"
              value={ndviMaxCloudCover}
              onChange={(e) => {
                const value = e.target.value;
                if (value === '') {
                  setNdviMaxCloudCover('');
                  return;
                }
                const numeric = Math.max(0, Math.min(100, Number(value)));
                setNdviMaxCloudCover(Number.isFinite(numeric) ? String(numeric) : '');
              }}
              placeholder="100"
              className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none placeholder-slate-600 focus:border-lime-500/50"
            />
          </div>
          <div className="md:col-span-3">
            <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">Período</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="date"
                value={ndviDateStart}
                onChange={(e) => setNdviDateStart(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-lime-500/50"
              />
              <input
                type="date"
                value={ndviDateEnd}
                onChange={(e) => setNdviDateEnd(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-lime-500/50"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4 space-y-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-lime-300">Composições da cena completa</p>
          <p className="text-xs text-slate-500">Cada cena selecionada gera todas as composições marcadas abaixo.</p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {Object.values(NDVI_COMPOSITION_META).map((meta) => {
            const selected = ndviCompositions.includes(meta.key);
            return (
              <button
                key={meta.key}
                type="button"
                onClick={() => toggleNdviComposition(meta.key)}
                className={`text-left rounded-xl border p-3 transition-all ${selected ? meta.badgeClass : 'border-white/10 bg-white/[0.02] hover:border-lime-500/30 hover:bg-white/[0.04]'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-2 text-sm font-semibold text-white">
                    <span className={`inline-flex h-5 w-5 items-center justify-center rounded-md border ${selected ? 'border-current' : 'border-white/15'}`}>
                      {selected ? <CheckSquare size={14} /> : <Square size={14} />}
                    </span>
                    {meta.label}
                  </span>
                  <span className={`inline-block h-3 w-10 rounded-full bg-gradient-to-r ${meta.swatchClass}`} title={meta.description} />
                </div>
                <p className="mt-1.5 pl-7 text-[11px] leading-relaxed text-slate-400">{meta.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={() => void searchNdviScenes()}
          disabled={(!ndviFile && !ndviCarNumber.trim() && (!ndviOrbit.trim() || !ndviPoint.trim())) || ndviSearching || ndviProcessing}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-lime-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-lime-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ndviSearching ? <Loader2 size={17} className="animate-spin" /> : <Search size={17} />}
          Buscar cenas
        </button>
        <button
          type="button"
          onClick={() => void startNdviJobs()}
          disabled={ndviSelectedSceneIds.length === 0 || ndviProcessing || ndviCompositions.length === 0 || ndviSelectedScenes.some((scene) => scene.coversArea === false || scene.wmsAvailable)}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {ndviProcessing ? <Loader2 size={17} className="animate-spin" /> : <Cpu size={17} />}
          Gerar {ndviSelectedSceneIds.length > 1 ? `${ndviSelectedSceneIds.length} cenas` : 'cena'} completa
        </button>
      </div>

      {ndviScenes.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Cenas disponíveis</h3>
            <span className="text-xs text-slate-500">{ndviVisibleScenes.length}/{ndviScenes.length} cena(s)</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ndviVisibleScenes.map((scene) => {
              const selected = ndviSelectedSceneIds.includes(scene.id);
              const date = scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : 'Sem data';
              const coverage = Number(scene.coveragePercent ?? 0);
              const hasCoverage = typeof scene.coveragePercent === 'number' && Number.isFinite(scene.coveragePercent);
              const availableOnWms = scene.wmsAvailable && scene.wmsUrl;
              const blocked = scene.coversArea === false || Boolean(availableOnWms);
              const zipHref = resolveBackendUrl(ndviSceneZipPath(scene));
              return (
                <div
                  key={scene.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setNdviPreviewScene(scene)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter' && e.key !== ' ') return;
                    e.preventDefault();
                    setNdviPreviewScene(scene);
                  }}
                  className={`text-left rounded-xl border p-3 transition-all ${selected ? 'border-lime-500/40 bg-lime-500/10' : availableOnWms ? 'border-emerald-500/25 bg-emerald-500/[0.06] hover:border-emerald-400/40' : blocked ? 'border-red-500/20 bg-red-500/[0.04]' : 'border-white/10 bg-white/[0.03] hover:border-lime-500/25 hover:bg-lime-500/[0.04]'}`}
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
                        {(scene.platform || scene.platformLabel) && (
                          <span className="rounded-full border border-sky-400/25 bg-sky-400/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-200">
                            {scene.platformLabel || scene.platform}
                          </span>
                        )}
                        {scene.slcOff && (
                          <span className="rounded-full border border-amber-400/25 bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-bold text-amber-200">
                            SLC-off
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-500">
                        {scene.cloudCover === null ? 'Nuvem n/d' : `Nuvem ${scene.cloudCover.toFixed(1)}%`}
                      </p>
                      <p className={`mt-1 text-[10px] font-semibold uppercase tracking-wider ${scene.coversArea === false ? 'text-red-300' : hasCoverage ? 'text-emerald-300' : 'text-lime-300'}`}>
                        {hasCoverage ? `Cobertura ${coverage.toFixed(1)}%` : 'Busca por órbita/ponto'}
                      </p>
                      {availableOnWms && (
                        <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-2">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                            Disponível no acervo
                          </p>
                          <a
                            href={scene.wmsUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="mt-1 inline-flex max-w-full items-center gap-1 text-[10px] font-medium text-lime-200 hover:text-lime-100"
                          >
                            <ArrowUpRight size={12} />
                            <span className="truncate">{scene.wmsLayerName || scene.wmsUrl}</span>
                          </a>
                          {zipHref ? (
                            <a
                              href={zipHref}
                              download={ndviSceneZipFilename(scene)}
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-emerald-100 hover:bg-emerald-400/15"
                            >
                              <Download size={12} />
                              <span className="truncate">Baixar ZIP</span>
                            </a>
                          ) : null}
                        </div>
                      )}
                    </div>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleNdviSceneSelection(scene);
                      }}
                      onKeyDown={(e) => {
                        if (e.key !== 'Enter' && e.key !== ' ') return;
                        e.preventDefault();
                        e.stopPropagation();
                        toggleNdviSceneSelection(scene);
                      }}
                      className={`shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-lg border ${selected ? 'border-lime-500/40 bg-lime-500/15 text-lime-200' : 'border-white/10 bg-white/[0.04] text-slate-500'} ${blocked ? 'opacity-40 cursor-not-allowed' : 'hover:text-lime-200'}`}
                      title={availableOnWms ? 'Já disponível no acervo' : selected ? 'Remover seleção' : 'Selecionar cena'}
                    >
                      {selected ? <CheckSquare size={17} /> : <Square size={17} />}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {ndviVisibleScenes.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-400">
              Nenhuma cena dentro do filtro de data atual.
            </div>
          )}
        </div>
      )}

      {ndviSelectedScenes.length > 0 && (
        <div className="space-y-3 rounded-2xl border border-lime-500/15 bg-lime-500/[0.04] p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">Selecionadas</h3>
              <p className="text-xs text-slate-500">Cada cena gera um pacote separado com todas as composições marcadas.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {ndviSelectedScenes.map((scene) => (
              <div key={`selected-${scene.id}`} className="rounded-xl border border-white/10 bg-[#07130a]/80 p-3">
                <div className="flex gap-3">
                  <div className="h-20 w-24 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-black/30">
                    {scene.thumbnailUrl ? (
                      <img src={scene.thumbnailUrl} alt={scene.id} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-600">
                        <Layers size={22} />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-white">{scene.id}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {scene.datetime ? new Date(scene.datetime).toLocaleDateString('pt-BR') : 'Sem data'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {ndviCompositions.map((key) => (
                        <span
                          key={key}
                          className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] font-bold ${NDVI_COMPOSITION_META[key].badgeClass}`}
                        >
                          <span className={`inline-block h-2 w-2 rounded-full bg-gradient-to-r ${NDVI_COMPOSITION_META[key].swatchClass}`} />
                          {NDVI_COMPOSITION_META[key].label}
                        </span>
                      ))}
                    </div>
                    <p className={`mt-2 text-[10px] font-semibold uppercase tracking-wider ${scene.coversArea === false ? 'text-red-300' : typeof scene.coveragePercent === 'number' ? 'text-emerald-300' : 'text-lime-300'}`}>
                      {typeof scene.coveragePercent === 'number' ? `Cobertura: ${scene.coveragePercent.toFixed(1)}%` : 'Folha completa'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
