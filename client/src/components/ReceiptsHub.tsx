import React, { useRef, useState, useEffect } from 'react';
import { FileText, Receipt } from 'lucide-react';
import SimcarReceiptDownloader from './SimcarReceiptDownloader';
import ApfReceiptDownloader from './ApfReceiptDownloader';

type ApiFetch = (
  path: string,
  init?: RequestInit,
  options?: { auth?: boolean },
) => Promise<Response>;

type Props = {
  apiFetch: ApiFetch;
};

type SubTab = 'simcar' | 'apf';

const tabs: { id: SubTab; icon: React.ReactNode; label: string; subtitle: string; color: string }[] = [
  {
    id: 'simcar',
    icon: <Receipt size={16} />,
    label: 'Recibos SIMCAR',
    subtitle: 'Consulta por CPF ou CAR',
    color: 'emerald',
  },
  {
    id: 'apf',
    icon: <FileText size={16} />,
    label: 'APF Rural',
    subtitle: 'SEMA/MT — Autorização',
    color: 'blue',
  },
];

export default function ReceiptsHub({ apiFetch }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('simcar');
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({});
  const tabsRef = useRef<Map<string, HTMLButtonElement>>(new Map());

  useEffect(() => {
    const el = tabsRef.current.get(subTab);
    if (el) {
      const parent = el.parentElement;
      if (parent) {
        const parentRect = parent.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        setIndicatorStyle({
          width: elRect.width,
          transform: `translateX(${elRect.left - parentRect.left}px)`,
        });
      }
    }
  }, [subTab]);

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-5 px-3 sm:px-0 py-4 sm:py-0">
        {/* ── Modern Segmented Control ── */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          {/* Pill tabs — full width on mobile */}
          <div className="relative flex items-center gap-1 p-1 rounded-2xl bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm w-full sm:w-fit shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
            {/* Sliding background indicator */}
            <div
              className="absolute top-1 bottom-1 rounded-xl bg-white/[0.06] border border-white/[0.08] shadow-sm transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]"
              style={indicatorStyle}
            />
            {tabs.map((tab) => {
              const active = subTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => { if (el) tabsRef.current.set(tab.id, el); }}
                  onClick={() => setSubTab(tab.id)}
                  className={`relative z-10 flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition-all duration-300 whitespace-nowrap min-h-[44px] ${
                    active
                      ? tab.color === 'emerald'
                        ? 'text-emerald-200'
                        : 'text-blue-200'
                      : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <span className={`transition-transform duration-300 ${active ? 'scale-110' : ''}`}>
                    {tab.icon}
                  </span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  <span className="sm:hidden text-[11px]">{tab.label.split(' ')[0]}</span>
                </button>
              );
            })}
          </div>

          {/* Active tab subtitle — hidden on very small screens */}
          <div className="hidden sm:flex items-center gap-2 text-[11px] text-slate-500 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${
              subTab === 'simcar' ? 'bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.5)]' : 'bg-blue-400 shadow-[0_0_6px_rgba(59,130,246,0.5)]'
            }`} />
            <span>{tabs.find((t) => t.id === subTab)?.subtitle}</span>
          </div>
        </div>

        {/* Content */}
        <div className="min-h-[400px]">
          {subTab === 'simcar' ? (
            <SimcarReceiptDownloader apiFetch={apiFetch} />
          ) : (
            <ApfReceiptDownloader apiFetch={apiFetch} />
          )}
        </div>
      </div>
    </div>
  );
}
