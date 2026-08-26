/**
 * Pré-visualização da cena NDVI em SVG puro — sem basemap e sem rede.
 *
 * A versão anterior montava um Google Maps só para traçar dois polígonos, e o
 * quadro ficava vazio enquanto a API e os tiles carregavam. O modal existe para
 * mostrar *onde a propriedade cai dentro da cena*, e para isso a imagem de fundo
 * não acrescenta nada. O cálculo do traçado está em `@/dashboard/ndvi/scenePreview`.
 */
import React from 'react';
import { buildScenePreviewLayout, type PreviewGeometry } from '@/dashboard/ndvi/scenePreview';

const SCENE_COLOR = '#f59e0b';
const PROPERTY_COLOR = '#22d3ee';

type NdviScenePreviewProps = {
  sceneGeometry?: PreviewGeometry | null;
  sceneBbox?: number[] | null;
  propertyGeometry?: PreviewGeometry | null;
};

export function NdviScenePreview({ sceneGeometry, sceneBbox, propertyGeometry }: NdviScenePreviewProps) {
  const layout = React.useMemo(
    () => buildScenePreviewLayout({ sceneGeometry, sceneBbox, propertyGeometry }),
    [sceneGeometry, sceneBbox, propertyGeometry],
  );

  if (!layout) {
    return (
      <div className="flex h-[260px] items-center justify-center rounded-xl border border-white/10 bg-black/30 text-sm text-slate-500">
        Esta cena não trouxe geometria para desenhar.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
      <svg
        viewBox={layout.viewBox}
        preserveAspectRatio="xMidYMid meet"
        className="h-[260px] w-full"
        role="img"
        aria-label="Posição da propriedade dentro da cena"
      >
        {layout.hasScene && (
          <path
            d={layout.scenePath}
            fill={SCENE_COLOR}
            fillOpacity={0.07}
            stroke={SCENE_COLOR}
            strokeOpacity={0.9}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {layout.hasProperty && (
          <path
            d={layout.propertyPath}
            fill={PROPERTY_COLOR}
            fillOpacity={0.35}
            stroke={PROPERTY_COLOR}
            strokeWidth={1.5}
            vectorEffect="non-scaling-stroke"
          />
        )}

        {/* Em escala real um imóvel de dezenas de hectares desaparece dentro de
            uma cena de ~185 km: sem o localizador o usuário vê a cena vazia. */}
        {layout.marker && (
          <g stroke={PROPERTY_COLOR} strokeWidth={1.4} vectorEffect="non-scaling-stroke" fill="none">
            <circle cx={layout.marker.cx} cy={layout.marker.cy} r={layout.marker.r} strokeOpacity={0.95} />
            <circle
              cx={layout.marker.cx}
              cy={layout.marker.cy}
              r={layout.marker.r * 2.1}
              strokeOpacity={0.35}
              strokeDasharray="4 4"
            />
            <line
              x1={layout.marker.cx - layout.marker.r * 2.9}
              y1={layout.marker.cy}
              x2={layout.marker.cx - layout.marker.r * 1.3}
              y2={layout.marker.cy}
              strokeOpacity={0.7}
            />
            <line
              x1={layout.marker.cx + layout.marker.r * 1.3}
              y1={layout.marker.cy}
              x2={layout.marker.cx + layout.marker.r * 2.9}
              y2={layout.marker.cy}
              strokeOpacity={0.7}
            />
            <line
              x1={layout.marker.cx}
              y1={layout.marker.cy - layout.marker.r * 2.9}
              x2={layout.marker.cx}
              y2={layout.marker.cy - layout.marker.r * 1.3}
              strokeOpacity={0.7}
            />
            <line
              x1={layout.marker.cx}
              y1={layout.marker.cy + layout.marker.r * 1.3}
              x2={layout.marker.cx}
              y2={layout.marker.cy + layout.marker.r * 2.9}
              strokeOpacity={0.7}
            />
          </g>
        )}
      </svg>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-white/10 px-3 py-2 text-[11px] text-slate-400">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm border" style={{ borderColor: SCENE_COLOR, background: `${SCENE_COLOR}1f` }} />
          Cena
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-3 rounded-sm border" style={{ borderColor: PROPERTY_COLOR, background: `${PROPERTY_COLOR}59` }} />
          Propriedade
        </span>
        {layout.marker && <span className="text-slate-500">O círculo marca a propriedade, pequena demais na escala da cena.</span>}
        {layout.propertyOutside && <span className="text-amber-300">A propriedade cai fora desta cena.</span>}
      </div>
    </div>
  );
}

export default NdviScenePreview;
