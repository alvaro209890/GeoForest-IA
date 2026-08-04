import { CheckCircle2, MapPin, Route } from 'lucide-react';
import type { CroquiRouteOptionsResponse } from './types';
import { formatKm, routeColor } from './routePreview';
import StartPointMap from './StartPointMap';

export type RoutePickerProps = {
  data: CroquiRouteOptionsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  onMoveStart: (lon: number, lat: number) => void;
};

/**
 * O caminho mais curto nem sempre é o que se usa em campo. Aqui os corredores
 * encontrados aparecem lado a lado, sobre um mapa de satélite navegável
 * (pan/zoom livres), para o usuário reconhecer o de sempre — ou arrastar/
 * clicar pra mudar de onde o croqui parte — antes de gerar.
 */
export default function RoutePicker({ data, selectedId, onSelect, disabled, onMoveStart }: RoutePickerProps) {
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <StartPointMap
        data={data}
        selectedId={selectedId}
        onSelect={onSelect}
        onMoveStart={onMoveStart}
        disabled={disabled}
      />

      <div className="space-y-2">
        {data.startLabel && (
          <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400">
            <span className="font-semibold text-amber-200">Partida atual:</span> {data.startLabel}
          </p>
        )}
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
  );
}
