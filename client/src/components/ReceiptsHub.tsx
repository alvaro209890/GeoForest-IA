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
    <div className="flex flex-col gap-5">
      {/* Sub-tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.06] w-fit">
        <button
          onClick={() => setSubTab('simcar')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            subTab === 'simcar'
              ? 'bg-emerald-600/30 text-emerald-300 border border-emerald-500/30'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <Receipt size={13} />
          SIMCAR
        </button>
        <button
          onClick={() => setSubTab('apf')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            subTab === 'apf'
              ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
              : 'text-slate-500 hover:text-slate-300'
          }`}
        >
          <FileText size={13} />
          APF Rural
        </button>
      </div>

      {/* Content */}
      {subTab === 'simcar' ? (
        <SimcarReceiptDownloader apiFetch={apiFetch} />
      ) : (
        <ApfReceiptDownloader apiFetch={apiFetch} />
      )}
    </div>
  );
}
