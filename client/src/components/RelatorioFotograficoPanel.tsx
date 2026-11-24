/**
 * Aba Fotos — relatório fotográfico no modelo Word da IMAP, em 3 passos:
 *   1. objetivo  2. fotos (a IA organiza, ou a pessoa)  3. revisar e baixar.
 * A paginação da prévia e do Word é a mesma (`shared/relatorio-fotografico/layout.ts`).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Camera,
  Check,
  CheckCircle2,
  Download,
  FileText,
  ImagePlus,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { apiFetch, readApiErrorMessage } from '@/lib/api';
import {
  MAX_FOTOS,
  ehHeic,
  lerArquivo,
  lerEventos,
  novoId,
  ordenarPorNome,
  tempoDecorrido,
  type FaseAnalise,
  type FotoFora,
  type FotoLocal,
  type ParcialLocal,
  type SelecaoResposta,
} from './relatorio-fotografico/fotos';
import PreviaWord, { contarPaginas } from './relatorio-fotografico/PreviaWord';

const EXEMPLOS: Array<{ rotulo: string; texto: string }> = [
  {
    rotulo: 'Vistoria de campo',
    texto:
      'Registrar a vistoria de campo do imóvel: acesso, sede e benfeitorias, e as áreas de vegetação nativa e de uso consolidado.',
  },
  {
    rotulo: 'Vegetação nativa',
    texto: 'Comprovar a existência e o estado de conservação da vegetação nativa na área de Reserva Legal.',
  },
  {
    rotulo: 'Recuperação de APP',
    texto: 'Mostrar a situação da APP do curso d\'água: cercamento, regeneração natural e pontos ainda sem cobertura.',
  },
  {
    rotulo: 'Embargo / fiscalização',
    texto: 'Registrar a situação atual da área embargada, mostrando se houve novo uso do solo ou regeneração.',
  },
];

const FASES: Array<{ id: FaseAnalise; texto: string }> = [
  { id: 'enviando', texto: 'Enviando as fotos' },
  { id: 'recebidas', texto: 'Fotos recebidas no servidor' },
  { id: 'pensando', texto: 'A IA está olhando cada foto' },
  { id: 'escrevendo', texto: 'A IA está escrevendo as legendas' },
];

const OBJETIVO_MINIMO = 8;

function Passo({
  numero,
  titulo,
  descricao,
  feito,
  children,
  apagado,
  ancora,
}: {
  numero: number;
  titulo: string;
  descricao: string;
  feito?: boolean;
  apagado?: boolean;
  ancora?: React.Ref<HTMLElement>;
  children?: React.ReactNode;
}) {
  return (
    <section
      ref={ancora}
      className={`rounded-2xl border border-white/10 bg-[#0e1612]/70 p-4 sm:p-5 ${apagado ? 'opacity-60' : ''}`}
    >
      <header className="mb-4 flex items-start gap-3">
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-semibold ${
            feito ? 'bg-emerald-500/20 text-emerald-300' : 'bg-white/5 text-slate-300'
          }`}
        >
          {feito ? <Check size={16} /> : numero}
        </span>
        <div>
          <h3 className="text-[15px] font-semibold text-white">{titulo}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{descricao}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

/** Desenho mínimo de como as fotos ocupam a página. */
function EsquemaPagina({ tipo }: { tipo: 'retrato' | 'paisagem' }) {
  return (
    <div className="flex h-14 w-10 shrink-0 flex-col items-center justify-center gap-1 rounded-[3px] bg-white/90 p-1">
      {tipo === 'retrato' ? (
        <div className="grid h-12 w-full grid-cols-2 grid-rows-2 gap-0.5">
          <div className="rounded-[1px] bg-emerald-600/70" />
          <div className="rounded-[1px] bg-emerald-600/70" />
          <div className="rounded-[1px] bg-emerald-600/70" />
          <div className="rounded-[1px] bg-emerald-600/70" />
        </div>
      ) : (
        <>
          <div className="h-4 w-full rounded-[1px] bg-emerald-600/70" />
          <div className="h-4 w-full rounded-[1px] bg-emerald-600/70" />
        </>
      )}
    </div>
  );
}

function faixaFiguras(inicio: number, quantidade: number): string {
  if (quantidade <= 1) return `Figura ${inicio}`;
  return `Figuras ${inicio} a ${inicio + quantidade - 1}`;
}

export default function RelatorioFotograficoPanel() {
  const [projeto, setProjeto] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [lendo, setLendo] = useState(false);
  const [arrastando, setArrastando] = useState(false);

  const [parciais, setParciais] = useState<ParcialLocal[]>([]);
  const [fora, setFora] = useState<FotoFora[]>([]);
  const [motivos, setMotivos] = useState<Record<string, string>>({});
  const [resumo, setResumo] = useState('');
  const [organizado, setOrganizado] = useState<'ia' | 'manual' | null>(null);

  const [fase, setFase] = useState<FaseAnalise | null>(null);
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState('');
  const [gerando, setGerando] = useState(false);
  const [tentouBaixar, setTentouBaixar] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const passo3Ref = useRef<HTMLElement | null>(null);
  const primeiraLegendaRef = useRef<HTMLTextAreaElement | null>(null);

  const analisando = fase !== null;
  const porId = useMemo(() => new Map(fotos.map((foto) => [foto.id, foto])), [fotos]);
  const objetivoOk = objetivo.trim().length >= OBJETIVO_MINIMO;
  const totalNoRelatorio = parciais.reduce((soma, parcial) => soma + parcial.fotoIds.length, 0);
  const paginas = contarPaginas(parciais, porId);
  const semLegenda = parciais.findIndex((parcial) => !parcial.legenda.trim());

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!analisando) return;
    setSegundos(0);
    const inicio = Date.now();
    const timer = window.setInterval(() => setSegundos(Math.round((Date.now() - inicio) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [analisando]);

  const irParaPasso3 = () =>
    window.setTimeout(() => passo3Ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);

  /* ─── Passo 2: fotos ─── */

  const adicionarArquivos = useCallback(
    async (lista: FileList | File[]) => {
      const todos = Array.from(lista);
      const heic = todos.filter(ehHeic);
      const imagens = ordenarPorNome(todos.filter((file) => file.type.startsWith('image/') && !ehHeic(file)));
      if (heic.length) {
        toast.error(`${heic.length} foto(s) HEIC do iPhone não abrem no navegador. Exporte como JPG e envie de novo.`);
      }
      if (!imagens.length) {
        if (!heic.length) toast.error('Escolha arquivos de imagem (JPG, PNG ou WEBP).');
        return;
      }
      const jaTem = new Set(fotos.map((foto) => `${foto.nome}|${foto.tamanho}`));
      const novas = imagens.filter((file) => !jaTem.has(`${file.name}|${file.size}`));
      const repetidas = imagens.length - novas.length;
      const vagas = MAX_FOTOS - fotos.length;
      if (vagas <= 0) {
        toast.error(`O limite é ${MAX_FOTOS} fotos por relatório.`);
        return;
      }
      const lote = novas.slice(0, vagas);
      setLendo(true);
      const lidas: FotoLocal[] = [];
      const falhas: string[] = [];
      for (const arquivo of lote) {
        try {
          lidas.push(await lerArquivo(arquivo));
        } catch {
          falhas.push(arquivo.name);
        }
      }
      setLendo(false);
      if (lidas.length) {
        setFotos((atual) => [...atual, ...lidas]);
        if (organizado) {
          // Já organizado: a foto nova espera a pessoa decidir onde entra.
          setFora((atual) => [...atual, ...lidas.map((foto) => ({ id: foto.id, motivo: 'Adicionada depois da organização.' }))]);
        }
      }
      if (repetidas) toast.message(`${repetidas} foto(s) já estavam na lista e foram ignoradas.`);
      if (falhas.length) toast.error(`Não foi possível abrir: ${falhas.slice(0, 3).join(', ')}`);
      if (novas.length > vagas) toast.error(`Só cabem ${MAX_FOTOS} fotos. ${novas.length - vagas} ficaram de fora.`);
    },
    [fotos, organizado],
  );

  const removerFoto = (id: string) => {
    setFotos((atual) => atual.filter((foto) => foto.id !== id));
    setParciais((atual) =>
      atual
        .map((parcial) => ({ ...parcial, fotoIds: parcial.fotoIds.filter((fotoId) => fotoId !== id) }))
        .filter((parcial) => parcial.fotoIds.length > 0),
    );
    setFora((atual) => atual.filter((item) => item.id !== id));
  };

  /* ─── Organizar ─── */

  const aplicarSelecao = (selecao: SelecaoResposta) => {
    const ids = new Set(fotos.map((foto) => foto.id));
    const usados = new Set<string>();
    const motivosNovos: Record<string, string> = {};
    const proximas: ParcialLocal[] = [];
    (selecao.parciais || []).forEach((parcial, index) => {
      const fotoIds: string[] = [];
      for (const entry of parcial.fotos || []) {
        const id = typeof entry === 'string' ? entry : String(entry?.id || '');
        if (!ids.has(id) || usados.has(id)) continue;
        usados.add(id);
        fotoIds.push(id);
        if (typeof entry !== 'string' && entry?.motivo) motivosNovos[id] = entry.motivo;
      }
      if (!fotoIds.length) return;
      proximas.push({
        key: novoId(),
        titulo: parcial.titulo || `Parcial ${index + 1}`,
        legenda: parcial.legenda || '',
        fotoIds,
      });
    });
    if (!proximas.length) throw new Error('A IA não escolheu nenhuma foto. Reescreva o objetivo ou organize você mesmo.');
    const motivoFora = new Map((selecao.excluidas || []).map((item) => [String(item.id || ''), item.motivo || '']));
    setParciais(proximas);
    setFora(
      fotos
        .filter((foto) => !usados.has(foto.id))
        .map((foto) => ({ id: foto.id, motivo: motivoFora.get(foto.id) || 'A IA deixou de fora.' })),
    );
    setMotivos(motivosNovos);
    setResumo(selecao.resumo || '');
    setOrganizado('ia');
  };

  const organizarComIa = async () => {
    if (!objetivoOk) {
      toast.error('Escreva o objetivo no passo 1. A IA usa ele para escolher as fotos.');
      return;
    }
    if (!fotos.length) {
      toast.error('Adicione as fotos primeiro.');
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setErro('');
    setFase('enviando');
    try {
      const response = await apiFetch('/api/relatorio-fotografico/analisar', {
        method: 'POST',
        body: JSON.stringify({
          projeto,
          objetivo,
          fotos: fotos.map((foto) => ({ id: foto.id, nome: foto.nome, base64: foto.iaBase64 })),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(await readApiErrorMessage(response));
      setFase('recebidas');
      const resultado = await lerEventos(response, (proxima) => setFase(proxima));
      aplicarSelecao(resultado.selecao);
      toast.success('Fotos organizadas. Confira as legendas no passo 3.');
      irParaPasso3();
    } catch (error: any) {
      if (error?.name === 'AbortError') return;
      setErro(error?.message || 'A IA não conseguiu organizar as fotos.');
    } finally {
      setFase(null);
      abortRef.current = null;
    }
  };

  const organizarManual = () => {
    if (!fotos.length) {
      toast.error('Adicione as fotos primeiro.');
      return;
    }
    setErro('');
    setParciais([{ key: novoId(), titulo: 'Parcial 1', legenda: '', fotoIds: fotos.map((foto) => foto.id) }]);
    setFora([]);
    setMotivos({});
    setResumo('');
    setOrganizado('manual');
    irParaPasso3();
    window.setTimeout(() => primeiraLegendaRef.current?.focus({ preventScroll: true }), 500);
  };

  const recomecar = () => {
    if (!window.confirm('Apagar as fotos e a organização e começar de novo?')) return;
    abortRef.current?.abort();
    setFotos([]);
    setParciais([]);
    setFora([]);
    setMotivos({});
    setResumo('');
    setOrganizado(null);
    setErro('');
    setTentouBaixar(false);
  };

  /* ─── Passo 3: revisar ─── */

  const editarParcial = (key: string, campo: 'titulo' | 'legenda', valor: string) =>
    setParciais((atual) => atual.map((item) => (item.key === key ? { ...item, [campo]: valor } : item)));

  const moverParcial = (index: number, direcao: -1 | 1) =>
    setParciais((atual) => {
      const destino = index + direcao;
      if (destino < 0 || destino >= atual.length) return atual;
      const lista = [...atual];
      const [item] = lista.splice(index, 1);
      lista.splice(destino, 0, item);
      return lista;
    });

  const removerParcial = (key: string) => {
    const parcial = parciais.find((item) => item.key === key);
    if (!parcial) return;
    setParciais((atual) => atual.filter((item) => item.key !== key));
    setFora((atual) => [...atual, ...parcial.fotoIds.map((id) => ({ id, motivo: 'Parcial apagada por você.' }))]);
  };

  const moverFoto = (parcialKey: string, fotoIndex: number, direcao: -1 | 1) =>
    setParciais((atual) =>
      atual.map((parcial) => {
        if (parcial.key !== parcialKey) return parcial;
        const destino = fotoIndex + direcao;
        if (destino < 0 || destino >= parcial.fotoIds.length) return parcial;
        const fotoIds = [...parcial.fotoIds];
        const [item] = fotoIds.splice(fotoIndex, 1);
        fotoIds.splice(destino, 0, item);
        return { ...parcial, fotoIds };
      }),
    );

  const tirarFoto = (parcialKey: string, fotoId: string) => {
    setParciais((atual) =>
      atual
        .map((parcial) =>
          parcial.key === parcialKey ? { ...parcial, fotoIds: parcial.fotoIds.filter((id) => id !== fotoId) } : parcial,
        )
        .filter((parcial) => parcial.fotoIds.length > 0),
    );
    setFora((atual) => (atual.some((item) => item.id === fotoId) ? atual : [...atual, { id: fotoId, motivo: 'Tirada por você.' }]));
  };

  const devolverFoto = (fotoId: string, destino: string) => {
    if (!destino) return;
    setFora((atual) => atual.filter((item) => item.id !== fotoId));
    setParciais((atual) => {
      if (destino === 'nova' || !atual.length) {
        return [...atual, { key: novoId(), titulo: `Parcial ${atual.length + 1}`, legenda: '', fotoIds: [fotoId] }];
      }
      return atual.map((parcial) =>
        parcial.key === destino && !parcial.fotoIds.includes(fotoId)
          ? { ...parcial, fotoIds: [...parcial.fotoIds, fotoId] }
          : parcial,
      );
    });
  };

  const baixarWord = async () => {
    setTentouBaixar(true);
    if (!parciais.length) {
      toast.error('Não há fotos no relatório.');
      return;
    }
    if (semLegenda >= 0) {
      toast.error(`Escreva a legenda da parcial ${semLegenda + 1}.`);
      return;
    }
    setGerando(true);
    try {
      const response = await apiFetch('/api/relatorio-fotografico/docx', {
        method: 'POST',
        body: JSON.stringify({
          projeto,
          parciais: parciais.map((parcial) => ({
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
      const nome = (projeto.trim() || 'Relatorio_Fotografico')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^\w.-]+/g, '_');
      link.href = url;
      link.download = `${nome}.docx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Word baixado no modelo da IMAP.');
    } catch (error: any) {
      toast.error(error?.message || 'Não foi possível gerar o Word.');
    } finally {
      setGerando(false);
    }
  };

  /* ─── Tela ─── */

  const passoAtual = !objetivoOk ? 1 : !organizado ? 2 : 3;
  let figura = 1;

  return (
    <div className="flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-8 custom-scrollbar">
      <div className="mx-auto max-w-6xl space-y-5">
        {/* Cabeçalho */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-white">Relatório fotográfico</h2>
            <p className="mt-1 max-w-2xl text-sm text-slate-400">
              Monte o relatório de campo no modelo Word da IMAP. A IA escolhe as fotos, põe em ordem e escreve as
              legendas. Você confere e baixa.
            </p>
          </div>
          {(fotos.length > 0 || organizado) && (
            <button
              type="button"
              onClick={recomecar}
              disabled={analisando}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs text-slate-400 hover:bg-white/5 hover:text-slate-200 disabled:opacity-40"
            >
              <RotateCcw size={13} />
              Recomeçar
            </button>
          )}
        </div>

        {/* Trilha dos passos */}
        <ol className="grid grid-cols-3 gap-2 text-xs">
          {['Objetivo', 'Fotos', 'Revisar e baixar'].map((rotulo, index) => {
            const numero = index + 1;
            const feito = numero < passoAtual;
            const atual = numero === passoAtual;
            return (
              <li
                key={rotulo}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                  atual
                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100'
                    : feito
                      ? 'border-white/10 text-emerald-300/80'
                      : 'border-white/5 text-slate-500'
                }`}
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/5 text-[11px]">
                  {feito ? <Check size={12} /> : numero}
                </span>
                <span className="truncate">{rotulo}</span>
              </li>
            );
          })}
        </ol>

        {/* Passo 1 */}
        <Passo
          numero={1}
          titulo="O que o relatório precisa mostrar?"
          descricao="A IA lê o objetivo para decidir quais fotos entram e para escrever as legendas. Quanto mais claro, melhor."
          feito={objetivoOk}
        >
          <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-300">Imóvel ou empreendimento</span>
              <input
                value={projeto}
                maxLength={120}
                onChange={(event) => setProjeto(event.target.value)}
                placeholder="Ex.: Fazenda Paranoá"
                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
              />
              <span className="mt-1 block text-[11px] text-slate-500">Vira o nome do arquivo Word.</span>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-300">Objetivo do relatório</span>
              <textarea
                value={objetivo}
                maxLength={4000}
                rows={3}
                onChange={(event) => setObjetivo(event.target.value)}
                placeholder="Ex.: Registrar o acesso, a sede e a área de vegetação nativa vistoriada em campo."
                className="w-full resize-y rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-white outline-none focus:border-emerald-500/50"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">Começar de um exemplo:</span>
            {EXEMPLOS.map((exemplo) => (
              <button
                key={exemplo.rotulo}
                type="button"
                onClick={() => setObjetivo(exemplo.texto)}
                className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-slate-300 hover:border-emerald-500/40 hover:text-emerald-200"
              >
                {exemplo.rotulo}
              </button>
            ))}
          </div>
        </Passo>

        {/* Passo 2 */}
        <Passo
          numero={2}
          titulo="Envie as fotos"
          descricao={`Pode mandar todas as fotos da vistoria, até ${MAX_FOTOS}. A IA descarta as borradas, repetidas e as que não têm a ver com o objetivo.`}
          feito={Boolean(organizado)}
        >
          <div
            role="button"
            tabIndex={0}
            onClick={() => inputRef.current?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setArrastando(true);
            }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(event) => {
              event.preventDefault();
              setArrastando(false);
              void adicionarArquivos(event.dataTransfer.files);
            }}
            className={`cursor-pointer rounded-xl border border-dashed transition-colors ${
              arrastando ? 'border-emerald-400/60 bg-emerald-500/10' : 'border-white/15 hover:border-white/30'
            } ${fotos.length ? 'px-3 py-3' : 'px-4 py-10'}`}
          >
            {fotos.length === 0 ? (
              <div className="flex flex-col items-center text-center">
                {lendo ? (
                  <Loader2 size={28} className="mb-2 animate-spin text-emerald-300" />
                ) : (
                  <ImagePlus size={28} className="mb-2 text-slate-400" />
                )}
                <p className="text-sm text-slate-200">{lendo ? 'Abrindo as fotos...' : 'Arraste as fotos aqui ou clique para escolher'}</p>
                <p className="mt-1 text-[11px] text-slate-500">JPG, PNG ou WEBP · até {MAX_FOTOS} fotos</p>
              </div>
            ) : (
              <div className="flex items-center justify-between gap-3 text-xs text-slate-400">
                <span className="inline-flex items-center gap-2">
                  {lendo ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                  {fotos.length} de {MAX_FOTOS} fotos
                </span>
                <span className="text-emerald-300/90">+ Adicionar mais</span>
              </div>
            )}
          </div>
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

          {fotos.length > 0 && (
            <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-8">
              {fotos.map((foto) => (
                <figure key={foto.id} className="group relative overflow-hidden rounded-lg border border-white/10 bg-black/30">
                  <img src={foto.previewUrl} alt={foto.nome} className="h-28 w-full object-contain" />
                  <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 text-[9px] text-slate-200">
                    {foto.orientation === 'portrait' ? 'Em pé' : 'Deitada'}
                  </span>
                  <button
                    type="button"
                    disabled={analisando}
                    onClick={() => removerFoto(foto.id)}
                    className="absolute right-1 top-1 rounded bg-black/60 p-0.5 text-slate-300 opacity-0 transition-opacity hover:text-red-300 group-hover:opacity-100 disabled:hidden"
                    aria-label={`Remover ${foto.nome}`}
                    title="Remover"
                  >
                    <X size={13} />
                  </button>
                </figure>
              ))}
            </div>
          )}

          <div className="mt-4 grid gap-3 rounded-xl bg-black/20 p-3 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <EsquemaPagina tipo="retrato" />
              <p className="text-[11px] leading-relaxed text-slate-400">
                <strong className="text-slate-200">Até 4 fotos em pé por página,</strong> centralizadas, com espaço para as legendas.
              </p>
            </div>
            <div className="flex items-center gap-3">
              <EsquemaPagina tipo="paisagem" />
              <p className="text-[11px] leading-relaxed text-slate-400">
                <strong className="text-slate-200">2 fotos deitadas por página,</strong> uma embaixo da outra.
              </p>
            </div>
          </div>

          {analisando ? (
            <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-emerald-100">Organizando com IA · {tempoDecorrido(segundos)}</p>
                <button
                  type="button"
                  onClick={() => abortRef.current?.abort()}
                  className="text-xs text-slate-400 underline hover:text-slate-200"
                >
                  Cancelar
                </button>
              </div>
              <ol className="space-y-1.5">
                {FASES.map((item, index) => {
                  const atual = FASES.findIndex((f) => f.id === fase);
                  const estado = index < atual ? 'feito' : index === atual ? 'agora' : 'depois';
                  return (
                    <li
                      key={item.id}
                      className={`flex items-center gap-2 text-xs ${
                        estado === 'feito' ? 'text-emerald-300/80' : estado === 'agora' ? 'text-white' : 'text-slate-500'
                      }`}
                    >
                      {estado === 'feito' ? (
                        <Check size={13} />
                      ) : estado === 'agora' ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <span className="h-[13px] w-[13px] rounded-full border border-slate-600" />
                      )}
                      {item.texto}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-3 text-[11px] text-slate-500">
                Com raciocínio máximo leva de 1 a 6 minutos, conforme a quantidade de fotos. Pode continuar nesta aba.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={!fotos.length || !objetivoOk || lendo}
                  onClick={() => void organizarComIa()}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Sparkles size={16} />
                  {organizado === 'ia' ? 'Organizar de novo com IA' : 'Organizar com IA'}
                </button>
                <button
                  type="button"
                  disabled={!fotos.length || lendo}
                  onClick={organizarManual}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-white/10 px-4 text-sm text-slate-200 hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Wand2 size={16} />
                  Organizar eu mesmo
                </button>
              </div>
              {!fotos.length ? (
                <p className="text-[11px] text-slate-500">Adicione as fotos para liberar os botões.</p>
              ) : !objetivoOk ? (
                <p className="text-[11px] text-amber-300/80">Para usar a IA, escreva o objetivo no passo 1.</p>
              ) : (
                <p className="text-[11px] text-slate-500">
                  <strong className="text-slate-400">Organizar eu mesmo:</strong> todas as fotos entram numa parcial só
                  e você escreve a legenda.
                </p>
              )}
            </div>
          )}

          {erro && !analisando && (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-100">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div>
                <p>{erro}</p>
                <p className="mt-1 text-xs text-red-200/70">
                  Tente de novo em instantes, ou use <strong>Organizar eu mesmo</strong> para não esperar a IA.
                </p>
              </div>
            </div>
          )}
        </Passo>

        {/* Passo 3 */}
        <Passo
          numero={3}
          titulo="Revise e baixe o Word"
          descricao={
            organizado
              ? 'Confira a ordem e as legendas. O que você mudar aqui aparece na prévia ao lado e no Word.'
              : 'Aparece depois que as fotos forem organizadas no passo 2.'
          }
          apagado={!organizado}
          ancora={passo3Ref}
        >
          {organizado && (
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)]">
              <div className="space-y-4">
                {resumo && (
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                    <CheckCircle2 size={16} className="mt-0.5 shrink-0" />
                    <p>{resumo}</p>
                  </div>
                )}
                <p className="rounded-xl bg-black/20 p-3 text-[11px] leading-relaxed text-slate-400">
                  <strong className="text-slate-200">Parcial</strong> é um grupo de fotos do mesmo assunto (acesso, sede,
                  vegetação...). Todas as fotos da parcial levam a mesma legenda, e o Word numera cada uma:
                  <em className="text-slate-300"> “Figura 1. Vista parcial da sede.”</em>
                </p>

                {parciais.map((parcial, parcialIndex) => {
                  const inicio = figura;
                  figura += parcial.fotoIds.length;
                  const faltaLegenda = tentouBaixar && !parcial.legenda.trim();
                  return (
                    <article
                      key={parcial.key}
                      className={`rounded-xl border bg-black/20 p-3 sm:p-4 ${faltaLegenda ? 'border-red-400/50' : 'border-white/10'}`}
                    >
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-white/5 px-2 py-0.5 text-[11px] text-slate-400">
                          Parcial {parcialIndex + 1} · {faixaFiguras(inicio, parcial.fotoIds.length)}
                        </span>
                        <input
                          value={parcial.titulo}
                          onChange={(event) => editarParcial(parcial.key, 'titulo', event.target.value)}
                          aria-label="Assunto da parcial"
                          className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white outline-none"
                        />
                        <span className="flex items-center gap-0.5 text-slate-500">
                          <button type="button" onClick={() => moverParcial(parcialIndex, -1)} disabled={parcialIndex === 0} className="rounded p-1 hover:bg-white/5 hover:text-slate-200 disabled:opacity-30" title="Subir parcial">
                            <ArrowUp size={14} />
                          </button>
                          <button type="button" onClick={() => moverParcial(parcialIndex, 1)} disabled={parcialIndex === parciais.length - 1} className="rounded p-1 hover:bg-white/5 hover:text-slate-200 disabled:opacity-30" title="Descer parcial">
                            <ArrowDown size={14} />
                          </button>
                          <button type="button" onClick={() => removerParcial(parcial.key)} className="rounded p-1 hover:bg-white/5 hover:text-red-300" title="Apagar parcial (as fotos vão para “Fora do relatório”)">
                            <Trash2 size={14} />
                          </button>
                        </span>
                      </div>

                      <label className="block">
                        <span className="mb-1 block text-[11px] text-slate-400">Legenda (vai em cada figura desta parcial)</span>
                        <textarea
                          ref={parcialIndex === 0 ? primeiraLegendaRef : undefined}
                          value={parcial.legenda}
                          rows={2}
                          onChange={(event) => editarParcial(parcial.key, 'legenda', event.target.value)}
                          placeholder="Ex.: Vista parcial da área de vegetação nativa vistoriada."
                          className="w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none focus:border-emerald-500/50"
                        />
                      </label>
                      {faltaLegenda && <p className="mt-1 text-[11px] text-red-300">Escreva a legenda antes de baixar.</p>}

                      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {parcial.fotoIds.map((fotoId, fotoIndex) => {
                          const foto = porId.get(fotoId);
                          if (!foto) return null;
                          return (
                            <figure key={fotoId} className="overflow-hidden rounded-lg border border-white/10 bg-black/30">
                              <div className="relative">
                                <img src={foto.previewUrl} alt={foto.nome} className="h-32 w-full bg-black/40 object-contain" />
                                <span className="absolute left-1 top-1 rounded bg-black/70 px-1.5 text-[10px] font-medium text-white">
                                  Fig. {inicio + fotoIndex}
                                </span>
                              </div>
                              <figcaption className="p-1.5">
                                {motivos[fotoId] && (
                                  <p className="mb-1 line-clamp-2 text-[10px] leading-snug text-slate-400" title={motivos[fotoId]}>
                                    {motivos[fotoId]}
                                  </p>
                                )}
                                <span className="flex items-center justify-between text-slate-500">
                                  <span className="flex">
                                    <button type="button" onClick={() => moverFoto(parcial.key, fotoIndex, -1)} disabled={fotoIndex === 0} className="rounded p-0.5 hover:text-slate-200 disabled:opacity-30" title="Antes">
                                      <ArrowLeft size={13} />
                                    </button>
                                    <button type="button" onClick={() => moverFoto(parcial.key, fotoIndex, 1)} disabled={fotoIndex === parcial.fotoIds.length - 1} className="rounded p-0.5 hover:text-slate-200 disabled:opacity-30" title="Depois">
                                      <ArrowRight size={13} />
                                    </button>
                                  </span>
                                  <button type="button" onClick={() => tirarFoto(parcial.key, fotoId)} className="inline-flex items-center gap-1 rounded px-1 text-[10px] hover:text-red-300" title="Tirar do relatório">
                                    <X size={12} />
                                    Tirar
                                  </button>
                                </span>
                              </figcaption>
                            </figure>
                          );
                        })}
                      </div>
                    </article>
                  );
                })}

                {parciais.length === 0 && (
                  <p className="rounded-xl border border-dashed border-white/10 p-4 text-center text-xs text-slate-500">
                    Nenhuma foto no relatório. Devolva alguma de “Fora do relatório”.
                  </p>
                )}

                {fora.length > 0 && (
                  <article className="rounded-xl border border-white/10 bg-black/20 p-3 sm:p-4">
                    <h4 className="text-sm font-medium text-slate-200">Fora do relatório ({fora.length})</h4>
                    <p className="mb-3 text-[11px] text-slate-500">Estas fotos não vão para o Word. Para usar alguma, escolha a parcial.</p>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {fora.map((item) => {
                        const foto = porId.get(item.id);
                        if (!foto) return null;
                        return (
                          <div key={item.id} className="flex gap-2 rounded-lg border border-white/10 bg-black/20 p-2">
                            <img src={foto.previewUrl} alt={foto.nome} className="h-14 w-14 shrink-0 rounded object-cover" />
                            <div className="min-w-0 flex-1">
                              <p className="line-clamp-2 text-[11px] text-slate-300" title={item.motivo}>{item.motivo}</p>
                              <label className="mt-1 flex items-center gap-1 text-[10px] text-slate-500">
                                <Undo2 size={11} />
                                <select
                                  value=""
                                  onChange={(event) => devolverFoto(item.id, event.target.value)}
                                  className="w-full rounded border border-white/10 bg-[#0e1612] px-1.5 py-1 text-[11px] text-slate-200"
                                >
                                  <option value="">Pôr de volta em...</option>
                                  {parciais.map((parcial, index) => (
                                    <option key={parcial.key} value={parcial.key}>
                                      Parcial {index + 1} · {parcial.titulo}
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
              </div>

              <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <h4 className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-200">
                      <FileText size={14} />
                      Como vai ficar no Word
                    </h4>
                    <span className="text-[11px] text-slate-500">
                      {totalNoRelatorio} foto(s) · {paginas} página(s)
                    </span>
                  </div>
                  <PreviaWord parciais={parciais} porId={porId} />
                  <p className="mt-2 text-[11px] text-slate-500">Página 1 é a capa. Passe o mouse numa foto para ler a legenda inteira.</p>
                </div>
                <button
                  type="button"
                  disabled={gerando || analisando || totalNoRelatorio === 0}
                  onClick={() => void baixarWord()}
                  className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {gerando ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {gerando ? 'Gerando o Word...' : 'Baixar Word'}
                </button>
                {semLegenda >= 0 && (
                  <p className="text-center text-[11px] text-amber-300/80">
                    Falta a legenda da parcial {semLegenda + 1}.
                  </p>
                )}
              </aside>
            </div>
          )}
        </Passo>
      </div>
    </div>
  );
}
