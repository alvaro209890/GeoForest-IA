/**
 * Mapa de satélite navegável (pan/zoom livres) para escolher o caminho de
 * acesso e o ponto de partida do croqui.
 *
 * O preview antigo era uma imagem estática do Esri Static Export, no
 * enquadramento fixo calculado pelo backend — dava pra clicar dentro dela,
 * mas não pra navegar pra fora. Aqui os tiles de satélite (mesmo provedor,
 * Esri World_Imagery) vêm direto do navegador via XYZ, então o usuário pode
 * arrastar/dar zoom livremente até qualquer lugar antes de escolher a
 * partida — sem depender de mais nenhuma chamada ao backend só pra navegar.
 *
 * Também é aqui que se marca a sede da propriedade (pino verde) e que se
 * editam os vértices do caminho escolhido antes de gerar o croqui.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import L, { type LatLngBoundsExpression, type LatLngExpression, type LeafletMouseEvent } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { CroquiRouteOptionsResponse } from './types';
import { routeColor } from './routePreview';

export type MapClickMode = 'partida' | 'sede';

export type StartPointMapProps = {
  data: CroquiRouteOptionsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveStart: (lon: number, lat: number) => void;
  disabled?: boolean;
  /** O que um clique no mapa marca: a partida ou a sede. */
  clickMode?: MapClickMode;
  possuiSede?: boolean;
  sede?: [number, number] | null;
  onPlaceSede?: (lon: number, lat: number) => void;
  /** Vértices do caminho escolhido ficam arrastáveis. */
  editing?: boolean;
  editedCoords?: Record<string, [number, number][]>;
  onEditRoute?: (routeId: string, coords: [number, number][] | null) => void;
};

const ESRI_TILE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const ESRI_ATTRIBUTION =
  'Tiles &copy; Esri &mdash; Esri, Maxar, Earthstar Geographics, and the GIS User Community';

const toLatLng = ([lon, lat]: [number, number]): LatLngExpression => [lat, lon];

const startIcon = L.divIcon({
  className: '',
  html:
    '<div style="width:20px;height:20px;border-radius:9999px;background:#fbbf24;border:2.5px solid #0f172a;box-shadow:0 0 0 3px rgba(251,191,36,0.35)"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const sedeIcon = L.divIcon({
  className: '',
  html:
    '<div style="width:28px;height:28px;border-radius:8px;background:#10b981;border:2.5px solid #0f172a;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 3px rgba(16,185,129,0.35)">' +
    '<svg width="15" height="15" viewBox="0 0 24 24" fill="#ffffff"><path d="M12 3 2 12h3v9h6v-6h2v6h6v-9h3z"/></svg></div>',
  iconSize: [28, 28],
  iconAnchor: [14, 14],
});

const vertexIcon = L.divIcon({
  className: '',
  html: '<div style="width:12px;height:12px;border-radius:9999px;background:#ffffff;border:2px solid #0f172a;cursor:move"></div>',
  iconSize: [12, 12],
  iconAnchor: [6, 6],
});

const midIcon = L.divIcon({
  className: '',
  html:
    '<div style="width:13px;height:13px;border-radius:9999px;background:rgba(15,23,42,0.55);border:1px dashed #ffffff;color:#ffffff;font:700 11px/11px sans-serif;text-align:center;cursor:copy">+</div>',
  iconSize: [13, 13],
  iconAnchor: [6, 6],
});

/** Reenquadra o mapa toda vez que uma nova resposta de rotas chega (partida nova ou recálculo). */
function FitToData({ data }: { data: CroquiRouteOptionsResponse }) {
  const map = useMap();
  useEffect(() => {
    const points: LatLngExpression[] = [];
    for (const ring of data.atp) for (const pos of ring) points.push(toLatLng(pos));
    for (const option of data.options) for (const pos of option.coordinates) points.push(toLatLng(pos));
    if (data.start) points.push(toLatLng(data.start));
    if (data.sede) points.push(toLatLng(data.sede));
    if (!points.length) return;
    const bounds = L.latLngBounds(points) as LatLngBoundsExpression;
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
  }, [data, map]);
  return null;
}

/** Clique em área vazia do mapa (fora das rotas) move a partida — ou marca a sede. */
function ClickOnMap({
  onClick,
  disabled,
}: {
  onClick: (lon: number, lat: number) => void;
  disabled?: boolean;
}) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      if (disabled) return;
      onClick(event.latlng.lng, event.latlng.lat);
    },
  });
  return null;
}

/**
 * Caminho com vértices arrastáveis: arrastar move o ponto, clicar num "+"
 * cria um ponto no meio do trecho, botão direito (ou toque longo) ou duplo
 * clique apaga o ponto. A linha passa exatamente onde os pontos ficarem.
 */
function EditableRoute({
  coords,
  color,
  disabled,
  onChange,
}: {
  coords: [number, number][];
  color: string;
  disabled?: boolean;
  onChange: (coords: [number, number][]) => void;
}) {
  const [live, setLive] = useState(coords);
  const liveRef = useRef(coords);
  useEffect(() => {
    liveRef.current = coords;
    setLive(coords);
  }, [coords]);

  const update = (next: [number, number][], commit: boolean) => {
    liveRef.current = next;
    setLive(next);
    if (commit) onChange(next);
  };
  const moveVertex = (index: number, marker: L.Marker, commit: boolean) => {
    const { lat, lng } = marker.getLatLng();
    update(
      liveRef.current.map((p, j) => (j === index ? ([lng, lat] as [number, number]) : p)),
      commit,
    );
  };
  const removeVertex = (index: number) => {
    if (disabled || liveRef.current.length <= 2) return;
    update(liveRef.current.filter((_, j) => j !== index), true);
  };

  return (
    <>
      <Polyline
        positions={live.map(toLatLng)}
        pathOptions={{ color, weight: 5, opacity: 1, dashArray: '8 6' }}
        interactive={false}
      />
      {live.slice(0, -1).map((p, i) => {
        const q = live[i + 1];
        const mid: [number, number] = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
        return (
          <Marker
            key={`mid-${i}`}
            position={toLatLng(mid)}
            icon={midIcon}
            eventHandlers={{
              click: (event) => {
                L.DomEvent.stopPropagation(event);
                if (disabled) return;
                const next = [...liveRef.current];
                next.splice(i + 1, 0, mid);
                update(next, true);
              },
            }}
          />
        );
      })}
      {live.map((p, i) => (
        <Marker
          key={`v-${i}`}
          position={toLatLng(p)}
          icon={vertexIcon}
          draggable={!disabled}
          eventHandlers={{
            drag: (event) => moveVertex(i, event.target as L.Marker, false),
            dragend: (event) => moveVertex(i, event.target as L.Marker, true),
            contextmenu: (event) => {
              L.DomEvent.stopPropagation(event);
              removeVertex(i);
            },
            dblclick: (event) => {
              L.DomEvent.stopPropagation(event);
              removeVertex(i);
            },
            click: (event) => L.DomEvent.stopPropagation(event),
          }}
        />
      ))}
    </>
  );
}

export default function StartPointMap({
  data,
  selectedId,
  onSelect,
  onMoveStart,
  disabled,
  clickMode = 'partida',
  possuiSede,
  sede,
  onPlaceSede,
  editing,
  editedCoords,
  onEditRoute,
}: StartPointMapProps) {
  const initialCenter = useMemo<LatLngExpression>(
    () => (data.start ? toLatLng(data.start) : [-12.6, -55.4]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const markerRef = useRef<L.Marker | null>(null);
  const sedeRef = useRef<L.Marker | null>(null);

  const handleMapClick = (lon: number, lat: number) => {
    if (editing) return;
    if (clickMode === 'sede' && possuiSede && onPlaceSede) onPlaceSede(lon, lat);
    else onMoveStart(lon, lat);
  };

  const hint = editing
    ? 'Editando o caminho: arraste os pontos brancos, clique num "+" para criar um ponto, clique com o botão direito (ou dê duplo clique) num ponto para apagá-lo.'
    : clickMode === 'sede' && possuiSede
      ? 'Clique no mapa onde fica a sede da propriedade (dentro do imóvel). Dá para arrastar o pino verde depois.'
      : 'Arraste o pino ou clique em qualquer ponto do mapa para mudar a partida — dá pra navegar livremente (arrastar e dar zoom) até onde precisar. Clique numa rota colorida pra escolhê-la.';

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <MapContainer
        center={initialCenter}
        zoom={13}
        scrollWheelZoom
        doubleClickZoom={!editing}
        className="h-[460px] w-full"
        style={{ background: '#07110f', cursor: clickMode === 'sede' && possuiSede && !editing ? 'crosshair' : undefined }}
      >
        <TileLayer url={ESRI_TILE_URL} attribution={ESRI_ATTRIBUTION} maxZoom={19} maxNativeZoom={19} />
        <FitToData data={data} />
        <ClickOnMap onClick={handleMapClick} disabled={disabled} />

        {data.atp.map((ring, index) => (
          <Polygon
            key={`atp-${index}`}
            positions={ring.map(toLatLng)}
            pathOptions={{ color: '#fde047', weight: 1.6, fillColor: '#facc15', fillOpacity: 0.18 }}
            interactive={false}
          />
        ))}

        {data.options.map((option, index) => {
          const selected = option.id === selectedId;
          const coords = editedCoords?.[option.id] || option.coordinates;
          if (selected && editing && onEditRoute) {
            return (
              <EditableRoute
                key={`edit-${option.id}`}
                coords={coords}
                color={routeColor(index)}
                disabled={disabled}
                onChange={(next) => onEditRoute(option.id, next)}
              />
            );
          }
          return (
            <Polyline
              key={option.id}
              positions={coords.map(toLatLng)}
              pathOptions={{
                color: routeColor(index),
                weight: selected ? 5 : 3,
                opacity: selected ? 1 : 0.55,
              }}
              eventHandlers={{
                click: (event) => {
                  // Sem isso o clique também dispara o clique do mapa por baixo.
                  L.DomEvent.stopPropagation(event);
                  if (!disabled) onSelect(option.id);
                },
              }}
            />
          );
        })}

        {data.start && (
          <Marker
            ref={markerRef}
            position={toLatLng(data.start)}
            icon={startIcon}
            draggable={!disabled && !editing}
            eventHandlers={{
              dragend: () => {
                const marker = markerRef.current;
                if (!marker) return;
                const { lat, lng } = marker.getLatLng();
                onMoveStart(lng, lat);
              },
            }}
          />
        )}

        {possuiSede && sede && (
          <Marker
            ref={sedeRef}
            position={toLatLng(sede)}
            icon={sedeIcon}
            draggable={!disabled && !editing}
            eventHandlers={{
              dragend: () => {
                const marker = sedeRef.current;
                if (!marker || !onPlaceSede) return;
                const { lat, lng } = marker.getLatLng();
                onPlaceSede(lng, lat);
              },
            }}
          />
        )}
      </MapContainer>
      <div className="border-t border-white/10 bg-black/30 px-3 py-2 text-[11px] text-slate-400">{hint}</div>
    </div>
  );
}
