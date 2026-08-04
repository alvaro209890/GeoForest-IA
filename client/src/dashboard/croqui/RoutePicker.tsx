import { useMemo, useRef, type MouseEvent } from 'react';
import { CheckCircle2, MapPin, MousePointerClick, Route } from 'lucide-react';
import type { CroquiRouteOptionsResponse } from './types';
import {
  buildProjection,
  buildProjectionFromFrame,
  formatKm,
  routeColor,
  toPolylinePoints,
  type LonLat,
} from './routePreview';

export type RoutePickerProps = {
  data: CroquiRouteOptionsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  /** Modo "mudar ponto de partida": um clique no mapa recalcula os caminhos a partir dali. */
  movingStart?: boolean;
  onMoveStart?: (lon: number, lat: number) => void;
};

const MAP_W = 560;
const MAP_H = 420;

/**
 * O caminho mais curto nem sempre é o que se usa em campo. Aqui os corredores
 * encontrados aparecem lado a lado, desenhados por cima do contorno do imóvel,
 * para o usuário reconhecer o de sempre antes de gerar o croqui — e, em modo
 * "mudar partida", um clique no mapa manda recalcular a partir de outro ponto.
 */
export default function RoutePicker({
  data,
  selectedId,
  onSelect,
  disabled,
  movingStart,
  onMoveStart,
}: RoutePickerProps) {
  const hasBasemap = !!data.basemap;
  const svgRef = useRef<SVGSVGElement | null>(null);

  const projection = useMemo(() => {
    if (hasBasemap && data.basemap) {
      return buildProjectionFromFrame({
        centerLon: data.basemap.centerLon,
        centerLat: data.basemap.centerLat,
        zoom: data.basemap.zoom,
        imageWidthPx: data.basemap.imageWidthPx,
        imageHeightPx: data.basemap.imageHeightPx,
        widthPt: MAP_W,
        heightPt: MAP_H,
      });
    }
    const groups: LonLat[][] = [
      ...data.options.map((option) => option.coordinates),
      ...data.atp,
      ...(data.start ? [[data.start]] : []),
    ];
    return buildProjection(groups, MAP_W, MAP_H);
  }, [data, hasBasemap]);

  const startPoint = useMemo(() => {
    if (!projection || !data.start) return null;
    return projection.project(data.start[0], data.start[1]);
  }, [projection, data.start]);

  const canMoveStart = movingStart && !!onMoveStart && !disabled;

  const handleMapClick = (event: MouseEvent<SVGSVGElement>) => {
    if (!canMoveStart || !projection) return;
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(ctm.inverse());
    const [lon, lat] = projection.unproject(local.x, local.y);
    onMoveStart?.(lon, lat);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="rounded-xl border border-white/10 bg-black/40 p-2">
        {canMoveStart && (
          <p className="mb-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            <MousePointerClick size={13} className="shrink-0" />
            Clique no mapa para mover a partida do croqui — os caminhos são recalculados a partir daí.
          </p>
        )}
        {projection ? (
          <svg
            ref={svgRef}
            viewBox={`0 0 ${MAP_W} ${MAP_H}`}
            className={`h-auto w-full ${canMoveStart ? 'cursor-crosshair' : ''}`}
            role="img"
            aria-label="Caminhos de acesso encontrados"
            onClick={handleMapClick}
          >
            {hasBasemap && data.basemap ? (
              <image
                href={data.basemap.dataUrl}
                x={0}
                y={0}
                width={MAP_W}
                height={MAP_H}
                preserveAspectRatio="none"
              />
            ) : (
              <rect x={0} y={0} width={MAP_W} height={MAP_H} fill="#07110f" rx={10} />
            )}

            {data.atp.map((ring, index) => (
              <polygon
                key={`atp-${index}`}
                points={toPolylinePoints(ring, projection)}
                fill="rgba(250, 204, 21, 0.18)"
                stroke="#fde047"
                strokeWidth={1.6}
              />
            ))}

            {data.options.map((option, index) => {
              const selected = option.id === selectedId;
              return (
                <polyline
                  key={option.id}
                  points={toPolylinePoints(option.coordinates, projection)}
                  fill="none"
                  stroke={routeColor(index)}
                  strokeWidth={selected ? 4 : 2}
                  strokeOpacity={selected ? 1 : 0.45}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              );
            })}

            {startPoint && (
              <g>
                {canMoveStart && (
                  <circle cx={startPoint[0]} cy={startPoint[1]} r={11} fill="none" stroke="#fbbf24" strokeWidth={1.4} strokeDasharray="3 3" />
                )}
                <circle
                  cx={startPoint[0]}
                  cy={startPoint[1]}
                  r={6}
                  fill={canMoveStart ? '#fbbf24' : '#f8fafc'}
                  stroke="#0f172a"
                  strokeWidth={2}
                />
                <text
                  x={startPoint[0] + 10}
                  y={startPoint[1] + 4}
                  fill="#e2e8f0"
                  fontSize={12}
                  fontWeight={600}
                >
                  Partida{data.startLabel ? ` — ${data.startLabel}` : ''}
                </text>
              </g>
            )}
          </svg>
        ) : (
          <p className="p-6 text-sm text-slate-400">Sem traçado para desenhar.</p>
        )}
      </div>

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
  );
}
