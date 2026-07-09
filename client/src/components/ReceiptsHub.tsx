import React, { useState } from 'react';
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

export default function ReceiptsHub({ apiFetch }: Props) {
  const [subTab, setSubTab] = useState<SubTab>('simcar');

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-5xl mx-auto space-y-5">
        {/* Sub-tabs — modern pill switcher */}
        <div className="flex items-center gap-1 p-1 rounded-2xl bg-white/[0.03] border border-white/[0.05] w-fit">
          <button
            onClick={() => setSubTab('simcar')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300 ${
              subTab === 'simcar'
                ? 'bg-emerald-500/15 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
            }`}
          >
            <Receipt size={14} />
            Recibos SIMCAR
          </button>
          <button
            onClick={() => setSubTab('apf')}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-300 ${
              subTab === 'apf'
                ? 'bg-blue-500/15 text-blue-300 shadow-[0_0_12px_rgba(59,130,246,0.1)]'
                : 'text-slate-500 hover:text-slate-300 hover:bg-white/[0.03]'
            }`}
          >
            <FileText size={14} />
            APF Rural
          </button>
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
