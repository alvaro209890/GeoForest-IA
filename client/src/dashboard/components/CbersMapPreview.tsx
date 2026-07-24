import React, { useCallback, useRef, useState } from 'react';
import { MapView } from '@/components/Map';

export type CbersGeoJsonGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: any;
};

export function cbersGeometryCoordinates(
  geometry?: CbersGeoJsonGeometry | null,
): Array<Array<[number, number]>> {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return geometry.coordinates as Array<Array<[number, number]>>;
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as Array<Array<Array<[number, number]>>>).flat();
  }
  return [];
}

export function cbersGeometryCenter(
  geometry?: CbersGeoJsonGeometry | null,
): google.maps.LatLngLiteral {
  const rings = cbersGeometryCoordinates(geometry);
  const points = rings.flat();
  if (!points.length) return { lat: -12.5, lng: -55.5 };
  const lng = points.reduce((acc, point) => acc + Number(point[0] || 0), 0) / points.length;
  const lat = points.reduce((acc, point) => acc + Number(point[1] || 0), 0) / points.length;
  return { lat, lng };
}

type CbersMapPreviewProps = {
  propertyGeometry?: CbersGeoJsonGeometry | null;
  sceneGeometry?: CbersGeoJsonGeometry | null;
};

/**
 * Preview de geometria CBERS no mapa (com fallback SVG se o Maps falhar).
 */
export function CbersMapPreview({ propertyGeometry, sceneGeometry }: CbersMapPreviewProps) {
  const [mapFailed, setMapFailed] = useState(false);
  const overlaysRef = useRef<google.maps.Polygon[]>([]);
  const draw = useCallback(
    (map: google.maps.Map) => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
      const bounds = new google.maps.LatLngBounds();
      const addGeometry = (
        geometry: CbersGeoJsonGeometry | null | undefined,
        color: string,
        fillOpacity: number,
      ) => {
        for (const ring of cbersGeometryCoordinates(geometry)) {
          const path = ring.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
          if (path.length < 3) continue;
          path.forEach((point) => bounds.extend(point));
          const polygon = new google.maps.Polygon({
            paths: path,
            strokeColor: color,
            strokeOpacity: 0.95,
            strokeWeight: 2,
            fillColor: color,
            fillOpacity,
            map,
          });
          overlaysRef.current.push(polygon);
        }
      };
      addGeometry(sceneGeometry, '#f59e0b', 0.08);
      addGeometry(propertyGeometry, '#22d3ee', 0.22);
      if (!bounds.isEmpty()) map.fitBounds(bounds, 36);
    },
    [propertyGeometry, sceneGeometry],
  );

  if (mapFailed) {
    const rings = [
      ...cbersGeometryCoordinates(sceneGeometry).map((ring) => ({
        ring,
        color: '#f59e0b',
        fill: 'rgba(245,158,11,0.08)',
      })),
      ...cbersGeometryCoordinates(propertyGeometry).map((ring) => ({
        ring,
        color: '#22d3ee',
        fill: 'rgba(34,211,238,0.22)',
      })),
    ];
    const points = rings.flatMap((item) => item.ring);
    if (!points.length) {
      return (
        <div className="flex h-[260px] items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-slate-500">
          Mapa indisponível para esta geometria.
        </div>
      );
    }
    const xs = points.map((point) => point[0]);
    const ys = points.map((point) => point[1]);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const width = Math.max(0.000001, maxX - minX);
    const height = Math.max(0.000001, maxY - minY);
    return (
      <div className="h-[260px] overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {rings.map((item, idx) => {
            const pointsAttr = item.ring
              .map(([lng, lat]) => `${((lng - minX) / width) * 90 + 5},${95 - ((lat - minY) / height) * 90}`)
              .join(' ');
            return (
              <polygon
                key={`${item.color}-${idx}`}
                points={pointsAttr}
                fill={item.fill}
                stroke={item.color}
                strokeWidth="1.2"
              />
            );
          })}
        </svg>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <MapView
        className="h-[260px] w-full"
        initialCenter={cbersGeometryCenter(propertyGeometry || sceneGeometry)}
        initialZoom={10}
        onMapReady={draw}
        onLoadError={() => setMapFailed(true)}
      />
    </div>
  );
}

export default CbersMapPreview;
