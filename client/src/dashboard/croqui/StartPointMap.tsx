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
 */
import { useEffect, useMemo, useRef } from 'react';
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

export type StartPointMapProps = {
  data: CroquiRouteOptionsResponse;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onMoveStart: (lon: number, lat: number) => void;
  disabled?: boolean;
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

/** Reenquadra o mapa toda vez que uma nova resposta de rotas chega (partida nova ou recálculo). */
function FitToData({ data }: { data: CroquiRouteOptionsResponse }) {
  const map = useMap();
  useEffect(() => {
    const points: LatLngExpression[] = [];
    for (const ring of data.atp) for (const pos of ring) points.push(toLatLng(pos));
    for (const option of data.options) for (const pos of option.coordinates) points.push(toLatLng(pos));
    if (data.start) points.push(toLatLng(data.start));
    if (!points.length) return;
    const bounds = L.latLngBounds(points) as LatLngBoundsExpression;
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: 17 });
  }, [data, map]);
  return null;
}

/** Clique em área vazia do mapa (fora das rotas) move a partida pra ali. */
function ClickToMoveStart({ onMoveStart, disabled }: { onMoveStart: (lon: number, lat: number) => void; disabled?: boolean }) {
  useMapEvents({
    click(event: LeafletMouseEvent) {
      if (disabled) return;
      onMoveStart(event.latlng.lng, event.latlng.lat);
    },
  });
  return null;
}

export default function StartPointMap({ data, selectedId, onSelect, onMoveStart, disabled }: StartPointMapProps) {
  const initialCenter = useMemo<LatLngExpression>(
    () => (data.start ? toLatLng(data.start) : [-12.6, -55.4]),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const markerRef = useRef<L.Marker | null>(null);

  return (
    <div className="overflow-hidden rounded-xl border border-white/10">
      <MapContainer
        center={initialCenter}
        zoom={13}
        scrollWheelZoom
        className="h-[420px] w-full"
        style={{ background: '#07110f' }}
      >
        <TileLayer url={ESRI_TILE_URL} attribution={ESRI_ATTRIBUTION} maxZoom={19} maxNativeZoom={19} />
        <FitToData data={data} />
        <ClickToMoveStart onMoveStart={onMoveStart} disabled={disabled} />

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
          return (
            <Polyline
              key={option.id}
              positions={option.coordinates.map(toLatLng)}
              pathOptions={{
                color: routeColor(index),
                weight: selected ? 5 : 3,
                opacity: selected ? 1 : 0.55,
              }}
              eventHandlers={{
                click: (event) => {
                  // Sem isso o clique também dispara o ClickToMoveStart do mapa por baixo.
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
            draggable={!disabled}
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
      </MapContainer>
      <div className="border-t border-white/10 bg-black/30 px-3 py-2 text-[11px] text-slate-400">
        Arraste o pino ou clique em qualquer ponto do mapa para mudar a partida — dá pra navegar
        livremente (arrastar e dar zoom) até onde precisar. Clique numa rota colorida pra escolhê-la.
      </div>
    </div>
  );
}
