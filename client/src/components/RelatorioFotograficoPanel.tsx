import { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Download,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, readApiErrorMessage } from '@/lib/api';

type FotoLocal = {
  id: string;
  nome: string;
  base64: string;
  previewUrl: string;
  width: number;
  height: number;
};

type ParcialLocal = {
  key: string;
  titulo: string;
  legenda: string;
  fotoIds: string[];
};

type Excluida = { id: string; motivo: string };

type SelecaoResposta = {
  resumo?: string;
  parciais?: Array<{
    titulo?: string;
    legenda?: string;
    fotos?: Array<{ id?: string; motivo?: string } | string>;
  }>;
  excluidas?: Array<{ id?: string; motivo?: string }>;
};

const MAX_FOTOS = 30;
const MAX_LADO = 1400;

function novoId(): string {
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function lerArquivo(file: File): Promise<FotoLocal> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_LADO / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error(file.name));
        return;
      }
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      URL.revokeObjectURL(url);
      resolve({
        id: novoId(),
        nome: file.name,
        base64: dataUrl.split(',')[1] || '',
        previewUrl: dataUrl,
        width,
        height,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(file.name));
    };
    img.src = url;
  });
}

async function lerEventos(
  response: Response,
  onProgress: (message: string) => void,
): Promise<{ selecao: SelecaoResposta; modelo: string; raciocinio: string }> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Sem resposta do servidor.');
  const decoder = new TextDecoder();
  let buffer = '';
  let final: { selecao: SelecaoResposta; modelo: string; raciocinio: string } | null = null;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const event = JSON.parse(line.slice(6));
      if (event.type === 'progress' && event.message) onProgress(String(event.message));
      if (event.type === 'error') throw new Error(event.message || 'Falha na análise.');
      if (event.type === 'complete') {
        final = {
          selecao: event.selecao || {},
          modelo: String(event.modelo || ''),
          raciocinio: String(event.raciocinio || ''),
        };
      }
    }
  }
  if (!final) throw new Error('A análise terminou sem uma seleção.');
  return final;
}

export default function RelatorioFotograficoPanel() {
  const [projeto, setProjeto] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [parciais, setParciais] = useState<ParcialLocal[]>([]);
  const [excluidas, setExcluidas] = useState<Excluida[]>([]);
  const [resumo, setResumo] = useState('');
  const [modelo, setModelo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [analisando, setAnalisando] = useState(false);
  const [gerando, setGerando] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const porId = useMemo(() => new Map(fotos.map((foto) => [foto.id, foto])), [fotos]);

  const adicionarArquivos = useCallback(async (lista: FileList | File[]) => {
    const arquivos = Array.from(lista).filter((file) => file.type.startsWith('image/'));
    if (!arquivos.length) {
      toast.error('Selecione arquivos de imagem.');
      return;
    }
    const restantes = MAX_FOTOS - fotos.length;
    if (restantes <= 0) {
      toast.error(`O limite é ${MAX_FOTOS} fotografias.`);
      return;
    }
    const lote = arquivos.slice(0, restantes);
    const lidas: FotoLocal[] = [];
    const falhas: string[] = [];
    for (const arquivo of lote) {
      try {
        lidas.push(await lerArquivo(arquivo));
      } catch {
        falhas.push(arquivo.name);
      }
    }
    if (lidas.length) setFotos((atual) => [...atual, ...lidas]);
    if (falhas.length) toast.error(`Não foi possível ler: ${falhas.slice(0, 3).join(', ')}`);
    if (arquivos.length > restantes) toast.error(`Só entram ${MAX_FOTOS} fotografias. O restante ficou de fora.`);
  }, [fotos.length]);

  const removerFoto = (id: string) => {
    setFotos((atual) => atual.filter((foto) => foto.id !== id));
    setParciais((atual) =>
      atual
        .map((parcial) => ({ ...parcial, fotoIds: parcial.fotoIds.filter((fotoId) => fotoId !== id) }))
        .filter((parcial) => parcial.fotoIds.length > 0),
    );
    setExcluidas((atual) => atual.filter((item) => item.id !== id));
  };

  const aplicarSelecao = (selecao: SelecaoResposta, modeloUsado: string, raciocinio: string) => {
    const ids = new Set(fotos.map((foto) => foto.id));
    const usados = new Set<string>();
    const proximas: ParcialLocal[] = [];
    (selecao.parciais || []).forEach((parcial, index) => {
      const fotoIds: string[] = [];
      for (const entry of parcial.fotos || []) {
        const id = typeof entry === 'string' ? entry : String(entry?.id || '');
        if (!ids.has(id) || usados.has(id)) continue;
        usados.add(id);
        fotoIds.push(id);
      }
      if (!fotoIds.length) return;
      proximas.push({
        key: novoId(),
        titulo: parcial.titulo || `Parcial ${index + 1}`,
        legenda: parcial.legenda || '',
        fotoIds,
      });
    });
    if (!proximas.length) {
      toast.error('A IA não selecionou nenhuma foto.');
      return;
    }
    const motivos = new Map((selecao.excluidas || []).map((item) => [String(item.id || ''), item.motivo || '']));
    setParciais(proximas);
    setExcluidas(
      fotos
        .filter((foto) => !usados.has(foto.id))
        .map((foto) => ({ id: foto.id, motivo: motivos.get(foto.id) || 'Não entrou na seleção da IA.' })),
    );
    setResumo(selecao.resumo || '');
    setModelo(modeloUsado ? `${modeloUsado} · raciocínio ${raciocinio || 'max'}` : '');
  };

  const analisar = async () => {
    if (objetivo.trim().length < 8) {
      toast.error('Escreva o objetivo do relatório.');
      return;
    }
    if (!fotos.length) {
      toast.error('Adicione as fotografias.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setAnalisando(true);
    setMensagem('Enviando as fotografias...');
    try {
      const response = await apiFetch(
        '/api/relatorio-fotografico/analisar',
        {
          method: 'POST',
          body: JSON.stringify({
            projeto,
            objetivo,
            fotos: fotos.map((foto) => ({ id: foto.id, nome: foto.nome, base64: foto.base64 })),
          }),
          signal: controller.signal,
        },
      );
      const tipo = response.headers.get('content-type') || '';
      if (!response.ok && !tipo.includes('text/event-stream')) {
        throw new Error(await readApiErrorMessage(response));
      }
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const resultado = await lerEventos(response, setMensagem);
      aplicarSelecao(resultado.selecao, resultado.modelo, resultado.raciocinio);
      setMensagem('');
      toast.success('Seleção pronta. Revise as fotos antes de gerar o Word.');
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        setMensagem('');
        return;
      }
      const texto = error?.message || 'Falha na análise.';
      setMensagem(texto);
      toast.error(texto);
    } finally {
      setAnalisando(false);
      abortRef.current = null;
    }
  };

  const montarManual = () => {
    if (!fotos.length) {
      toast.error('Adicione as fotografias.');
      return;
    }
    if (objetivo.trim().length < 8) {
      toast.error('Escreva o objetivo para usar como legenda.');
      return;
    }
    setParciais([
      {
        key: novoId(),
        titulo: 'Parcial 1',
        legenda: objetivo.trim(),
        fotoIds: fotos.map((foto) => foto.id),
      },
    ]);
    setExcluidas([]);
    setResumo('Seleção manual, sem a IA.');
    setModelo('');
  };

  const gerarWord = async () => {
    const uteis = parciais.filter((parcial) => parcial.fotoIds.length && parcial.legenda.trim());
    if (!uteis.length) {
      toast.error('Cada parcial precisa de legenda e ao menos uma foto.');
      return;
    }
    setGerando(true);
    try {
      const response = await apiFetch('/api/relatorio-fotografico/docx', {
        method: 'POST',
        body: JSON.stringify({
          projeto,
          parciais: uteis.map((parcial) => ({
            legenda: parcial.legenda.trim(),
            fotos: parcial.fotoIds
              .map((id) => porId.get(id))
              .filter((foto): foto is FotoLocal => Boolean(foto))
              .map((foto) => ({ id: foto.id, nome: foto.nome, base64: foto.base64 })),
          })),
        }),
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const nome = (projeto || 'Relatorio_Fotografico').replace(/[^\w.-]+/g, '_');
      link.href = url;
      link.download = `${nome}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Word gerado no modelo IMAP.');
    } catch (error: any) {
      toast.error(error?.message || 'Falha ao gerar o Word.');
    } finally {
      setGerando(false);
    }
  };

  const moverFoto = (parcialIndex: number, fotoIndex: number, direcao: -1 | 1) => {
    setParciais((atual) =>
      atual.map((parcial, index) => {
        if (index !== parcialIndex) return parcial;
        const destino = fotoIndex + direcao;
        if (destino < 0 || destino >= parcial.fotoIds.length) return parcial;
        const fotoIds = [...parcial.fotoIds];
        const [item] = fotoIds.splice(fotoIndex, 1);
        fotoIds.splice(destino, 0, item);
        return { ...parcial, fotoIds };
      }),
    );
  };

  const tirarDaParcial = (parcialIndex: number, fotoId: string) => {
    setParciais((atual) =>
      atual
        .map((parcial, index) =>
          index === parcialIndex
            ? { ...parcial, fotoIds: parcial.fotoIds.filter((id) => id !== fotoId) }
            : parcial,
        )
        .filter((parcial) => parcial.fotoIds.length > 0),
    );
    setExcluidas((atual) =>
      atual.some((item) => item.id === fotoId)
        ? atual
        : [...atual, { id: fotoId, motivo: 'Removida por você.' }],
    );
  };

  const incluirNaParcial = (fotoId: string, parcialKey: string) => {
    setExcluidas((atual) => atual.filter((item) => item.id !== fotoId));
    setParciais((atual) => {
      if (!atual.length || parcialKey === 'nova') {
        return [
          ...atual,
          { key: novoId(), titulo: `Parcial ${atual.length + 1}`, legenda: objetivo.trim(), fotoIds: [fotoId] },
        ];
      }
      return atual.map((parcial) =>
        parcial.key === parcialKey && !parcial.fotoIds.includes(fotoId)
          ? { ...parcial, fotoIds: [...parcial.fotoIds, fotoId] }
          : parcial,
      );
    });
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
      <div className="max-w-6xl mx-auto space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-white">Relatório fotográfico</h2>
          <p className="mt-1 text-sm text-slate-400">
            Escreva o objetivo, carregue as fotos e deixe o DeepSeek v4.1 Flash escolher o que entra.
            O Word sai no modelo da IMAP: capa, retrato em pares e paisagem em linha própria.
          </p>
        </div>

        <section className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-4 sm:p-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-400">Empreendimento</span>
              <input
                value={projeto}
                maxLength={120}
                onChange={(event) => setProjeto(event.target.value)}
                placeholder="Ex.: Fazenda Paranoá"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
              />
            </label>
            <div className="hidden sm:block" />
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-400">Objetivo do relatório</span>
            <textarea
              value={objetivo}
              maxLength={4000}
              rows={4}
              onChange={(event) => setObjetivo(event.target.value)}
              placeholder="Ex.: Registrar o acesso, a sede e a área de vegetação nativa vistoriada em campo."
              className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
            />
          </label>
        </section>

        <section className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-4 sm:p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-200">Fotografias</h3>
              <p className="text-xs text-slate-500">{fotos.length} de {MAX_FOTOS}</p>
            </div>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-xl border border-white/10 px-3 text-sm text-slate-200 hover:bg-white/5"
            >
              <Camera size={16} />
              Adicionar fotos
            </button>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) void adicionarArquivos(event.target.files);
                event.target.value = '';
              }}
            />
          </div>

          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              void adicionarArquivos(event.dataTransfer.files);
            }}
            className={`rounded-xl border border-dashed border-white/10 ${fotos.length ? '' : 'px-4 py-10 text-center'}`}
          >
            {fotos.length === 0 ? (
              <p className="text-sm text-slate-500">Arraste as fotos aqui ou use o botão acima.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
                {fotos.map((foto) => (
                  <figure key={foto.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                    <img src={foto.previewUrl} alt={foto.nome} className="h-28 w-full object-cover" />
                    <figcaption className="flex items-start justify-between gap-1 p-2">
                      <span className="truncate text-[10px] text-slate-400" title={foto.nome}>
                        {foto.height > foto.width ? 'Retrato' : 'Paisagem'}
                      </span>
                      <button type="button" onClick={() => removerFoto(foto.id)} className="text-slate-500 hover:text-red-300" aria-label={`Remover ${foto.nome}`}>
                        <X size={14} />
                      </button>
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={analisando || gerando}
              onClick={() => void analisar()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {analisando ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
              Selecionar com IA
            </button>
            <button
              type="button"
              disabled={analisando || gerando}
              onClick={montarManual}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 px-4 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
            >
              Usar todas, sem IA
            </button>
            {analisando && (
              <button
                type="button"
                onClick={() => abortRef.current?.abort()}
                className="text-xs text-slate-500 underline"
              >
                Cancelar
              </button>
            )}
          </div>
          {mensagem && (
            <p className="mt-3 flex items-start gap-2 text-sm text-cyan-200">
              {analisando ? <Loader2 size={16} className="mt-0.5 animate-spin" /> : <AlertTriangle size={16} className="mt-0.5" />}
              {mensagem}
            </p>
          )}
          <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
            A seleção envia as fotos ao DeepSeek v4.1 Flash pelo OpenCode Go, no 9Router, com raciocínio máximo.
            O raciocínio longo pode levar alguns minutos.
          </p>
        </section>

        {(parciais.length > 0 || excluidas.length > 0) && (
          <section className="space-y-4">
            {resumo && (
              <div className="flex items-start gap-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-sm text-emerald-100">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                <div>
                  <p>{resumo}</p>
                  {modelo && <p className="mt-1 text-[11px] text-emerald-200/70">{modelo}</p>}
                </div>
              </div>
            )}

            {parciais.map((parcial, parcialIndex) => (
              <article key={parcial.key} className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-4 sm:p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <input
                    value={parcial.titulo}
                    onChange={(event) =>
                      setParciais((atual) =>
                        atual.map((item) => (item.key === parcial.key ? { ...item, titulo: event.target.value } : item)),
                      )
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none"
                  />
                  <span className="text-[11px] text-slate-500">{parcial.fotoIds.length} foto(s)</span>
                </div>
                <textarea
                  value={parcial.legenda}
                  rows={3}
                  onChange={(event) =>
                    setParciais((atual) =>
                      atual.map((item) => (item.key === parcial.key ? { ...item, legenda: event.target.value } : item)),
                    )
                  }
                  placeholder="Legenda repetida em cada figura desta parcial"
                  className="mb-3 w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {parcial.fotoIds.map((fotoId, fotoIndex) => {
                    const foto = porId.get(fotoId);
                    if (!foto) return null;
                    return (
                      <figure key={fotoId} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                        <img src={foto.previewUrl} alt={foto.nome} className="h-32 w-full object-cover" />
                        <figcaption className="flex items-center justify-between gap-1 p-2">
                          <span className="truncate text-[10px] text-slate-400" title={foto.nome}>{foto.nome}</span>
                          <span className="flex gap-1">
                            <button type="button" className="text-xs text-slate-400" onClick={() => moverFoto(parcialIndex, fotoIndex, -1)} aria-label="Mover para a esquerda">←</button>
                            <button type="button" className="text-xs text-slate-400" onClick={() => moverFoto(parcialIndex, fotoIndex, 1)} aria-label="Mover para a direita">→</button>
                            <button type="button" className="text-slate-500 hover:text-red-300" onClick={() => tirarDaParcial(parcialIndex, fotoId)} aria-label="Tirar da parcial">
                              <Trash2 size={13} />
                            </button>
                          </span>
                        </figcaption>
                      </figure>
                    );
                  })}
                </div>
              </article>
            ))}

            {excluidas.length > 0 && (
              <article className="rounded-2xl border border-white/10 bg-[#0e1612]/70 p-4 sm:p-5">
                <h3 className="mb-3 text-sm font-medium text-slate-300">Fora do relatório</h3>
                <div className="grid gap-3 sm:grid-cols-2">
                  {excluidas.map((item) => {
                    const foto = porId.get(item.id);
                    if (!foto) return null;
                    return (
                      <div key={item.id} className="flex gap-3 rounded-xl border border-white/10 bg-black/20 p-2">
                        <img src={foto.previewUrl} alt={foto.nome} className="h-16 w-16 rounded-lg object-cover" />
                        <div className="min-w-0 flex-1">
                          <p className="text-xs text-slate-300">{item.motivo}</p>
                          <label className="mt-2 block text-[10px] text-slate-500">
                            Incluir em
                            <select
                              defaultValue=""
                              onChange={(event) => {
                                if (!event.target.value) return;
                                incluirNaParcial(item.id, event.target.value);
                              }}
                              className="mt-1 w-full rounded-lg border border-white/10 bg-[#0e1612] px-2 py-1 text-xs text-slate-200"
                            >
                              <option value="">Escolher parcial</option>
                              {parciais.map((parcial, index) => (
                                <option key={parcial.key} value={parcial.key}>
                                  {parcial.titulo || `Parcial ${index + 1}`}
                                </option>
                              ))}
                              <option value="nova">Nova parcial</option>
                            </select>
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </article>
            )}

            <button
              type="button"
              disabled={gerando || analisando}
              onClick={() => void gerarWord()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {gerando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
              Baixar Word
            </button>
          </section>
        )}
      </div>
    </div>
  );
}
