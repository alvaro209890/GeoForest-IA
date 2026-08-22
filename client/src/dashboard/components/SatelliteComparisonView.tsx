/**
 * Comparador antes/depois de duas cenas de satélite do recorte SIMCAR.
 * Usado na aba "Comparar" do painel de imagens da validação AC/AVN.
 *
 * Origem: componente pronto que estava sem commit no checkout de produção
 * (2026-08-20); foi ligado ao Dashboard e ganhou arrasto por toque.
 */
import { useState, useMemo } from 'react';
import { GitCompareArrows, ChevronDown } from 'lucide-react';

type ImageItem = { url: string; caption: string };

function parseSatelliteLabel(caption: string): { label: string; year: number } {
  const yearMatch = caption.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1]) : 0;
  const label = caption.split('—')[0]?.split('-')[0]?.trim() || caption;
  return { label, year };
}

export default function SatelliteComparisonView({ images }: { images: ImageItem[] }) {
  const satellites = useMemo(() => {
    const groups = new Map<string, ImageItem[]>();
    for (const img of images) {
      const { label } = parseSatelliteLabel(img.caption);
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label)!.push(img);
    }
    return Array.from(groups.entries()).map(([label, imgs]) => ({ label, images: imgs }));
  }, [images]);

  const [leftIdx, setLeftIdx] = useState(0);
  const [rightIdx, setRightIdx] = useState(Math.min(1, satellites.length - 1));
  const [sliderPos, setSliderPos] = useState(50);

  if (satellites.length === 0) {
    return <p className="text-xs text-slate-500 text-center py-8">Nenhuma imagem disponível para comparação.</p>;
  }

  // Arrasto por mouse E por toque: o painel é usado no celular, e só com
  // `mousedown` a alça ficava inerte lá.
  const startDrag = (container: HTMLElement) => {
    const rect = container.getBoundingClientRect();
    const mover = (clientX: number) => {
      setSliderPos(Math.max(5, Math.min(95, ((clientX - rect.left) / rect.width) * 100)));
    };
    const onMouseMove = (ev: MouseEvent) => mover(ev.clientX);
    const onTouchMove = (ev: TouchEvent) => {
      if (ev.touches[0]) mover(ev.touches[0].clientX);
    };
    const onEnd = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onEnd);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onEnd);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onEnd);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onEnd);
  };

  const leftSat = satellites[leftIdx];
  const rightSat = satellites[rightIdx];
  const leftImg = leftSat?.images[0];
  const rightImg = rightSat?.images[0];

  return (
    <div className="space-y-4">
      {/* Selectors */}
      <div className="flex gap-3 items-center">
        <div className="flex-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Esquerda</label>
          <div className="relative">
            <select
              value={leftIdx}
              onChange={(e) => setLeftIdx(Number(e.target.value))}
              className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 pr-8 focus:outline-none focus:border-purple-500/50"
            >
              {satellites.map((sat, i) => (
                <option key={i} value={i}>{sat.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
        <div className="p-2 rounded-full bg-purple-500/10 text-purple-400 mt-4">
          <GitCompareArrows size={16} />
        </div>
        <div className="flex-1">
          <label className="text-[10px] text-slate-500 uppercase tracking-wider mb-1 block">Direita</label>
          <div className="relative">
            <select
              value={rightIdx}
              onChange={(e) => setRightIdx(Number(e.target.value))}
              className="w-full appearance-none bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-xs text-slate-200 pr-8 focus:outline-none focus:border-purple-500/50"
            >
              {satellites.map((sat, i) => (
                <option key={i} value={i}>{sat.label}</option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          </div>
        </div>
      </div>

      {/* Comparison slider */}
      {leftImg && rightImg && (
        <div className="relative rounded-xl overflow-hidden border border-white/10 bg-black/40 select-none">
          <div className="relative w-full" style={{ aspectRatio: '16/10' }}>
            {/* Right image (full) */}
            <img src={rightImg.url} alt={rightImg.caption} className="absolute inset-0 w-full h-full object-cover" />
            {/* Left image (clipped) */}
            <div className="absolute inset-0 overflow-hidden" style={{ width: `${sliderPos}%` }}>
              <img src={leftImg.url} alt={leftImg.caption} className="w-full h-full object-cover" style={{ minWidth: `${100 / (sliderPos / 100)}%`, maxWidth: `${100 / (sliderPos / 100)}%` }} />
            </div>
            {/* Slider handle */}
            <div
              className="absolute top-0 bottom-0 w-1 bg-white/80 cursor-ew-resize z-10"
              style={{ left: `${sliderPos}%`, transform: 'translateX(-50%)' }}
              onMouseDown={(e) => {
                e.preventDefault();
                startDrag(e.currentTarget.parentElement!);
              }}
              onTouchStart={(e) => {
                startDrag(e.currentTarget.parentElement!);
              }}
            >
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 shadow-lg flex items-center justify-center">
                <GitCompareArrows size={14} className="text-slate-800" />
              </div>
            </div>
            {/* Labels */}
            <div className="absolute top-2 left-2 px-2 py-1 rounded-md bg-black/70 text-[10px] text-white font-medium">
              {leftSat.label}
            </div>
            <div className="absolute top-2 right-2 px-2 py-1 rounded-md bg-black/70 text-[10px] text-white font-medium">
              {rightSat.label}
            </div>
          </div>
        </div>
      )}

      {/* Captions */}
      <div className="flex gap-3 text-[10px] text-slate-500">
        <div className="flex-1 truncate">{leftImg?.caption}</div>
        <div className="flex-1 truncate text-right">{rightImg?.caption}</div>
      </div>
    </div>
  );
}
