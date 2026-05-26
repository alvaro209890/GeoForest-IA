import { useEffect, useState } from 'react';
import { MapPin, Sparkles, CheckCheck, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const STORAGE_KEY = 'geoforest.vertices_info_dismissed.v1';

export default function VerticesProximasInfoDialog() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const dismissed = localStorage.getItem(STORAGE_KEY);
    if (dismissed !== 'true') {
      setOpen(true);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
  };

  const handleClose = () => {
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="max-w-md bg-gradient-to-b from-[#0f1a14] to-[#0a100c] border border-emerald-500/20 text-slate-100 shadow-2xl shadow-emerald-900/20 overflow-hidden"
      >
        {/* Glow decoration */}
        <div className="absolute -top-6 -right-6 w-28 h-28 bg-emerald-500/8 rounded-full blur-2xl pointer-events-none" />
        <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-emerald-400/5 rounded-full blur-xl pointer-events-none" />

        {/* Close button (manual, without X from dialog) */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors z-10"
          aria-label="Fechar"
        >
          <X size={16} />
        </button>

        <DialogHeader className="relative">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-emerald-500/15 to-emerald-400/5 border border-emerald-500/20 shadow-lg shadow-emerald-900/10">
              <MapPin className="text-emerald-400" size={22} />
            </div>
            <div>
              <DialogTitle className="text-lg font-bold text-slate-100 tracking-tight">
                Nova funcionalidade
              </DialogTitle>
              <DialogDescription className="text-xs text-slate-400 mt-0.5">
                Vértices Próximas
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          {/* Highlight box */}
          <div className="flex gap-3 p-3.5 rounded-xl bg-gradient-to-r from-emerald-500/8 to-transparent border border-emerald-500/12">
            <Sparkles className="text-emerald-400 shrink-0 mt-0.5" size={17} />
            <p className="text-slate-300 leading-relaxed">
              Agora você pode detectar <strong className="text-emerald-300 font-semibold">pontos duplicados</strong>{' '}
              em shapefiles poligonais do SIMCAR. O módulo identifica pares de vértices muito próximos dentro do mesmo
              polígono, sem comparar feições diferentes.
            </p>
          </div>

          {/* How to use */}
          <div className="space-y-2 pl-1">
            <p className="font-medium text-slate-200 flex items-center gap-1.5 text-xs uppercase tracking-wider text-emerald-400/80">
              <CheckCheck size={14} className="text-emerald-400" />
              Como usar
            </p>
            <ol className="space-y-2 ml-5 list-decimal text-slate-300 marker:text-emerald-400/70 marker:font-medium">
              <li className="pl-1 leading-relaxed">
                Acesse a aba{' '}
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-emerald-500/8 text-emerald-300 text-xs font-medium border border-emerald-500/15">
                  <MapPin size={10} />
                  Vértices Próximas
                </span>{' '}
                no menu lateral
              </li>
              <li className="pl-1 leading-relaxed">
                Faça upload do <strong className="text-slate-100 font-medium">ZIP</strong> com seus shapefiles
              </li>
              <li className="pl-1 leading-relaxed">
                Configure a <strong className="text-slate-100 font-medium">tolerância</strong> e camadas por análise
              </li>
              <li className="pl-1 leading-relaxed">
                Processe e baixe o resultado com os{' '}
                <strong className="text-slate-100 font-medium">pontos destacados</strong> para conferência
              </li>
            </ol>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 mt-2 pt-2 border-t border-white/5">
          <Button
            onClick={handleClose}
            variant="ghost"
            className="flex-1 text-slate-400 hover:text-slate-200 hover:bg-white/5 text-sm"
          >
            Fechar
          </Button>
          <Button
            onClick={handleDismiss}
            className="flex-1 bg-gradient-to-r from-emerald-600 to-emerald-500 hover:from-emerald-500 hover:to-emerald-400 text-white text-sm shadow-md shadow-emerald-900/20"
          >
            Fechar e não mostrar novamente
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
