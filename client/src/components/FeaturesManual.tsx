import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Brain,
  Camera,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  Globe,
  HelpCircle,
  Layers,
  Lightbulb,
  MousePointerClick,
  Satellite,
  Scissors,
  ShieldCheck,
  Wallet,
} from 'lucide-react';

type FeaturesManualProps = {
  manualSection: string | null;
  setManualSection: React.Dispatch<React.SetStateAction<string | null>>;
  onGoChat: () => void;
  onGoSimcar: () => void;
  onGoAuas: () => void;
  onGoCbers: () => void;
};

export default function FeaturesManual({
  manualSection,
  setManualSection,
  onGoChat,
  onGoSimcar,
  onGoAuas,
  onGoCbers,
}: FeaturesManualProps) {
  return (
          <div className="flex-1 overflow-y-auto px-3 sm:px-6 py-4 sm:py-8 custom-scrollbar">
            <div className="max-w-5xl mx-auto space-y-5 sm:space-y-8 animate-fade-in-up">

              {/* ═══ Hero ═══ */}
              <section className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-[#0e1612] to-[#0a1a10] p-5 sm:p-8 md:p-10">
                <div className="absolute top-0 right-0 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/3 pointer-events-none" />
                <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/8 rounded-full blur-3xl translate-y-1/3 -translate-x-1/4 pointer-events-none" />
                <div className="relative flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-6">
                  <div className="p-2 sm:p-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-green-700 shadow-xl shadow-emerald-900/40 shrink-0">
                    <img
                      src="/logo-no-bg.svg"
                      alt="GeoForest IA"
                      className="h-10 w-10 sm:h-12 sm:w-12 object-contain"
                    />
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2 sm:gap-3 mb-2">
                      <h1 className="text-2xl sm:text-3xl font-bold text-white">Manual do GeoForest IA</h1>
                      <span className="px-2.5 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/20 text-[10px] font-bold text-emerald-400 uppercase tracking-wide">v2.0</span>
                    </div>
                    <p className="text-slate-400 max-w-2xl leading-relaxed">
                      Guia completo da plataforma de apoio a engenheiros florestais e analistas ambientais de Mato Grosso.
                      Navegue pelas seções abaixo para aprender a usar cada funcionalidade.
                    </p>
                  </div>
                </div>
              </section>

              {/* ═══ Quick Nav ═══ */}
              <nav className="grid grid-cols-2 gap-2 sm:gap-3 md:grid-cols-4 xl:grid-cols-5">
                {[
                  { id: 'chat', icon: Brain, label: 'Assistente IA', color: 'emerald' },
                  { id: 'simcar', icon: Scissors, label: 'Recorte SIMCAR', color: 'purple' },
                  { id: 'analysis', icon: Satellite, label: 'Análise por IA', color: 'amber' },
                  { id: 'map', icon: Globe, label: 'Mapa WMS', color: 'blue' },
                  { id: 'novo-car', icon: Layers, label: 'Novo CAR', color: 'amber' },
                  { id: 'cbers', icon: Camera, label: 'CBERS-4A', color: 'cyan' },
                  { id: 'billing', icon: Wallet, label: 'Créditos', color: 'emerald' },
                  { id: 'security', icon: ShieldCheck, label: 'Segurança', color: 'red' },
                  { id: 'faq', icon: HelpCircle, label: 'FAQ', color: 'slate' },
                ].map((nav) => (
                  <button
                    key={nav.id}
                    onClick={() => {
                      setManualSection(manualSection === nav.id ? null : nav.id);
                      setTimeout(() => document.getElementById(`manual-${nav.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
                    }}
                    className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${manualSection === nav.id
                      ? `bg-${nav.color}-500/10 border-${nav.color}-500/30 text-${nav.color}-400`
                      : 'bg-white/5 border-white/5 text-slate-400 hover:border-white/15 hover:text-slate-200'
                      }`}
                  >
                    <nav.icon size={18} />
                    <span className="text-sm font-medium">{nav.label}</span>
                  </button>
                ))}
              </nav>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 1 — ASSISTENTE IA
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-chat" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'chat' ? null : 'chat')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400"><Brain size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">1. Assistente IA Florestal</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Chat inteligente com base de conhecimento legislativa</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'chat' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'chat' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><span className="text-emerald-400">O que faz</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        Um assistente de IA especializado em engenharia florestal, legislação ambiental (federal e estadual de MT) e geoprocessamento.
                        Ele consulta uma base de conhecimento com <strong className="text-slate-300">39 documentos regulatórios</strong> indexados, incluindo o Código Florestal (Lei 12.651/2012),
                        INs da SEMA-MT, Resoluções CONAMA, termos de referência e matrizes de decisão.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><MousePointerClick size={14} className="text-emerald-400" /> Como usar</h4>
                      <ol className="space-y-3 text-sm text-slate-400">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">1</span>
                          <span>Na barra lateral, clique em <strong className="text-slate-300">"Novo Chat"</strong> ou selecione uma conversa existente.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">2</span>
                          <span>Digite sua pergunta na caixa de texto. Exemplos: <em className="text-slate-300">"Qual a reserva legal mínima no bioma Cerrado em MT?"</em> ou <em className="text-slate-300">"Explique o Art. 68 do Código Florestal."</em></span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">3</span>
                          <span>Para analisar documentos, clique no ícone de <strong className="text-slate-300">clipe</strong> e anexe um <strong className="text-slate-300">PDF</strong> ou <strong className="text-slate-300">imagem</strong>. A IA irá ler e interpretar o conteúdo.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-emerald-500/15 text-emerald-400 flex items-center justify-center text-xs font-bold">4</span>
                          <span>Use o seletor de modelo (canto inferior) para escolher entre <strong className="text-slate-300">modo automático</strong> (recomendado) ou um modelo específico.</span>
                        </li>
                      </ol>
                    </div>

                    <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4">
                      <h4 className="text-sm font-semibold text-emerald-400 mb-2 flex items-center gap-2"><Lightbulb size={14} /> Dicas</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-emerald-500 mt-1 shrink-0" />Seja específico: "Qual a APP mínima para nascente em propriedade rural de 120 ha?" gera respostas melhores que "me fale sobre APP".</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-emerald-500 mt-1 shrink-0" />Envie prints de mapas do SIMCAR e peça para a IA interpretar o que vê.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-emerald-500 mt-1 shrink-0" />As conversas ficam salvas no Firestore — você pode retomá-las a qualquer momento pela barra lateral.</li>
                      </ul>
                    </div>

                    <button onClick={() => onGoChat()} className="flex items-center gap-2 text-sm font-medium text-emerald-400 hover:text-emerald-300 transition-colors">
                      Ir para o Assistente <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 2 — RECORTE SIMCAR
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-simcar" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'simcar' ? null : 'simcar')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-purple-500/10 text-purple-400"><Scissors size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">2. Recorte e Análise SIMCAR</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Dois modos: recorte automático (WFS) e análise vetorizada (ZIP já pronto)</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'simcar' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'simcar' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-purple-400">O que faz</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        O módulo SIMCAR agora opera em <strong className="text-slate-300">2 fluxos</strong>: <strong className="text-slate-300">Recorte Automático</strong> (gera o recorte no servidor com base no imóvel) e <strong className="text-slate-300">Análise Vetorizada com IA</strong> (quando você já possui o ZIP do modelo com os shapes vetorizados).
                        Em ambos, os resultados ficam no histórico e podem ser reabertos para continuar análise AC/AVN e AUAS.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-purple-500/15 bg-purple-500/5 p-4">
                        <h4 className="text-sm font-semibold text-purple-300 mb-1">Modo 1: Recorte Automático</h4>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Envie o ZIP do imóvel e o sistema recorta as camadas SIMCAR, gera saída para download e habilita as análises IA.
                        </p>
                      </div>
                      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/5 p-4">
                        <h4 className="text-sm font-semibold text-cyan-300 mb-1">Modo 2: Análise Vetorizada IA</h4>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Envie um ZIP já vetorizado e rode a análise completa em 1 clique (AC/AVN + AUAS) sem executar recorte WFS.
                        </p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><MousePointerClick size={14} className="text-purple-400" /> Passo a passo</h4>
                      <ol className="space-y-3 text-sm text-slate-400">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold">1</span>
                          <div>
                            <strong className="text-slate-300">Prepare o shapefile</strong> — Exporte o polígono do imóvel do QGIS/ArcGIS em formato <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">.zip</code> contendo pelo menos os arquivos <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">.shp</code>, <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">.shx</code> e <code className="text-purple-300 bg-purple-500/10 px-1.5 py-0.5 rounded text-xs">.prj</code>.
                            O sistema aceita qualquer projeção UTM e reprojeta automaticamente para SIRGAS 2000 (EPSG:4674).
                          </div>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold">2</span>
                          <span>Clique em <strong className="text-slate-300">"Análise SIMCAR"</strong> na barra lateral e escolha o modo desejado (Recorte ou Vetorizado).</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold">3</span>
                          <span>No modo Recorte, preencha <strong className="text-slate-300">AIR / Identificação</strong>. No modo Vetorizado, envie diretamente o ZIP do modelo vetorizado.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold">4</span>
                          <span>Desmarque camadas que não deseja processar (todas vêm selecionadas por padrão).</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold">5</span>
                          <span>Execute: <strong className="text-slate-300">"Processar Recorte"</strong> (modo recorte) ou <strong className="text-slate-300">"Análise Completa por IA"</strong> (modo vetorizado).</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-purple-500/15 text-purple-400 flex items-center justify-center text-xs font-bold">6</span>
                          <span>Ao concluir, revise os resultados no painel e no histórico; no modo recorte também há download do ZIP de saída.</span>
                        </li>
                      </ol>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Camadas incluídas (28)</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {['AIR', 'ATP', 'APP', 'APP_LINHA_DAGUA', 'APP_NASCENTE', 'APP_RIO_ATE_10M',
                          'APP_RIO_10_A_50M', 'APP_RIO_50_A_200M', 'APP_RIO_200_A_600M', 'APP_RIO_ACIMA_600M',
                          'APP_RESERVATORIO', 'APP_TOPO_DE_MORRO', 'APP_BORDA_CHAPADA', 'APP_DECLIVIDADE',
                          'APP_MANGUEZAL', 'APP_RESTINGA', 'APP_VEREDA', 'AVN', 'AREA_CONSOLIDADA',
                          'RESERVA_LEGAL', 'AREA_POUSIO', 'USO_RESTRITO', 'AREA_TOPO_DE_MORRO',
                          'SERVIDAO_ADMINISTRATIVA', 'AREA_ALTITUDE_1800M', 'AREA_BORDA_CHAPADA',
                          'AREA_DECLIVIDADE_25_A_45', 'AREA_INFRAESTRUTURA'].map((layer) => (
                            <div key={layer} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[11px] text-slate-400 font-mono truncate" title={layer}>
                              {layer}
                            </div>
                          ))}
                      </div>
                    </div>

                    <div className="rounded-xl border border-purple-500/10 bg-purple-500/5 p-4">
                      <h4 className="text-sm font-semibold text-purple-400 mb-2 flex items-center gap-2"><Lightbulb size={14} /> Dicas</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-purple-500 mt-1 shrink-0" />Se o shapefile tiver múltiplos polígonos, eles serão unidos automaticamente (Union) antes do recorte.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-purple-500 mt-1 shrink-0" />A planilha Excel contém os quantitativos prontos para inserir em laudos e relatórios técnicos.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-purple-500 mt-1 shrink-0" />O histórico de recortes fica na barra lateral — clique para recarregar um resultado anterior.</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
                      <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Atenção</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />O ZIP deve conter ao menos os arquivos <code className="text-xs bg-white/5 px-1 rounded">.shp</code> e <code className="text-xs bg-white/5 px-1 rounded">.shx</code>. Sem o <code className="text-xs bg-white/5 px-1 rounded">.prj</code>, o sistema tentará assumir EPSG:4674.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />Se o GeoServer da SEMA estiver fora do ar, as camadas WFS ficarão vazias, mas o download será gerado mesmo assim.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />O modo fica travado por recorte: se o item foi criado em modo vetorizado, não pode ser trocado para recorte (e vice-versa).</li>
                      </ul>
                    </div>

                    <button onClick={() => onGoSimcar()} className="flex items-center gap-2 text-sm font-medium text-purple-400 hover:text-purple-300 transition-colors">
                      Ir para Recorte SIMCAR <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 3 — ANÁLISE POR IA
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-analysis" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'analysis' ? null : 'analysis')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400"><Satellite size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">3. Análise de Imagens por IA</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Visão computacional sobre imagens de satélite + polígonos do CAR</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'analysis' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'analysis' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-amber-400">O que faz</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        A análise IA valida AC/AVN e AUAS com imagens históricas e sobreposição dos shapes. No fluxo vetorizado, a plataforma executa <strong className="text-slate-300">análise completa em 1 clique</strong> e retorna um laudo integrado.
                        A saída destaca vereditos objetivos, coerência por satélite, achados temporais e recomendações operacionais.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><MousePointerClick size={14} className="text-amber-400" /> Passo a passo</h4>
                      <ol className="space-y-3 text-sm text-slate-400">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">1</span>
                          <span>Primeiro, realize o <strong className="text-slate-300">Recorte SIMCAR</strong> (seção anterior). A análise depende dos resultados do recorte.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">2</span>
                          <div>
                            <span>Selecione as <strong className="text-slate-300">imagens de satélite</strong> desejadas:</span>
                            <div className="mt-2 space-y-1.5">
                              <div className="flex items-center gap-2 pl-2"><span className="w-2 h-2 rounded-full bg-amber-400" /><span><strong className="text-slate-300">SPOT 2008</strong> — 2.5m de resolução (alta definição)</span></div>
                              <div className="flex items-center gap-2 pl-2"><span className="w-2 h-2 rounded-full bg-amber-400" /><span><strong className="text-slate-300">Landsat 5 (2007)</strong> — 30m de resolução</span></div>
                              <div className="flex items-center gap-2 pl-2"><span className="w-2 h-2 rounded-full bg-amber-400" /><span><strong className="text-slate-300">Landsat 5 (2008)</strong> — 30m de resolução</span></div>
                            </div>
                          </div>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">3</span>
                          <span>Execute <strong className="text-slate-300">"Analisar com IA"</strong> (AC/AVN) ou <strong className="text-slate-300">"Análise Completa por IA"</strong> no modo vetorizado.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">4</span>
                          <span>A IA gera vereditos estruturados (AC_FORA_SHAPE, AVN_DENTRO_SHAPE_ANTROPIZADO e status AUAS), com síntese temporal e níveis de confiança.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">5</span>
                          <span>Use o <strong className="text-slate-300">chat de follow-up</strong> (abaixo do laudo) para fazer perguntas adicionais sobre a análise.</span>
                        </li>
                      </ol>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Análise Multi-temporal (fluxo atual)</h4>
                      <p className="text-sm text-slate-400 leading-relaxed mb-3">
                        A validação AC/AVN usa conjunto técnico fixo e a AUAS usa série temporal iniciando em 2008:
                      </p>
                      <ul className="space-y-2 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#x2022;</span><strong className="text-slate-300">AC/AVN fixo:</strong> Landsat 2006, Landsat 2007, SPOT 2008 e Landsat 2008.</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#x2022;</span><strong className="text-slate-300">AUAS temporal:</strong> valida ano provável de supressão e cruza AUAS x AVN.</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#x2022;</span><strong className="text-slate-300">Contexto legal:</strong> considera marco de 22/07/2008 para interpretação técnica.</li>
                        <li className="flex items-start gap-2"><span className="text-amber-400 mt-0.5">&#x2022;</span><strong className="text-slate-300">Robustez:</strong> detecta nuvem/oclusão e marca trechos inconclusivos quando necessário.</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
                      <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><Lightbulb size={14} /> Dicas</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />Para laudos, recomenda-se usar <strong className="text-slate-300">SPOT + pelo menos 1 Landsat</strong> para combinar alta resolução com comparação temporal.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />As imagens geradas ficam salvas no Cloudinary (nuvem) e podem ser acessadas pelo histórico na barra lateral.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />Se um satélite estiver indisponível no WMS da SEMA, ele será pulado automaticamente e a análise continua com os demais.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />O laudo em Markdown pode ser copiado e colado diretamente em relatórios técnicos.</li>
                      </ul>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Legenda das sobreposições</h4>
                      <div className="flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm border-2 border-red-500 bg-transparent" /><span className="text-slate-400">Contorno vermelho = Limite da propriedade (ATP)</span></div>
                        <div className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm bg-purple-500/40 border border-purple-500" /><span className="text-slate-400">Roxo semi-transparente = Área Consolidada (AC)</span></div>
                        <div className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm bg-yellow-500/40 border border-yellow-500" /><span className="text-slate-400">Amarelo semi-transparente = Vegetação Nativa (AVN)</span></div>
                        <div className="flex items-center gap-2"><span className="w-4 h-3 rounded-sm bg-white/40 border border-white/70" /><span className="text-slate-400">Branco semi-transparente = AUAS</span></div>
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 4 — MAPA WMS
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-map" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'map' ? null : 'map')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400"><Globe size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">4. Mapa e Sensoriamento Remoto</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Visualizador de imagens WMS com interseção vetorial</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'map' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'map' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-blue-400">O que faz</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        Módulo de visualização de imagens de satélite do GeoServer da SEMA-MT via protocolo WMS.
                        Permite selecionar camadas de diferentes sensores e anos, desenhar polígonos sobre a imagem e calcular interseções com camadas vetoriais WFS.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><MousePointerClick size={14} className="text-blue-400" /> Como usar</h4>
                      <ol className="space-y-3 text-sm text-slate-400">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">1</span>
                          <span>No chat, clique no ícone de <strong className="text-slate-300">mapa</strong> (na barra de entrada) para abrir o visualizador.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">2</span>
                          <span>No painel lateral esquerdo, expanda os grupos de camadas (<strong className="text-slate-300">Landsat, Sentinel-2, SPOT, CBERS, DEM</strong>) e selecione a imagem desejada.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">3</span>
                          <span>Ajuste o <strong className="text-slate-300">bbox</strong> (coordenadas do retângulo) para enquadrar sua área de interesse, ou use o modo de zoom interativo.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">4</span>
                          <span>Ative <strong className="text-slate-300">"Camadas de Sobreposição"</strong> (WFS) para visualizar vetores sobre a imagem e calcular interseções automaticamente.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-500/15 text-blue-400 flex items-center justify-center text-xs font-bold">5</span>
                          <span>Clique em <strong className="text-slate-300">"Enviar para o Chat"</strong> para que a IA analise a imagem com contexto geográfico.</span>
                        </li>
                      </ol>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Sensores disponíveis</h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        {[
                          { sensor: 'Landsat 5 TM', res: '30m', period: '1984–2012', note: 'Séries históricas de MT' },
                          { sensor: 'Landsat 7 ETM+', res: '30m', period: '1999–presente', note: 'Gaps de SLC após 2003' },
                          { sensor: 'Landsat 8/9 OLI', res: '30m', period: '2013–presente', note: 'Qualidade radiométrica superior' },
                          { sensor: 'Sentinel-2 MSI', res: '10m', period: '2015–presente', note: 'Melhor resolução multispectral' },
                          { sensor: 'SPOT', res: '2.5m', period: '2008', note: 'Maior detalhe para análise AC' },
                          { sensor: 'CBERS-4/4A', res: '5–20m', period: '2014–presente', note: 'Satélite Brasil–China' },
                        ].map((s) => (
                          <div key={s.sensor} className="rounded-lg border border-white/5 bg-white/5 p-3">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-xs font-semibold text-slate-300">{s.sensor}</span>
                              <span className="text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded">{s.res}</span>
                            </div>
                            <p className="text-[11px] text-slate-500">{s.period} — {s.note}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 5 — NOVO CAR
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-novo-car" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'novo-car' ? null : 'novo-car')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-400"><Layers size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">5. Novo CAR (AUAS)</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Processamento temporal de AUAS com saída vetorial pronta para protocolo</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'novo-car' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'novo-car' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-amber-400">O que faz</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        O módulo <strong className="text-slate-300">Novo CAR</strong> analisa o imóvel e separa áreas em AC (pré-2008), AUAS (pós-2008), AVN/ARL e buffers de rios.
                        O resultado final é um ZIP com shapefiles prontos para auditoria técnica e continuidade do cadastro.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><MousePointerClick size={14} className="text-amber-400" /> Passo a passo</h4>
                      <ol className="space-y-3 text-sm text-slate-400">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">1</span>
                          <span>Acesse a aba <strong className="text-slate-300">Novo CAR</strong> e envie o arquivo ZIP do imóvel.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">2</span>
                          <span>Clique em <strong className="text-slate-300">Iniciar análise</strong> e acompanhe o painel em modo agente (etapas + progresso + mensagens de execução).</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">3</span>
                          <span>Revise os cards de área (Imóvel, AC, AUAS, AVN/ARL), o detalhamento por ano e o resumo final da IA.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 flex items-center justify-center text-xs font-bold">4</span>
                          <span>Baixe o ZIP final e valide atributos em SIG (QGIS/ArcGIS) antes do protocolo.</span>
                        </li>
                      </ol>
                    </div>

                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
                      <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><CheckCircle2 size={14} /> Automação de ABERTURA (AUAS)</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />A coluna <strong className="text-slate-300">ABERTURA</strong> do shape AUAS é preenchida automaticamente quando há ano detectado.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />Fonte primária: PRODES vetorial; fallback: ano extraído da análise textual de IA.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />Quando houver múltiplos anos, o sistema adota o <strong className="text-slate-300">ano mais recente</strong>.</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-blue-500/10 bg-blue-500/5 p-4">
                      <h4 className="text-sm font-semibold text-blue-400 mb-2 flex items-center gap-2"><Clock size={14} /> Persistência e histórico</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-blue-400 mt-1 shrink-0" />Jobs da aba ficam persistidos em <strong className="text-slate-300">auas_jobs</strong> para reabertura posterior.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-blue-400 mt-1 shrink-0" />Imagens de análise e ZIP final ficam disponíveis no Cloudinary para download.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-blue-400 mt-1 shrink-0" />A conversa relacionada recebe resumo técnico automático para manter rastreabilidade.</li>
                      </ul>
                    </div>

                    <button onClick={() => onGoAuas()} className="flex items-center gap-2 text-sm font-medium text-amber-400 hover:text-amber-300 transition-colors">
                      Ir para Novo CAR <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 6 — CBERS-4A / WPM
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-cbers" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'cbers' ? null : 'cbers')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-cyan-500/10 text-cyan-400"><Camera size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">6. Gerador CBERS-4A / WPM</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Fusão pancromática e geração de GeoTIFF em alta resolução (2m)</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'cbers' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'cbers' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-cyan-400">O que faz</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        A aba <strong className="text-slate-300">CBERS-4A WPM</strong> consulta o catálogo STAC oficial do INPE e realiza a fusão pancromática (pansharpening) das bandas para gerar uma imagem <strong className="text-slate-300">GeoTIFF colorida com 2 metros de resolução espacial</strong>. As imagens geradas ficam disponíveis no acervo para uso no ArcMap/QGIS e publicadas no Web Map Service (WMS) da GeoForest.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2"><MousePointerClick size={14} className="text-cyan-400" /> Passo a passo</h4>
                      <ol className="space-y-3 text-sm text-slate-400">
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs font-bold">1</span>
                          <span>Na barra lateral, selecione a aba <strong className="text-slate-300">CBERS-4A WPM</strong>.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs font-bold">2</span>
                          <span>Envie o <strong className="text-slate-300">shapefile (.zip)</strong> do imóvel ou busque diretamente por <strong className="text-slate-300">Órbita/Ponto</strong>. Utilize o filtro de datas se desejar restringir a busca.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs font-bold">3</span>
                          <span>No painel de resultados, analise as cenas disponíveis. Se enviar um shapefile, o sistema calcula automaticamente a <strong className="text-slate-300">% de Cobertura</strong>; cenas que não cobrem 100% da área ficarão bloqueadas.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs font-bold">4</span>
                          <span>Selecione as cenas desejadas e acompanhe a estimativa de download, espaço de disco e tempo. Clique em <strong className="text-slate-300">Gerar Lote</strong> para iniciar.</span>
                        </li>
                        <li className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-cyan-500/15 text-cyan-400 flex items-center justify-center text-xs font-bold">5</span>
                          <span>O servidor fará o download das bandas (0, 2, 3, 4), fusão pancromática e compressão. Ao concluir, faça o download do arquivo <strong className="text-slate-300">GeoTIFF (.tif)</strong> no histórico.</span>
                        </li>
                      </ol>
                    </div>

                    <div className="rounded-xl border border-cyan-500/10 bg-cyan-500/5 p-4">
                      <h4 className="text-sm font-semibold text-cyan-400 mb-2 flex items-center gap-2"><Globe size={14} /> Integração WMS</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-cyan-500 mt-1 shrink-0" />Os GeoTIFFs gerados são copiados automaticamente para o acervo permanente e disponibilizados no <strong>GeoServer interno</strong>.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-cyan-500 mt-1 shrink-0" />Na aba <strong className="text-slate-300">Mapa</strong>, você poderá visualizar a cena CBERS-4A como uma camada interativa junto com os dados do SIMCAR.</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
                      <h4 className="text-sm font-semibold text-amber-400 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Atenção</h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />O arquivo GeoTIFF gerado representa a <strong>folha completa</strong> da Órbita/Ponto do INPE; ele <strong>não é recortado</strong> pela geometria da propriedade para manter a integridade visual da cena.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-amber-500 mt-1 shrink-0" />Cenas em lote são baixadas em um único arquivo `.zip`.</li>
                      </ul>
                    </div>

                    <button onClick={() => onGoCbers()} className="flex items-center gap-2 text-sm font-medium text-cyan-400 hover:text-cyan-300 transition-colors">
                      Ir para Gerador CBERS-4A <ArrowRight size={14} />
                    </button>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 7 — CRÉDITOS E COBRANÇA
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-billing" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'billing' ? null : 'billing')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400"><Wallet size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">7. Créditos e Cobrança por Uso</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Saldo, recarga, extrato, consumo por modelo e bloqueio por saldo insuficiente</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'billing' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'billing' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-emerald-400">Como funciona</span></h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        A plataforma utiliza cobrança por uso real. Cada execução de IA gera débito proporcional ao consumo de modelo/tokens e operações de processamento.
                        O painel em Configurações mostra saldo atual, gasto diário, custo médio, extrato e consumo por modelo.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="rounded-xl border border-emerald-500/10 bg-emerald-500/5 p-4">
                        <h4 className="text-sm font-semibold text-emerald-300 mb-1">Recarga manual</h4>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Use o botão <strong className="text-slate-300">Adicionar créditos</strong> para inserir valor em BRL e atualizar sua carteira.
                        </p>
                      </div>
                      <div className="rounded-xl border border-amber-500/10 bg-amber-500/5 p-4">
                        <h4 className="text-sm font-semibold text-amber-300 mb-1">Saldo insuficiente</h4>
                        <p className="text-sm text-slate-400 leading-relaxed">
                          Ao tentar enviar mensagem sem saldo, o sistema exibe aviso imediato e redireciona para a aba de recarga, sem aguardar resposta da IA.
                        </p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3">Tipos de movimentação no extrato</h4>
                      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                        {[
                          'topup_manual (recarga)',
                          'usage_debit (uso de IA)',
                          'reserve_hold (reserva temporária)',
                          'reserve_release (liberação)',
                          'refund (estorno)',
                        ].map((item) => (
                          <div key={item} className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[11px] text-slate-400 font-mono">
                            {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 8 — SEGURANÇA, CONTA E TERMOS
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-security" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'security' ? null : 'security')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-red-500/10 text-red-400"><ShieldCheck size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">8. Segurança, Conta e Termos de Uso</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Controle de acesso, recuperação de senha e conformidade de uso</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'security' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'security' && (
                  <div className="px-4 sm:px-6 pb-4 sm:pb-6 space-y-4 sm:space-y-6 border-t border-white/5 pt-4 sm:pt-5">
                    <div>
                      <h4 className="text-sm font-semibold text-slate-300 mb-3"><span className="text-red-400">Pilares de segurança</span></h4>
                      <ul className="space-y-1.5 text-sm text-slate-400">
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-red-400 mt-1 shrink-0" />Login via Firebase Auth, com validação de perfil em Firestore após autenticação.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-red-400 mt-1 shrink-0" />Conta sem cadastro ativo em Firestore é automaticamente desconectada.</li>
                        <li className="flex items-start gap-2"><ArrowRight size={12} className="text-red-400 mt-1 shrink-0" />Redefinição de senha disponível para contas com provedor Email/Senha.</li>
                      </ul>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <h4 className="text-sm font-semibold text-slate-200 mb-1">Alterar senha</h4>
                        <p className="text-sm text-slate-400">Envio de e-mail de redefinição pela aba Configurações.</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <h4 className="text-sm font-semibold text-slate-200 mb-1">Sair da conta</h4>
                        <p className="text-sm text-slate-400">Logout disponível no rodapé da barra lateral com estado de carregamento.</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                        <h4 className="text-sm font-semibold text-slate-200 mb-1">Termos de uso</h4>
                        <p className="text-sm text-slate-400">Acesso na tela de cadastro e na aba Configurações.</p>
                      </div>
                    </div>

                    <div className="rounded-xl border border-red-500/10 bg-red-500/5 p-4">
                      <h4 className="text-sm font-semibold text-red-400 mb-2 flex items-center gap-2"><AlertTriangle size={14} /> Conformidade técnica</h4>
                      <p className="text-sm text-slate-400 leading-relaxed">
                        As respostas da IA têm caráter de apoio técnico. Sempre valide resultados com o responsável técnico antes de emissão de laudo, protocolo ou decisão jurídica.
                      </p>
                    </div>
                  </div>
                )}
              </section>

              {/* ═══════════════════════════════════════════════════════════════
                   SECTION 9 — FAQ
                 ═══════════════════════════════════════════════════════════════ */}
              <section id="manual-faq" className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl overflow-hidden">
                <button
                  onClick={() => setManualSection(manualSection === 'faq' ? null : 'faq')}
                  className="w-full flex items-center justify-between p-4 sm:p-6 text-left hover:bg-white/5 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2.5 rounded-xl bg-slate-500/10 text-slate-400"><HelpCircle size={22} /></div>
                    <div>
                      <h2 className="font-semibold text-lg text-slate-200">9. Perguntas Frequentes</h2>
                      <p className="text-xs text-slate-500 mt-0.5">Dúvidas comuns sobre a plataforma</p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`text-slate-500 transition-transform duration-200 ${manualSection === 'faq' ? 'rotate-180' : ''}`} />
                </button>
                {manualSection === 'faq' && (
                  <div className="px-6 pb-6 space-y-5 border-t border-white/5 pt-5">
                    {[
                      {
                        q: 'Que formato de shapefile devo usar no upload?',
                        a: 'Um arquivo .zip contendo no mínimo .shp e .shx. Recomendamos incluir o .prj para que a projeção seja detectada automaticamente. Se o .prj estiver ausente, o sistema assume SIRGAS 2000 (EPSG:4674). Projeções UTM são reprojetadas automaticamente.',
                      },
                      {
                        q: 'Posso usar shapefiles com múltiplos polígonos?',
                        a: 'Sim. Se o shapefile contiver múltiplos polígonos, eles serão unidos automaticamente (Union) antes de realizar o recorte. O resultado final considera a geometria combinada.',
                      },
                      {
                        q: 'Quanto tempo leva o processamento do recorte?',
                        a: 'Entre 15 e 60 segundos, dependendo do tamanho do imóvel e da disponibilidade do GeoServer da SEMA. Propriedades muito grandes (>50.000 ha) podem levar mais tempo por causa da paginação WFS.',
                      },
                      {
                        q: 'O que acontece se o GeoServer da SEMA estiver fora do ar?',
                        a: 'As camadas WFS ficarão sem dados (0 feições), mas o ZIP será gerado normalmente com os shapefiles vazios. As camadas AIR e ATP (que copiam o polígono do imóvel) são geradas localmente e sempre funcionam.',
                      },
                      {
                        q: 'Posso analisar imagens de satélite sem fazer o recorte primeiro?',
                        a: 'Sim, no modo Vetorizado com IA. Nesse modo você envia um ZIP já vetorizado (com os shapes) e executa a análise completa sem recorte WFS.',
                      },
                      {
                        q: 'Como funciona a geração de imagem CBERS-4A?',
                        a: 'A ferramenta baixa as bandas vermelha, verde, azul e pancromática (resolução de 2m) diretamente do catálogo STAC do INPE, e executa uma fusão (pansharpening) no servidor, gerando um GeoTIFF colorido para uso no ArcMap/QGIS.',
                      },
                      {
                        q: 'Por que o GeoTIFF do CBERS não vem recortado pela minha propriedade?',
                        a: 'Para preservar a integridade visual da cena e viabilizar a reutilização por múltiplos analistas, a plataforma gera a folha completa original. O recorte e as composições devem ser feitos no software SIG de sua preferência.',
                      },
                      {
                        q: 'Por que a análise com múltiplos satélites pode falhar?',
                        a: 'Falhas normalmente ocorrem por indisponibilidade WMS, limite de API ou cena com baixa qualidade (nuvem/oclusão). O sistema aplica fallback de modelos e continua com os satélites válidos quando possível.',
                      },
                      {
                        q: 'Por que não consigo trocar o modo de um recorte já aberto?',
                        a: 'Cada recorte fica vinculado ao modo em que foi criado (Recorte Automático ou Vetorizado). Para evitar inconsistência de pipeline, a troca de modo é bloqueada no item ativo. Use "Novo Recorte" para iniciar no outro modo.',
                      },
                      {
                        q: 'Como funciona o consumo de créditos nessas análises?',
                        a: 'O consumo é por uso real: modelos/tokens de IA e operações de armazenamento associadas ao fluxo. O detalhe aparece no extrato da aba Configurações.',
                      },
                      {
                        q: 'As respostas da IA são confiáveis para laudos oficiais?',
                        a: 'A IA é uma ferramenta de apoio. As respostas são baseadas na legislação e nas imagens, mas devem ser validadas pelo profissional responsável. A IA sempre indica o nível de confiança (Alta/Média/Baixa) e recomenda vistoria em campo quando necessário.',
                      },
                      {
                        q: 'Meus dados ficam armazenados?',
                        a: 'As conversas ficam no Firestore (vinculadas à sua conta). Os shapefiles enviados e as imagens de análise ficam no Cloudinary. Ao excluir um recorte pela barra lateral, os dados são removidos do Cloudinary e do cache do servidor.',
                      },
                      {
                        q: 'O que acontece se eu tentar usar a IA sem créditos?',
                        a: 'A interface bloqueia o envio imediatamente, exibe alerta de saldo insuficiente e redireciona para Configurações com a recarga aberta.',
                      },
                      {
                        q: 'O Novo CAR preenche automaticamente o campo ABERTURA do AUAS?',
                        a: 'Sim, quando há ano detectável. A prioridade é PRODES vetorial; se necessário, usa fallback por extração textual da análise. Em múltiplos anos, utiliza o mais recente.',
                      },
                      {
                        q: 'Onde encontro os Termos de Uso da plataforma?',
                        a: 'Os Termos de Uso podem ser visualizados na tela de cadastro e também na aba Configurações após login.',
                      },
                    ].map((item, i) => (
                      <div key={i} className="rounded-xl border border-white/5 bg-white/5 p-4">
                        <h4 className="text-sm font-semibold text-slate-200 mb-2 flex items-start gap-2">
                          <HelpCircle size={14} className="text-emerald-400 mt-0.5 shrink-0" />
                          {item.q}
                        </h4>
                        <p className="text-sm text-slate-400 leading-relaxed pl-6">{item.a}</p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ═══ Stack Técnico ═══ */}
              <section className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-5">
                  <div className="p-2.5 rounded-xl bg-slate-500/10 text-slate-400"><Cpu size={22} /></div>
                  <h3 className="font-semibold text-lg text-slate-200">Stack Tecnológico</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3">
                  {[
                    { label: 'Frontend', value: 'React 19 + Vite + Tailwind' },
                    { label: 'Backend', value: 'Node.js + Express + TypeScript' },
                    { label: 'IA / Vision', value: 'Gemini 3 Pro (primário) + Groq (fallback)' },
                    { label: 'Auth', value: 'Firebase Auth + Firestore' },
                    { label: 'Geoespacial', value: 'Turf.js + Proj4 + WFS/WMS' },
                    { label: 'Imagens', value: 'Sharp + Cloudinary' },
                    { label: 'Deploy', value: 'Render (backend) + Vite (front)' },
                    { label: 'GeoServer', value: 'SEMA-MT (geo.sema.mt.gov.br)' },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">{item.label}</p>
                      <p className="text-xs text-slate-300">{item.value}</p>
                    </div>
                  ))}
                </div>
              </section>

            </div>
          </div>
  );
}
