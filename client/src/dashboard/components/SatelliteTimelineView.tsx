/**
 * Linha do tempo das cenas de satélite do recorte SIMCAR: escolhe o ano e vê
 * as imagens daquele ano. Aba "Linha do tempo" do painel de imagens AC/AVN.
 *
 * Origem: componente pronto que estava sem commit no checkout de produção
 * (2026-08-20); foi ligado ao Dashboard.
 */
import { useState, useMemo } from 'react';
import { Clock } from 'lucide-react';

type ImageItem = { url: string; caption: string };

function parseSatelliteInfo(caption: string): { label: string; year: number; sensor: string } {
  const yearMatch = caption.match(/(\d{4})/);
  const year = yearMatch ? parseInt(yearMatch[1]) : 0;
  const parts = caption.split('—')[0]?.split('-')[0]?.trim() || caption;
  const sensorMatch = parts.match(/(Landsat|SPOT|Sentinel|CBERS)/i);
  const sensor = sensorMatch ? sensorMatch[1] : 'Satélite';
  return { label: parts, year, sensor };
}

export default function SatelliteTimelineView({ images }: { images: ImageItem[] }) {
  const timeline = useMemo(() => {
    const groups = new Map<number, ImageItem[]>();
    for (const img of images) {
      const { year } = parseSatelliteInfo(img.caption);
      if (!year) continue;
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year)!.push(img);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => a - b)
      .map(([year, imgs]) => ({ year, images: imgs }));
  }, [images]);

  const [selectedYear, setSelectedYear] = useState<number | null>(timeline[0]?.year ?? null);

  if (timeline.length === 0) {
    return <p className="text-xs text-slate-500 text-center py-8">Nenhuma imagem com ano identificado.</p>;
  }

  const selectedEntry = timeline.find((t) => t.year === selectedYear);
  const minYear = timeline[0].year;
  const maxYear = timeline[timeline.length - 1].year;

  return (
    <div className="space-y-4">
      {/* Timeline bar */}
      <div className="relative px-4 py-6">
        {/* Line */}
        <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-white/10 -translate-y-1/2" />
        {/* Dots */}
        <div className="relative flex justify-between">
          {timeline.map((entry) => {
            const isSelected = entry.year === selectedYear;
            return (
              <button
                key={entry.year}
                type="button"
                onClick={() => setSelectedYear(entry.year)}
                className="relative flex flex-col items-center gap-1.5 group"
              >
                <span className={`text-[10px] font-medium transition-colors ${isSelected ? 'text-purple-300' : 'text-slate-500 group-hover:text-slate-300'}`}>
                  {entry.year}
                </span>
                <div className={`w-4 h-4 rounded-full border-2 transition-all ${isSelected
                  ? 'bg-purple-500 border-purple-400 scale-125 shadow-lg shadow-purple-500/30'
                  : 'bg-white/10 border-white/20 group-hover:border-purple-400/50 group-hover:bg-purple-500/20'
                  }`} />
                <span className="text-[9px] text-slate-600">{entry.images.length} img</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected year image */}
      {selectedEntry && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Clock size={13} className="text-purple-400" />
            <span className="font-medium">{selectedEntry.year}</span>
            <span className="text-slate-500">— {selectedEntry.images.length} imagem(ns)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {selectedEntry.images.map((img, idx) => {
              const info = parseSatelliteInfo(img.caption);
              return (
                <div key={idx} className="rounded-xl overflow-hidden border border-white/10 bg-black/20">
                  <img
                    src={img.url}
                    alt={img.caption}
                    className="w-full h-40 object-cover"
                    loading="lazy"
                  />
                  <div className="px-3 py-2">
                    <p className="text-[10px] text-slate-300 font-medium">{info.label}</p>
                    <p className="text-[9px] text-slate-500 truncate">{img.caption}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
