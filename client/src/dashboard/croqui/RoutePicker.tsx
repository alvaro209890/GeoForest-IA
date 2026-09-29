import { Building2, CheckCircle2, ChevronDown, Loader2, MapPin, RotateCcw, Route } from 'lucide-react';
import type { CroquiRouteOptionsResponse } from './types';
import { formatKm, routeColor } from './routePreview';
import { MUNICIPIOS_MT } from './municipiosMt';
import StartPointMap from './StartPointMap';

export type RoutePickerProps = {
  data: CroquiRouteOptionsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  onMoveStart: (lon: number, lat: number) => void;
  municipioPartida?: string | null;
  onMunicipioChange?: (municipio: string) => void;
  onResetToCityCenter?: () => void;
};

/**
 * O caminho mais curto nem sempre é o que se usa em campo. Aqui os corredores
 * encontrados aparecem lado a lado, sobre um mapa de satélite navegável
 * (pan/zoom livres), com opção de selecionar o município de partida ou arrastar/
 * clicar pra mudar de onde o croqui parte — antes de gerar.
 */
export default function RoutePicker({
  data,
  selectedId,
  onSelect,
  disabled,
  onMoveStart,
  municipioPartida,
  onMunicipioChange,
  onResetToCityCenter,
}: RoutePickerProps) {
  const currentMunicipio =
    municipioPartida || data.municipioPartida || data.municipioNome || 'Canarana';
  const isCustomStart = data.startSource === 'customizado';

  const handleSelectMunicipio = (novo: string) => {
    if (!novo || novo === currentMunicipio || disabled) return;
    onMunicipioChange?.(novo);
  };

  const handleResetCity = () => {
    if (disabled) return;
    if (onResetToCityCenter) {
      onResetToCityCenter();
    } else if (onMunicipioChange) {
      onMunicipioChange(currentMunicipio);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <StartPointMap
        data={data}
        selectedId={selectedId}
        onSelect={onSelect}
        onMoveStart={onMoveStart}
        disabled={disabled}
      />

      <div className="space-y-3">
        {/* Seletor de Município de Partida */}
        <div className="rounded-xl border border-amber-400/25 bg-amber-500/[0.06] p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-amber-200">
              <Building2 size={14} className="text-amber-400" />
              Município de partida
            </span>
            {disabled && (
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-300/80">
                <Loader2 size={11} className="animate-spin" />
                Recalculando...
              </span>
            )}
          </div>

          <div className="relative">
            <select
              value={currentMunicipio}
              disabled={disabled}
              onChange={(e) => handleSelectMunicipio(e.target.value)}
              className="w-full appearance-none rounded-xl border border-white/15 bg-black/50 py-2.5 pl-3.5 pr-9 text-xs font-semibold text-white outline-none transition-all hover:border-amber-400/40 focus:border-amber-400 focus:ring-1 focus:ring-amber-500/20 cursor-pointer disabled:opacity-50"
            >
              {!MUNICIPIOS_MT.some(
                (m) => m.nome.toLowerCase() === currentMunicipio.toLowerCase(),
              ) && (
                <option value={currentMunicipio} className="bg-[#0b1412] text-white">
                  {currentMunicipio}
                </option>
              )}
              {MUNICIPIOS_MT.map((m) => (
                <option key={m.ibge} value={m.nome} className="bg-[#0b1412] text-white">
                  {m.nome}
                </option>
              ))}
            </select>
            <ChevronDown
              size={15}
              className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
          </div>

          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span>
              Partindo de: <strong className="text-amber-100">{currentMunicipio}</strong>
            </span>
            {isCustomStart && (
              <button
                type="button"
                disabled={disabled}
                onClick={handleResetCity}
                title="Voltar o ponto de partida para a sede do município"
                className="inline-flex items-center gap-1 text-[10px] text-amber-300 hover:text-amber-200 hover:underline disabled:opacity-50"
              >
                <RotateCcw size={10} />
                Restaurar sede
              </button>
            )}
          </div>
        </div>

        {/* Status da Partida / Rótulo */}
        {data.startLabel && (
          <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
            <span className="font-semibold text-amber-200">Partida atual:</span> {data.startLabel}
            {isCustomStart && (
              <span className="ml-1 text-[10px] text-slate-500">(ajustado no mapa)</span>
            )}
          </p>
        )}

        {/* Título de caminhos avaliados */}
        <div className="pt-1">
          <p className="text-xs font-semibold text-slate-300">
            Caminhos avaliados a partir de{' '}
            <span className="text-amber-200 font-bold">{currentMunicipio}</span>
          </p>
          <p className="text-[11px] text-slate-500">
            {data.options.length > 1
              ? 'Selecione o traçado que melhor representa o acesso real:'
              : 'Traçado calculado até a propriedade:'}
          </p>
        </div>

        {/* Lista de opções */}
        <div className="space-y-2">
          {data.options.map((option, index) => {
            const selected = option.id === selectedId;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => onSelect(option.id)}
                className={`w-full rounded-xl border p-3 text-left transition-colors disabled:opacity-60 ${
                  selected
                    ? 'border-amber-400/60 bg-amber-500/10'
                    : 'border-white/10 bg-white/[0.02] hover:border-white/25'
                }`}
              >
                <div className="flex items-start gap-2">
                  <span
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: routeColor(index) }}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-white">
                      <Route size={13} className="shrink-0 text-slate-400" />
                      <span className="truncate">{option.label}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {formatKm(option.totalDistanceM)}
                      {option.roads.length > 0 && ` · ${option.roads.join(', ')}`}
                    </p>
                    {option.recommended && (
                      <span className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                        <CheckCircle2 size={10} />
                        Mais curto
                      </span>
                    )}
                  </div>
                  {selected && <MapPin size={16} className="shrink-0 text-amber-300" />}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
