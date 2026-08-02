/**
 * Hook de AÇÕES do fluxo de análise SIMCAR (Passo 11, plano 03).
 *
 * Encapsula os 4 callbacks monólitos que ficavam no Dashboard:
 *   - sendSimcarFollowUpMessage
 *   - runAcAvnAnalysis
 *   - runAuasAnalysis
 *   - runVectorizedCompleteAnalysis
 *
 * Padrão useSimcarClipActions: deps injetadas via argumento. O estado de análise
 * (useSimcarAnalysis) é passado como UMA dep (`analysis`) e desestruturado aqui —
 * o Dashboard NÃO deve chamar useSimcarAnalysis() separadamente (estado duplicado).
 *
 * Corpo dos callbacks 100% verbatim (zero mudança funcional) — extraído em 01/08.
 */
import { useCallback } from 'react';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';
import type { BillingResult } from '@/dashboard/types';
import type {
  SimcarAcAvnAnalysisMeta,
  SimcarAnalysisImage,
  SimcarAnalysisMessage,
  SimcarAuasMeta,
  SimcarClipHistoryItem,
  SimcarClipSummary,
  SimcarConversationEntry,
} from '@/dashboard/types/history';
import { useSimcarAnalysis } from './useSimcarAnalysis';
import {
  buildIntegratedVectorizedReport,
  isPlainObject,
  normalizeBackendText,
  resolveBackendDownloadUrl,
} from '@/dashboard/lib/format';
import {
  normalizeSimcarClipSummary,
  normalizeSimcarReportPatch,
} from '@/dashboard/lib/normalizers-simcar';
import { splitThinkContent, readFileAsBase64Payload } from '@/dashboard/lib/analysis-helpers';

export type UseSimcarAnalysisFlowDeps = {
  /** Estado + setters + refs de análise (retorno de useSimcarAnalysis) */
  analysis: ReturnType<typeof useSimcarAnalysis>;
  apiFetch: (path: string, init?: RequestInit) => Promise<Response>;
  readApiError: (response: Response) => Promise<any>;
  handleInsufficientCredits: (message?: string) => void;
  applyBillingToWallet: (billing?: BillingResult | null) => void;
  appendSimcarEntriesToConversation: (
    clip: SimcarClipHistoryItem,
    entries: SimcarConversationEntry[],
    options?: { title?: string }
  ) => Promise<unknown> | unknown;
  patchPersistedSimcarClip: (jobId: string, patch: Partial<SimcarClipHistoryItem>) => Promise<void>;
  persistSimcarClipHistoryEntry: (entry: SimcarClipHistoryItem) => Promise<void>;
  // estado do clip (useSimcarClipJobs)
  simcarClipFile: File | null;
  simcarClipJobId: string | null;
  simcarClipHistory: SimcarClipHistoryItem[];
  simcarFixedSatelliteKeys: string[];
  setSimcarClipHistory: React.Dispatch<React.SetStateAction<SimcarClipHistoryItem[]>>;
  setSimcarClipError: (error: string | null) => void;
  setSimcarClipDownloadUrl: (url: string | null) => void;
  setSimcarClipSummary: (summary: SimcarClipSummary | null) => void;
  setSimcarClipJobId: (jobId: string | null) => void;
  setSimcarVectorizedRunning: (running: boolean) => void;
  setSimcarVectorizedStatus: React.Dispatch<
    React.SetStateAction<{
      stage: 'importing' | 'acavn' | 'auas' | 'done' | 'error';
      message: string;
    } | null>
  >;
  // estado local do Dashboard (unified progress bar)
  setSimcarUnifiedProgressDisplay: (value: number | ((prev: number) => number)) => void;
};

export function useSimcarAnalysisFlow(deps: UseSimcarAnalysisFlowDeps) {
  const {
    analysis,
    apiFetch,
    readApiError,
    handleInsufficientCredits,
    applyBillingToWallet,
    appendSimcarEntriesToConversation,
    patchPersistedSimcarClip,
    persistSimcarClipHistoryEntry,
    simcarClipFile,
    simcarClipJobId,
    simcarClipHistory,
    simcarFixedSatelliteKeys,
    setSimcarClipHistory,
    setSimcarClipError,
    setSimcarClipDownloadUrl,
    setSimcarClipSummary,
    setSimcarClipJobId,
    setSimcarVectorizedRunning,
    setSimcarVectorizedStatus,
    setSimcarUnifiedProgressDisplay,
  } = deps;

  const {
    simcarAnalysisMessages,
    simcarAuasMessages,
    simcarAuasImages,
    setSimcarAnalysisProcessing,
    setSimcarAnalysisProgress,
    setSimcarAgentLog,
    setSimcarAnalysisImages,
    setSimcarAnalysisMessages,
    setSimcarThinkingText,
    setSimcarThinkingHidden,
    setSimcarAnalysisSending,
    setSimcarLiveThinkingText,
    setSimcarLiveAnswerText,
    setSimcarAuasProcessing,
    setSimcarAuasProgress,
    setSimcarAuasImages,
    setSimcarAuasMessages,
    setSimcarAuasAgentLog,
    setSimcarResultImagePanelsOpen,
    simcarAnalysisChatRef,
    simcarAnalysisAbortRef,
    simcarAnalysisProcessJobIdRef,
    simcarAuasAbortRef,
    simcarAuasProcessJobIdRef,
  } = analysis;

  const appendSimcarThinking = useCallback((nextChunk: string) => {
    const normalized = String(nextChunk || '').trim();
    if (!normalized) return;
    setSimcarThinkingText((prev) => {
      const current = prev.trim();
      if (!current) return normalized;
      const lines = current.split('\n');
      const lastLine = (lines[lines.length - 1] || '').trim();
      if (lastLine === normalized) return current;
      if (current.includes(normalized)) return current;
      return `${current}\n${normalized}`;
    });
  }, []);

  const sendSimcarFollowUpMessage = useCallback(async (userMsg: string) => {
    const baseMessages = simcarAnalysisMessages;
    const activeClip = simcarClipJobId
      ? simcarClipHistory.find((clip) => clip.jobId === simcarClipJobId)
      : undefined;
    setSimcarAnalysisMessages((prev) => [...prev, { role: 'user', text: userMsg }]);
    setSimcarAnalysisSending(true);
    setSimcarLiveThinkingText('');
    setSimcarLiveAnswerText('');
    setSimcarThinkingHidden(false);

    try {
      const chatMessages = baseMessages.map((m) => ({
        role: m.role === 'ai' ? 'assistant' : 'user',
        content: m.text,
      }));
      chatMessages.push({ role: 'user', content: userMsg });

      const response = await apiFetch('/api/simcar/clip/analyze/chat?stream=1', {
        method: 'POST',
        body: JSON.stringify({ messages: chatMessages }),
      });

      if (!response.ok) {
        const payload = await readApiError(response);
        if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
          handleInsufficientCredits(payload?.error);
          return;
        }
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const contentType = String(response.headers.get('content-type') || '').toLowerCase();
      if (contentType.includes('application/json')) {
        const data = await response.json().catch(() => ({}));
        if (data?.billing) {
          applyBillingToWallet(data.billing as BillingResult);
        }
        const parsed = splitThinkContent(String(data?.content || data?.error || 'Sem resposta.'));
        const aiMsg: SimcarAnalysisMessage = {
          role: 'ai',
          text: parsed.cleanText,
          thinkingText: parsed.thinkingText || undefined,
        };
        if (parsed.thinkingText) {
          setSimcarThinkingText(parsed.thinkingText);
        }
        setSimcarAnalysisMessages((prev) => [...prev, aiMsg]);
        if (simcarClipJobId) {
          const nextHistory = [...baseMessages, { role: 'user' as const, text: userMsg }, aiMsg];
          void patchPersistedSimcarClip(simcarClipJobId, { analysisMessages: nextHistory });
          if (activeClip) {
            void appendSimcarEntriesToConversation(activeClip, [
              { role: 'user', text: userMsg },
              { role: 'ai', text: aiMsg.text },
            ]);
          }
        }
        return;
      }

      if (!response.body) {
        throw new Error('Resposta sem stream.');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let streamAnswer = '';
      let streamThinking = '';
      let completedContent = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload) continue;
          let event: any;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          if (event.type === 'delta') {
            streamAnswer = String(event.answerText || streamAnswer || '');
            streamThinking = String(event.thinkingText || streamThinking || '');
            setSimcarLiveAnswerText(streamAnswer);
            setSimcarLiveThinkingText(streamThinking);
            if (streamThinking.trim()) {
              setSimcarThinkingText(streamThinking.trim());
            }
          } else if (event.type === 'complete') {
            completedContent = String(event.content || '');
            streamAnswer = String(event.answerText || streamAnswer || '');
            streamThinking = String(event.thinkingText || streamThinking || '');
            setSimcarLiveAnswerText(streamAnswer);
            setSimcarLiveThinkingText(streamThinking);
            if (streamThinking.trim()) {
              setSimcarThinkingText(streamThinking.trim());
            }
          } else if (event.type === 'billing' && event.billing) {
            applyBillingToWallet(event.billing as BillingResult);
          } else if (event.type === 'error') {
            throw new Error(String(event.message || 'Erro no stream de análise.'));
          }
        }
      }

      const rawContent = completedContent
        || (streamThinking.trim()
          ? `<think>\n${streamThinking.trim()}\n</think>\n\n${streamAnswer}`
          : streamAnswer || 'Sem resposta.');
      const parsed = splitThinkContent(String(rawContent));
      const aiMsg: SimcarAnalysisMessage = {
        role: 'ai',
        text: parsed.cleanText,
        thinkingText: parsed.thinkingText || undefined,
      };

      if (parsed.thinkingText) {
        setSimcarThinkingText(parsed.thinkingText);
      }
      setSimcarAnalysisMessages((prev) => [...prev, aiMsg]);

      if (simcarClipJobId) {
        const nextHistory = [...baseMessages, { role: 'user' as const, text: userMsg }, aiMsg];
        void patchPersistedSimcarClip(simcarClipJobId, { analysisMessages: nextHistory });
        if (activeClip) {
          void appendSimcarEntriesToConversation(activeClip, [
            { role: 'user', text: userMsg },
            { role: 'ai', text: aiMsg.text },
          ]);
        }
      }
    } catch (err: any) {
      const aiText = `❌ ${err.message || 'Erro ao processar resposta.'}`;
      setSimcarAnalysisMessages((prev) => [...prev, { role: 'ai', text: aiText }]);
      if (simcarClipJobId) {
        const nextHistory = [
          ...baseMessages,
          { role: 'user' as const, text: userMsg },
          { role: 'ai' as const, text: aiText },
        ];
        void patchPersistedSimcarClip(simcarClipJobId, { analysisMessages: nextHistory });
        if (activeClip) {
          void appendSimcarEntriesToConversation(activeClip, [
            { role: 'user', text: userMsg },
            { role: 'ai', text: aiText },
          ]);
        }
      }
    } finally {
      setSimcarAnalysisSending(false);
      setSimcarLiveThinkingText('');
      setSimcarLiveAnswerText('');
      setTimeout(() => {
        simcarAnalysisChatRef.current?.scrollTo({ top: simcarAnalysisChatRef.current.scrollHeight, behavior: 'smooth' });
      }, 100);
    }
  }, [
    apiFetch,
    readApiError,
    handleInsufficientCredits,
    applyBillingToWallet,
    simcarAnalysisMessages,
    splitThinkContent,
    simcarClipJobId,
    simcarClipHistory,
    patchPersistedSimcarClip,
    appendSimcarEntriesToConversation,
    simcarAnalysisChatRef,
  ]);

  const runAcAvnAnalysis = useCallback(
    async (params: {
      jobId: string;
      historyEntry?: SimcarClipHistoryItem;
      layers?: string[];
      imageOnly?: boolean;
      silentOutput?: boolean;
      skipConversation?: boolean;
    }): Promise<{
      ok: boolean;
      aiMessage?: SimcarAnalysisMessage;
      analysisMeta?: SimcarAcAvnAnalysisMeta;
      images: Array<{ url: string; caption: string }>;
      error?: string;
    }> => {
      const { jobId, imageOnly = false } = params;
      const silentOutput = Boolean(params.silentOutput);
      const skipConversation = Boolean(params.skipConversation);
      const layers = Array.isArray(params.layers) && params.layers.length > 0
        ? params.layers
        : simcarFixedSatelliteKeys;
      const historyEntry = params.historyEntry || simcarClipHistory.find((c) => c.jobId === jobId);
      const result: {
        ok: boolean;
        aiMessage?: SimcarAnalysisMessage;
        analysisMeta?: SimcarAcAvnAnalysisMeta;
        images: Array<{ url: string; caption: string }>;
        error?: string;
      } = { ok: false, images: [] };

      setSimcarAnalysisProcessing(true);
      setSimcarAnalysisProgress({
        step: 'starting',
        percent: 0,
        message: imageOnly ? 'Gerando imagens...' : 'Iniciando analise...',
      });
      if (!silentOutput) setSimcarAnalysisImages([]);
      if (!imageOnly && !silentOutput) {
        setSimcarAgentLog([{ label: 'Iniciando analise...', done: false, kind: 'step' }]);
        setSimcarAnalysisMessages([]);
        setSimcarThinkingText('');
        setSimcarThinkingHidden(false);
        setSimcarLiveThinkingText('');
        setSimcarLiveAnswerText('');
      }

      try {
        const controller = new AbortController();
        simcarAnalysisAbortRef.current = controller;
        simcarAnalysisProcessJobIdRef.current = null;
        const response = await apiFetch('/api/simcar/clip/analyze', {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            selectedLayers: layers,
            imageOnly: imageOnly || undefined,
            contextUrl: historyEntry?.contextUrl,
            outputZipUrl: historyEntry?.outputZipUrl,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await readApiError(response);
          if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
            handleInsufficientCredits(payload?.error);
            return { ...result, error: payload?.error || 'Saldo insuficiente.' };
          }
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let insufficientCredits = false;
        let streamError = '';

        if (reader) {
          readLoop: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'job_started') {
                  const streamJobId = typeof event.jobId === 'string' ? event.jobId.trim() : '';
                  if (streamJobId) simcarAnalysisProcessJobIdRef.current = streamJobId;
                } else if (event.type === 'progress') {
                  const msg = normalizeBackendText(String(event.message || ''));
                  setSimcarAnalysisProgress({ step: event.step, percent: event.percent, message: msg });
                  if (!imageOnly && !silentOutput) {
                    setSimcarAgentLog((prev) => {
                      const updated = prev.map((s) => (s.done ? s : { ...s, done: true }));
                      return [...updated, { label: msg, done: false, kind: 'step' as const }];
                    });
                  }
                } else if (event.type === 'model_thinking' && !imageOnly && !silentOutput) {
                  const source = event.source ? `[${event.source}]` : '';
                  const thought = String(event.thinkingText || '').trim();
                  if (thought) {
                    appendSimcarThinking(source ? `${source}\n${thought}` : thought);
                    setSimcarThinkingHidden(false);
                    const snippet = thought.replace(/\s+/g, ' ').slice(0, 120);
                    const label = source ? `${source}: ${snippet}…` : `${snippet}…`;
                    setSimcarAgentLog((prev) => [...prev, { label, done: true, kind: 'thinking' as const }]);
                  }
                } else if (event.type === 'complete') {
                  const images = (Array.isArray(event.images) ? event.images : [])
                    .map((img: any) => ({
                      url: String(img?.url || ''),
                      caption: String(img?.caption || ''),
                    }))
                    .filter((img: { url: string; caption: string }) => img.url.length > 0);
                  const analysisMeta = isPlainObject(event.analysisMeta)
                    ? (event.analysisMeta as SimcarAcAvnAnalysisMeta)
                    : undefined;
                  result.images = images;
                  result.analysisMeta = analysisMeta;

	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    analysisImages: images,
	                    analysisMeta,
	                    ...(historyEntry?.sourceMode === 'vectorized-analysis'
	                      ? {}
	                      : { status: 'completed' as const, error: undefined }),
	                    ...normalizeSimcarReportPatch(event),
	                  };
                  let aiMessage: SimcarAnalysisMessage | undefined;
                  if (!imageOnly) {
                    const parsed = splitThinkContent(String(event.analysis || ''));
                    if (parsed.thinkingText) {
                      appendSimcarThinking(parsed.thinkingText);
                    }
                    aiMessage = {
                      role: 'ai',
                      text: parsed.cleanText,
                      thinkingText: parsed.thinkingText || undefined,
                      images: images.map((img: { url: string; caption: string }) => img.url),
                    };
                    patch.analysisMessages = [aiMessage];
                    result.aiMessage = aiMessage;
                    if (!silentOutput) {
                      setSimcarAnalysisMessages([aiMessage]);
                      setSimcarAgentLog((prev) => prev.map((s) => ({ ...s, done: true })));
                    }
                  }

                  if (!silentOutput) {
                    setSimcarAnalysisImages(images);
                  }
                  setSimcarAnalysisProgress({
                    step: 'complete',
                    percent: 100,
                    message: imageOnly ? 'Imagens geradas. Finalizando...' : 'Análise concluída. Finalizando...',
                  });
                  setSimcarClipHistory((prev) =>
                    prev.map((c) =>
                      c.jobId === jobId
                        ? {
                          ...c,
                          ...patch,
                        }
                        : c
                    )
                  );
                  void patchPersistedSimcarClip(jobId, patch);

                  const clipBase: SimcarClipHistoryItem = historyEntry
                    ? historyEntry
                    : {
                      id: jobId,
                      timestamp: new Date().toISOString(),
                      filename: `Recorte ${jobId.slice(0, 8)}`,
                      downloadUrl: '',
                      totalFeatures: 0,
                      propertyAreaHa: 0,
                      layersWithData: 0,
                      totalLayers: 0,
                      jobId,
                    };
                  const clipForConversation: SimcarClipHistoryItem = {
                    ...clipBase,
                    ...patch,
                  };
                  const imageLinks = images.map((img: { url: string; caption: string }) => `- ${img.url}`);
                  if (!skipConversation && imageOnly) {
                    void appendSimcarEntriesToConversation(clipForConversation, [
                      {
                        role: 'user',
                        text: `Solicitei apenas a geração de imagens para o recorte ${jobId} com as camadas: ${layers.join(', ')}.`,
                      },
                      {
                        role: 'ai',
                        text: [
                          `Imagens geradas para o recorte ${jobId}.`,
                          imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      },
                    ]);
                  } else if (!skipConversation && aiMessage) {
                    void appendSimcarEntriesToConversation(clipForConversation, [
                      {
                        role: 'user',
                        text: `Solicitei análise AC/AVN para o recorte ${jobId} com as imagens: ${layers.join(', ')}.`,
                      },
                      {
                        role: 'ai',
                        text: [
                          `Análise AC/AVN concluída para o recorte ${jobId}.`,
                          imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
                          aiMessage.text,
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      },
                    ]);
                  }

                  result.ok = true;
	                } else if (event.type === 'report_error') {
	                  const message = String(event.message || 'Falha ao gerar PDF técnico.');
	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    reportPdfStatus: 'failed',
	                    reportPdfError: message,
	                  };
	                  setSimcarClipHistory((prev) =>
	                    prev.map((c) => (c.jobId === jobId ? { ...c, ...patch } : c))
	                  );
	                  void patchPersistedSimcarClip(jobId, patch);
	                } else if (event.type === 'billing' && event.billing) {
                  applyBillingToWallet(event.billing as BillingResult);
                } else if (event.type === 'error') {
                  if (event?.code === 'INSUFFICIENT_CREDITS') {
                    handleInsufficientCredits(String(event.message || 'Saldo insuficiente.'));
                    insufficientCredits = true;
                    break readLoop;
                  }
                  streamError = normalizeBackendText(String(event.message || 'Erro inesperado na analise.'));
                  break readLoop;
                }
              } catch {
                // ignore malformed SSE chunk
              }
            }
          }
        }

        if (insufficientCredits) {
          return { ...result, ok: false, error: 'Saldo insuficiente.' };
        }
        if (streamError) {
          throw new Error(streamError);
        }
        if (!result.ok) {
          throw new Error(imageOnly ? 'Falha ao gerar imagens.' : 'Falha ao concluir analise AC/AVN.');
        }
        return result;
      } catch (err: any) {
        const message = String(err?.message || (imageOnly ? 'Erro ao gerar imagens.' : 'Erro inesperado.'));
        if (!imageOnly && !silentOutput) {
          setSimcarAnalysisMessages([{ role: 'ai', text: `❌ ${message}` }]);
          if (historyEntry && !skipConversation) {
            void appendSimcarEntriesToConversation(historyEntry, [
              {
                role: 'user',
                text: `Solicitei análise AC/AVN para o recorte ${jobId} com as imagens: ${layers.join(', ')}.`,
              },
              { role: 'ai', text: `❌ ${message}` },
            ]);
          }
        } else {
          setSimcarClipError(message);
          if (historyEntry && !skipConversation) {
            void appendSimcarEntriesToConversation(historyEntry, [
              {
                role: 'user',
                text: `Solicitei apenas a geração de imagens para o recorte ${jobId} com as camadas: ${layers.join(', ')}.`,
              },
              { role: 'ai', text: `❌ ${message}` },
            ]);
          }
        }
        return { ...result, ok: false, error: message };
      } finally {
        simcarAnalysisAbortRef.current = null;
        simcarAnalysisProcessJobIdRef.current = null;
        setSimcarAnalysisProcessing(false);
        setSimcarAnalysisProgress(null);
      }
    },
    [
      apiFetch,
      appendSimcarEntriesToConversation,
      appendSimcarThinking,
      applyBillingToWallet,
      handleInsufficientCredits,
      normalizeSimcarReportPatch,
      patchPersistedSimcarClip,
      readApiError,
      simcarClipHistory,
      simcarFixedSatelliteKeys,
      splitThinkContent,
    ]
  );

  const runAuasAnalysis = useCallback(
    async (params: {
      jobId: string;
      historyEntry?: SimcarClipHistoryItem;
      previousAnalysis?: string;
      acAvnMeta?: SimcarAcAvnAnalysisMeta;
      prependContextText?: string;
      skipConversation?: boolean;
    }): Promise<{
      ok: boolean;
      aiMessage?: SimcarAnalysisMessage;
      auasMeta?: SimcarAuasMeta;
      images: Array<{ url: string; caption: string }>;
      error?: string;
    }> => {
      const { jobId } = params;
      const historyEntry = params.historyEntry || simcarClipHistory.find((c) => c.jobId === jobId);
      const prependContextText = String(params.prependContextText || '').trim();
      const skipConversation = Boolean(params.skipConversation);
      const previousAnalysis = String(
        params.previousAnalysis
        || simcarAnalysisMessages
          .filter((m) => m.role === 'ai')
          .map((m) => m.text)
          .join('\n\n---\n\n')
      );
      const acAvnMeta = params.acAvnMeta || historyEntry?.analysisMeta;
      const result: {
        ok: boolean;
        aiMessage?: SimcarAnalysisMessage;
        auasMeta?: SimcarAuasMeta;
        images: Array<{ url: string; caption: string }>;
        error?: string;
      } = { ok: false, images: [] };

      setSimcarAuasProcessing(true);
      setSimcarAuasProgress({ step: 'starting', percent: 0, message: 'Iniciando análise de AUAS...' });
      setSimcarAuasAgentLog([{ label: 'Iniciando análise AUAS...', done: false, kind: 'step' }]);
      setSimcarAuasImages([]);
      setSimcarAuasMessages([]);

      try {
        const controller = new AbortController();
        simcarAuasAbortRef.current = controller;
        simcarAuasProcessJobIdRef.current = null;
        const response = await apiFetch('/api/simcar/clip/analyze-auas', {
          method: 'POST',
          body: JSON.stringify({
            jobId,
            previousAnalysis,
            acAvnMeta: acAvnMeta || undefined,
            contextUrl: historyEntry?.contextUrl,
            outputZipUrl: historyEntry?.outputZipUrl,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          const payload = await readApiError(response);
          if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
            handleInsufficientCredits(payload?.error);
            return { ...result, error: payload?.error || 'Saldo insuficiente.' };
          }
          throw new Error(payload?.error || `HTTP ${response.status}`);
        }

        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let insufficientCredits = false;
        let streamError = '';

        if (reader) {
          readLoop: while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              try {
                const event = JSON.parse(line.slice(6));
                if (event.type === 'job_started') {
                  const streamJobId = typeof event.jobId === 'string' ? event.jobId.trim() : '';
                  if (streamJobId) simcarAuasProcessJobIdRef.current = streamJobId;
                } else if (event.type === 'progress') {
                  const msg = normalizeBackendText(String(event.message || ''));
                  setSimcarAuasProgress({ step: event.step, percent: event.percent, message: msg });
                  setSimcarAuasAgentLog((prev) => {
                    const updated = prev.map((s) => (s.done ? s : { ...s, done: true }));
                    return [...updated, { label: msg, done: false, kind: 'step' as const }];
                  });
                } else if (event.type === 'model_thinking') {
                  const source = event.source ? `[${event.source}]` : '';
                  const thought = String(event.thinkingText || '').trim();
                  if (thought) {
                    const snippet = thought.replace(/\s+/g, ' ').slice(0, 120);
                    const label = source ? `${source}: ${snippet}…` : `${snippet}…`;
                    setSimcarAuasAgentLog((prev) => [...prev, { label, done: true, kind: 'thinking' as const }]);
                  }
                } else if (event.type === 'complete') {
                  const images = (Array.isArray(event.images) ? event.images : [])
                    .map((img: any) => ({
                      url: String(img?.url || ''),
                      caption: String(img?.caption || ''),
                    }))
                    .filter((img: { url: string; caption: string }) => img.url.length > 0);
                  const auasMeta = isPlainObject(event.auasMeta)
                    ? (event.auasMeta as SimcarAuasMeta)
                    : undefined;
                  const parsed = splitThinkContent(String(event.analysis || ''));
                  const combinedText = prependContextText
                    ? [
                      '## Analise Integrada SIMCAR (AC/AVN + AUAS)',
                      '',
                      '## Achados AC e AVN',
                      prependContextText,
                      '',
                      '## Achados AUAS',
                      parsed.cleanText,
                    ].join('\n')
                    : parsed.cleanText;
                  const aiMessage: SimcarAnalysisMessage = {
                    role: 'ai',
                    text: combinedText,
                    thinkingText: parsed.thinkingText || undefined,
                    images: images.map((img: { url: string; caption: string }) => img.url),
                  };
                  result.images = images;
                  result.aiMessage = aiMessage;
                  result.auasMeta = auasMeta;
                  result.ok = true;

                  setSimcarAuasImages(images);
                  setSimcarAuasMessages([aiMessage]);
                  setSimcarAuasProgress({
                    step: 'complete',
                    percent: 100,
                    message: 'Análise AUAS concluída. Finalizando...',
                  });
                  setSimcarAuasAgentLog((prev) => prev.map((s) => ({ ...s, done: true })));
	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    auasAnalysisImages: images,
	                    auasAnalysisMessages: [aiMessage],
	                    auasMeta,
	                    ...(historyEntry?.sourceMode === 'vectorized-analysis'
	                      ? {}
	                      : { status: 'completed' as const, error: undefined }),
	                    ...normalizeSimcarReportPatch(event),
	                  };
                  setSimcarClipHistory((prev) =>
                    prev.map((c) =>
                      c.jobId === jobId
                        ? {
                          ...c,
                          ...patch,
                        }
                        : c
                    )
                  );
                  void patchPersistedSimcarClip(jobId, patch);

                  const clipBase: SimcarClipHistoryItem = historyEntry
                    ? historyEntry
                    : {
                      id: jobId,
                      timestamp: new Date().toISOString(),
                      filename: `Recorte ${jobId.slice(0, 8)}`,
                      downloadUrl: '',
                      totalFeatures: 0,
                      propertyAreaHa: 0,
                      layersWithData: 0,
                      totalLayers: 0,
                      jobId,
                    };
                  const clipForConversation: SimcarClipHistoryItem = {
                    ...clipBase,
                    ...patch,
                  };
                  const imageLinks = images.map((img: { url: string; caption: string }) => `- ${img.url}`);
                  if (!skipConversation) {
                    void appendSimcarEntriesToConversation(clipForConversation, [
                      {
                        role: 'user',
                        text: `Solicitei analise de AUAS para o recorte ${jobId}.`,
                      },
                      {
                        role: 'ai',
                        text: [
                          `Analise de AUAS concluida para o recorte ${jobId}.`,
                          imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
                          aiMessage.text,
                        ]
                          .filter(Boolean)
                          .join('\n\n'),
                      },
                    ]);
                  }
	                } else if (event.type === 'report_error') {
	                  const message = String(event.message || 'Falha ao gerar PDF técnico.');
	                  const patch: Partial<SimcarClipHistoryItem> = {
	                    reportPdfStatus: 'failed',
	                    reportPdfError: message,
	                  };
	                  setSimcarClipHistory((prev) =>
	                    prev.map((c) => (c.jobId === jobId ? { ...c, ...patch } : c))
	                  );
	                  void patchPersistedSimcarClip(jobId, patch);
	                } else if (event.type === 'billing' && event.billing) {
                  applyBillingToWallet(event.billing as BillingResult);
                } else if (event.type === 'error') {
                  if (event?.code === 'INSUFFICIENT_CREDITS') {
                    handleInsufficientCredits(String(event.message || 'Saldo insuficiente.'));
                    insufficientCredits = true;
                    break readLoop;
                  }
                  streamError = normalizeBackendText(String(event.message || 'Erro inesperado na analise de AUAS.'));
                  break readLoop;
                }
              } catch {
                // ignore malformed SSE chunk
              }
            }
          }
        }

        if (insufficientCredits) {
          return { ...result, ok: false, error: 'Saldo insuficiente.' };
        }
        if (streamError) {
          throw new Error(streamError);
        }
        if (!result.ok) {
          throw new Error('Falha ao concluir análise AUAS.');
        }
        return result;
      } catch (err: any) {
        const message = String(err?.message || 'Erro inesperado.');
        setSimcarAuasMessages([{ role: 'ai', text: `❌ ${message}` }]);
        if (historyEntry && !skipConversation) {
          void appendSimcarEntriesToConversation(historyEntry, [
            { role: 'user', text: `Solicitei analise de AUAS para o recorte ${jobId}.` },
            { role: 'ai', text: `❌ ${message}` },
          ]);
        }
        return { ...result, ok: false, error: message };
      } finally {
        simcarAuasAbortRef.current = null;
        simcarAuasProcessJobIdRef.current = null;
        setSimcarAuasProcessing(false);
        setSimcarAuasProgress(null);
      }
    },
    [
      apiFetch,
      appendSimcarEntriesToConversation,
      applyBillingToWallet,
      handleInsufficientCredits,
      normalizeSimcarReportPatch,
      patchPersistedSimcarClip,
      readApiError,
      simcarAnalysisMessages,
      simcarClipHistory,
      splitThinkContent,
    ]
  );

  const runVectorizedCompleteAnalysis = useCallback(async () => {
    if (!simcarClipFile) {
      toast.error('Selecione um ZIP vetorizado para continuar.');
      return;
    }
    setSimcarUnifiedProgressDisplay(0);
    setSimcarVectorizedRunning(true);
    setSimcarVectorizedStatus({ stage: 'importing', message: 'Importando ZIP vetorizado...' });
    setSimcarClipError(null);
    setSimcarClipDownloadUrl(null);
    setSimcarClipSummary(null);
    setSimcarAnalysisImages([]);
    setSimcarAnalysisMessages([]);
    setSimcarAuasImages([]);
    setSimcarAuasMessages([]);
    setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
    let pipelineJobId = '';

    const patchVectorizedHistoryState = (jobId: string, patch: Partial<SimcarClipHistoryItem>) => {
      if (!jobId) return;
      setSimcarClipHistory((prev) =>
        prev.map((clip) => (clip.jobId === jobId ? { ...clip, ...patch } : clip))
      );
      void patchPersistedSimcarClip(jobId, patch).catch(() => undefined);
    };

    try {
      const base64 = await readFileAsBase64Payload(simcarClipFile);
      const response = await apiFetch('/api/simcar/clip/import-vectorized', {
        method: 'POST',
        body: JSON.stringify({
          propertyZip: base64,
          filename: simcarClipFile.name,
        }),
      });
      const payload = await readApiError(response);
      if (!response.ok) {
        if (response.status === 402 || payload?.code === 'INSUFFICIENT_CREDITS') {
          handleInsufficientCredits(payload?.error);
          setSimcarVectorizedStatus({ stage: 'error', message: payload?.error || 'Saldo insuficiente.' });
          return;
        }
        throw new Error(payload?.error || `Erro ${response.status}`);
      }

      if (payload?.billing) {
        applyBillingToWallet(payload.billing as BillingResult);
      }

      const jobId = String(payload?.jobId || '').trim();
      if (!jobId) {
        throw new Error('Importação concluída sem jobId válido.');
      }
      pipelineJobId = jobId;
      const resolvedDownloadUrl = resolveBackendDownloadUrl(payload?.downloadUrl, payload?.outputZipUrl);
      const summary = normalizeSimcarClipSummary(payload?.summary);
      const newClip: SimcarClipHistoryItem = {
        id: jobId,
        timestamp: new Date().toISOString(),
        filename: `Análise Vetorizada ${new Date().toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}`,
        downloadUrl: resolvedDownloadUrl,
        totalFeatures: Number(summary?.totalFeaturesClipped || 0),
        propertyAreaHa: Number(summary?.propertyAreaHa || 0),
        layersWithData: Number(summary?.layersWithData || summary?.layers?.filter((l: any) => Number(l?.features || 0) > 0).length || 0),
        totalLayers: Number(summary?.layersProcessed || summary?.layers?.length || 0),
        jobId,
        conversationId: nanoid(),
        inputZipUrl: payload?.inputZipUrl ? String(payload.inputZipUrl) : undefined,
        outputZipUrl: payload?.outputZipUrl ? String(payload.outputZipUrl) : undefined,
        contextUrl: payload?.contextUrl ? String(payload.contextUrl) : undefined,
        sourceMode: 'vectorized-analysis',
        status: 'processing',
        processingStage: 'importing',
        summary: summary || undefined,
      };

      setSimcarClipJobId(jobId);
      setSimcarClipDownloadUrl(resolvedDownloadUrl || null);
      setSimcarClipSummary(summary || null);
      setSimcarClipHistory((prev) => [newClip, ...prev.filter((c) => c.jobId !== jobId)]);
      await persistSimcarClipHistoryEntry(newClip);

      patchVectorizedHistoryState(jobId, {
        status: 'processing',
        processingStage: 'acavn',
        error: undefined,
      });
      const cloudinaryFiles = [
        newClip.outputZipUrl ? `- ZIP vetorizado: ${newClip.outputZipUrl}` : '',
        newClip.contextUrl ? `- Contexto JSON: ${newClip.contextUrl}` : '',
      ].filter(Boolean);
      void appendSimcarEntriesToConversation(
        newClip,
        [
          {
            role: 'user',
            text: [
              'Solicitei importação do ZIP vetorizado para análise completa SIMCAR.',
              `Arquivo: ${simcarClipFile.name}.`,
            ].join('\n'),
          },
          {
            role: 'ai',
            text: [
              `Importação vetorizada concluída (job ${jobId}).`,
              `Feições detectadas: ${newClip.totalFeatures}.`,
              `Área do imóvel: ${newClip.propertyAreaHa.toFixed(2)} ha.`,
              cloudinaryFiles.length > 0 ? `Arquivos no Cloudinary:\n${cloudinaryFiles.join('\n')}` : '',
              resolvedDownloadUrl ? `Download do ZIP: ${resolvedDownloadUrl}` : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ],
        { title: newClip.filename }
      );

      setSimcarVectorizedStatus({ stage: 'acavn', message: 'Executando analise integrada (etapa AC/AVN)...' });
      const acAvnResult = await runAcAvnAnalysis({
        jobId,
        historyEntry: newClip,
        layers: simcarFixedSatelliteKeys,
        imageOnly: false,
        silentOutput: true,
        skipConversation: true,
      });
      if (!acAvnResult.ok) {
        const errText = acAvnResult.error || 'Falha na etapa AC/AVN.';
        setSimcarClipError(errText);
        setSimcarVectorizedStatus({ stage: 'error', message: errText });
        patchVectorizedHistoryState(jobId, {
          status: 'failed',
          processingStage: 'error',
          error: errText,
        });
        return;
      }

      patchVectorizedHistoryState(jobId, {
        status: 'processing',
        processingStage: 'auas',
        error: undefined,
      });
      setSimcarVectorizedStatus({ stage: 'auas', message: 'Consolidando laudo unico (AUAS + AC/AVN)...' });
      const previousAnalysisText = acAvnResult.aiMessage?.text
        || '';
      const auasResult = await runAuasAnalysis({
        jobId,
        historyEntry: {
          ...newClip,
          analysisMeta: acAvnResult.analysisMeta,
        },
        previousAnalysis: previousAnalysisText,
        acAvnMeta: acAvnResult.analysisMeta,
        skipConversation: true,
      });
      if (!auasResult.ok) {
        const errText = auasResult.error || 'Falha na etapa AUAS.';
        setSimcarClipError(errText);
        setSimcarVectorizedStatus({ stage: 'error', message: errText });
        patchVectorizedHistoryState(jobId, {
          status: 'failed',
          processingStage: 'error',
          error: errText,
        });
        return;
      }

      const acAvnImages = (acAvnResult.images || [])
        .filter((img, idx, arr) => img?.url && arr.findIndex((x) => x.url === img.url) === idx);
      const auasImages = (auasResult.images || [])
        .filter((img, idx, arr) => img?.url && arr.findIndex((x) => x.url === img.url) === idx);
      setSimcarAnalysisImages(acAvnImages);
      setSimcarAnalysisMessages([]);
      const rawAuasText = String(auasResult.aiMessage?.text || '').trim();
      const backendLooksIntegrated =
        /(ac\/avn|area consolidada|área consolidada)/i.test(rawAuasText) && /\bauas\b/i.test(rawAuasText);
      const finalCombinedText =
        (previousAnalysisText && rawAuasText && !backendLooksIntegrated)
          ? buildIntegratedVectorizedReport(previousAnalysisText, rawAuasText)
          : rawAuasText
            || buildIntegratedVectorizedReport(
              acAvnResult.aiMessage?.text || '',
              auasResult.aiMessage?.text || ''
            );
      const mergedImages = [...acAvnImages, ...auasImages]
        .filter((img, idx, arr) => img?.url && arr.findIndex((x) => x.url === img.url) === idx);
      const finalAiMessage: SimcarAnalysisMessage = {
        role: 'ai',
        text: finalCombinedText,
        thinkingText: auasResult.aiMessage?.thinkingText,
        images: mergedImages.map((img) => img.url),
      };
      setSimcarAuasImages(auasImages);
      setSimcarAuasMessages([finalAiMessage]);
      setSimcarResultImagePanelsOpen({ acAvn: false, auas: false });
      setSimcarClipHistory((prev) =>
        prev.map((c) =>
          c.jobId === jobId
            ? {
              ...c,
              status: 'completed',
              processingStage: 'done',
              error: undefined,
              analysisMeta: acAvnResult.analysisMeta,
              auasAnalysisImages: auasImages,
              auasAnalysisMessages: [finalAiMessage],
              auasMeta: auasResult.auasMeta,
            }
            : c
        )
      );
      void patchPersistedSimcarClip(jobId, {
        status: 'completed',
        processingStage: 'done',
        error: undefined,
        analysisMeta: acAvnResult.analysisMeta,
        auasAnalysisImages: auasImages,
        auasAnalysisMessages: [finalAiMessage],
        auasMeta: auasResult.auasMeta,
      });
      const imageLinks = mergedImages.map((img) => `- ${img.url}`);
      await appendSimcarEntriesToConversation(
        {
          ...newClip,
          analysisMeta: acAvnResult.analysisMeta,
          auasAnalysisImages: auasImages,
          auasAnalysisMessages: [finalAiMessage],
          auasMeta: auasResult.auasMeta,
        },
        [
          {
            role: 'user',
            text: `Solicitei analise completa vetorizada para o recorte ${jobId} (AC, AVN e AUAS em laudo unico).`,
          },
          {
            role: 'ai',
            text: [
              `Analise completa concluida para o recorte ${jobId}.`,
              imageLinks.length > 0 ? `Imagens no Cloudinary:\n${imageLinks.join('\n')}` : '',
              finalCombinedText,
            ]
              .filter(Boolean)
              .join('\n\n'),
          },
        ]
      );

      setSimcarVectorizedStatus({ stage: 'done', message: 'Análise completa finalizada com sucesso.' });
      toast.success('Análise completa por IA concluída.');
    } catch (err: any) {
      const message = String(err?.message || 'Erro inesperado na análise completa vetorizada.');
      setSimcarClipError(message);
      setSimcarVectorizedStatus({ stage: 'error', message });
      if (pipelineJobId) {
        patchVectorizedHistoryState(pipelineJobId, {
          status: 'failed',
          processingStage: 'error',
          error: message,
        });
      }
    } finally {
      setSimcarVectorizedRunning(false);
    }
  }, [
    apiFetch,
    appendSimcarEntriesToConversation,
    applyBillingToWallet,
    handleInsufficientCredits,
    persistSimcarClipHistoryEntry,
    readApiError,
    runAcAvnAnalysis,
    runAuasAnalysis,
    simcarAnalysisMessages,
    simcarClipFile,
    simcarFixedSatelliteKeys,
    normalizeSimcarClipSummary,
    patchPersistedSimcarClip,
  ]);

  return {
    sendSimcarFollowUpMessage,
    runAcAvnAnalysis,
    runAuasAnalysis,
    runVectorizedCompleteAnalysis,
  };
}
