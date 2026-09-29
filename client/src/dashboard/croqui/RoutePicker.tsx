import { useEffect, useState } from 'react';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Home,
  Loader2,
  MapPin,
  PenLine,
  RotateCcw,
  Route,
  Undo2,
} from 'lucide-react';
import type { CroquiRouteOptionsResponse } from './types';
import { formatKm, routeColor } from './routePreview';
import { MUNICIPIOS_MT } from './municipiosMt';
import StartPointMap, { type MapClickMode } from './StartPointMap';

export type RoutePickerProps = {
  data: CroquiRouteOptionsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
  onMoveStart: (lon: number, lat: number) => void;
  municipioPartida?: string | null;
  onMunicipioChange?: (municipio: string) => void;
  onResetToCityCenter?: () => void;
  /** null = ainda não respondido (vale o que veio do ZIP). */
  possuiSede?: boolean | null;
  sede?: [number, number] | null;
  onPossuiSedeChange?: (possui: boolean) => void;
  onPlaceSede?: (lon: number, lat: number) => void;
  editedCoords?: Record<string, [number, number][]>;
  onEditRoute?: (routeId: string, coords: [number, number][] | null) => void;
};

function formatCoord([lon, lat]: [number, number]): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * O caminho mais curto nem sempre é o que se usa em campo. Aqui os corredores
 * encontrados aparecem lado a lado, sobre um mapa de satélite navegável
 * (pan/zoom livres), com opção de selecionar o município de partida ou arrastar/
 * clicar pra mudar de onde o croqui parte — antes de gerar. Também é aqui que
 * se diz se a propriedade tem sede (e onde) e que se ajustam os vértices do
 * caminho escolhido.
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
  possuiSede,
  sede,
  onPossuiSedeChange,
  onPlaceSede,
  editedCoords,
  onEditRoute,
}: RoutePickerProps) {
  const currentMunicipio =
    municipioPartida || data.municipioPartida || data.municipioNome || 'Canarana';
  const isCustomStart = data.startSource === 'customizado';
  const temSede = !!possuiSede;
  const [clickMode, setClickMode] = useState<MapClickMode>('partida');
  const [editing, setEditing] = useState(false);
  const selectedEdited = !!(selectedId && editedCoords?.[selectedId]);

  // Sede marcada como "sim" e ainda sem ponto: o próximo clique no mapa é a sede.
  useEffect(() => {
    if (temSede && !sede) setClickMode('sede');
    else if (!temSede) setClickMode('partida');
  }, [temSede, sede]);

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

  const handlePlaceSede = (lon: number, lat: number) => {
    onPlaceSede?.(lon, lat);
    setClickMode('partida');
  };

  const toggleBtn = (active: boolean) =>
    `rounded-lg border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
      active
        ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-100'
        : 'border-white/10 bg-black/30 text-slate-300 hover:border-white/25'
    }`;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <StartPointMap
        data={data}
        selectedId={selectedId}
        onSelect={onSelect}
        onMoveStart={onMoveStart}
        disabled={disabled}
        clickMode={clickMode}
        possuiSede={temSede}
        sede={sede}
        onPlaceSede={handlePlaceSede}
        editing={editing}
        editedCoords={editedCoords}
        onEditRoute={onEditRoute}
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

        {/* Sede da propriedade */}
        <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/[0.06] p-3 space-y-2">
          <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-200">
            <Home size={14} className="text-emerald-400" />
            Sede da propriedade
          </span>
          <p className="text-[11px] text-slate-400">A propriedade possui sede?</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => !temSede && onPossuiSedeChange?.(true)}
              className={toggleBtn(temSede)}
            >
              Sim
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => possuiSede !== false && onPossuiSedeChange?.(false)}
              className={toggleBtn(possuiSede === false)}
            >
              Não
            </button>
          </div>

          {temSede && (
            <>
              {sede ? (
                <p className="text-[11px] text-emerald-100/90">
                  Sede marcada em <strong>{formatCoord(sede)}</strong>. O croqui termina nela, seguindo a
                  estrada interna quando o mapa a conhece.
                </p>
              ) : (
                <p className="text-[11px] font-semibold text-amber-300">
                  Clique no mapa onde fica a sede (dentro do imóvel).
                </p>
              )}
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-slate-500">O clique no mapa marca</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={disabled || editing}
                    onClick={() => setClickMode('partida')}
                    className={toggleBtn(clickMode === 'partida')}
                  >
                    Partida
                  </button>
                  <button
                    type="button"
                    disabled={disabled || editing}
                    onClick={() => setClickMode('sede')}
                    className={toggleBtn(clickMode === 'sede')}
                  >
                    Sede
                  </button>
                </div>
              </div>
            </>
          )}
          {possuiSede === false && (
            <p className="text-[11px] text-slate-400">Sem sede: o croqui termina dentro do imóvel.</p>
          )}
        </div>

        {/* Edição dos vértices */}
        {onEditRoute && selectedId && (
          <div className="rounded-xl border border-sky-400/25 bg-sky-500/[0.06] p-3 space-y-2">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-sky-200">
              <PenLine size={14} className="text-sky-400" />
              Ajustar o caminho
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={disabled}
                onClick={() => setEditing((v) => !v)}
                className={`rounded-lg border px-3 py-2 text-xs font-semibold disabled:opacity-50 ${
                  editing
                    ? 'border-sky-400/60 bg-sky-500/20 text-sky-100'
                    : 'border-white/10 bg-black/30 text-slate-200 hover:border-white/25'
                }`}
              >
                {editing ? 'Concluir edição' : 'Editar vértices do caminho'}
              </button>
              {selectedEdited && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onEditRoute(selectedId, null)}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-3 py-2 text-xs text-slate-300 hover:border-white/25 disabled:opacity-50"
                >
                  <Undo2 size={12} />
                  Desfazer edição
                </button>
              )}
            </div>
            {editing && (
              <p className="text-[11px] text-sky-100/80">
                Arraste os pontos brancos; clique num “+” para criar um ponto; botão direito ou duplo clique
                apaga um ponto. A linha passa exatamente por onde os pontos ficarem.
              </p>
            )}
            <p className="text-[10px] text-slate-500">
              Mudar a partida, o município ou a sede recalcula os caminhos e descarta as edições.
            </p>
          </div>
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
            const edited = !!editedCoords?.[option.id];
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
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {option.recommended && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-200">
                          <CheckCircle2 size={10} />
                          Mais curto
                        </span>
                      )}
                      {edited && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-200">
                          <PenLine size={10} />
                          Editado
                        </span>
                      )}
                    </div>
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
