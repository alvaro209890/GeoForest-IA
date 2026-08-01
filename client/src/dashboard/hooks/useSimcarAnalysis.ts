/**
 * Hook de estado da análise SIMCAR (AI Analysis + AUAS) do Dashboard.
 * Plano 03, passo 6 — extrai estado puro de Dashboard.tsx.
 *
 * Padrão: retorna estado + setters + refs. Os callbacks pesados
 * (runSimcarAnalysis, runAuasAnalysis, sendSimcarChatMessage) permanecem
 * no Dashboard e consomem os setters deste hook.
 */
import { useRef, useState } from 'react';
import type { SimcarAnalysisImage, SimcarAnalysisMessage } from '@/dashboard/types/history';

export type SimcarProgressState = { step: string; percent: number; message: string };

export type SimcarAgentLogEntry = { label: string; done: boolean; kind: 'step' | 'thinking' };

export function useSimcarAnalysis() {
  // ─── SIMCAR AI Analysis State ───
  const [simcarAnalysisProcessing, setSimcarAnalysisProcessing] = useState(false);
  const [simcarAnalysisProgress, setSimcarAnalysisProgress] = useState<SimcarProgressState | null>(null);
  const [simcarAgentLog, setSimcarAgentLog] = useState<SimcarAgentLogEntry[]>([]);
  const [simcarAnalysisImages, setSimcarAnalysisImages] = useState<SimcarAnalysisImage[]>([]);
  const [simcarAnalysisMessages, setSimcarAnalysisMessages] = useState<SimcarAnalysisMessage[]>([]);
  const [simcarThinkingText, setSimcarThinkingText] = useState('');
  const [simcarThinkingHidden, setSimcarThinkingHidden] = useState(false);
  const [simcarAnalysisInput, setSimcarAnalysisInput] = useState('');
  const [simcarAnalysisSending, setSimcarAnalysisSending] = useState(false);
  const [simcarLiveThinkingText, setSimcarLiveThinkingText] = useState('');
  const [simcarLiveAnswerText, setSimcarLiveAnswerText] = useState('');
  const simcarAnalysisChatRef = useRef<HTMLDivElement | null>(null);
  const simcarThinkingPanelRef = useRef<HTMLDivElement | null>(null);
  const simcarLiveAnswerPanelRef = useRef<HTMLDivElement | null>(null);
  const simcarAgentLogEndRef = useRef<HTMLDivElement | null>(null);
  const simcarAnalysisAbortRef = useRef<AbortController | null>(null);
  const simcarAnalysisProcessJobIdRef = useRef<string | null>(null);
  const [simcarAnalysisStartTime, setSimcarAnalysisStartTime] = useState<number | null>(null);
  const [simcarElapsed, setSimcarElapsed] = useState(0);

  // ─── SIMCAR AUAS Analysis State ───
  const [simcarAuasProcessing, setSimcarAuasProcessing] = useState(false);
  const [simcarAuasProgress, setSimcarAuasProgress] = useState<SimcarProgressState | null>(null);
  const [simcarAuasImages, setSimcarAuasImages] = useState<SimcarAnalysisImage[]>([]);
  const [simcarImagePreview, setSimcarImagePreview] = useState<SimcarAnalysisImage | null>(null);
  const [simcarAuasMessages, setSimcarAuasMessages] = useState<SimcarAnalysisMessage[]>([]);
  const [simcarAuasAgentLog, setSimcarAuasAgentLog] = useState<SimcarAgentLogEntry[]>([]);
  const simcarAuasAbortRef = useRef<AbortController | null>(null);
  const simcarAuasProcessJobIdRef = useRef<string | null>(null);
  const [simcarResultImagePanelsOpen, setSimcarResultImagePanelsOpen] = useState<{ acAvn: boolean; auas: boolean }>({
    acAvn: false,
    auas: false,
  });

  return {
    // estado AI Analysis
    simcarAnalysisProcessing,
    simcarAnalysisProgress,
    simcarAgentLog,
    simcarAnalysisImages,
    simcarAnalysisMessages,
    simcarThinkingText,
    simcarThinkingHidden,
    simcarAnalysisInput,
    simcarAnalysisSending,
    simcarLiveThinkingText,
    simcarLiveAnswerText,
    simcarAnalysisStartTime,
    simcarElapsed,
    // estado AUAS
    simcarAuasProcessing,
    simcarAuasProgress,
    simcarAuasImages,
    simcarImagePreview,
    simcarAuasMessages,
    simcarAuasAgentLog,
    simcarResultImagePanelsOpen,
    // refs
    simcarAnalysisChatRef,
    simcarThinkingPanelRef,
    simcarLiveAnswerPanelRef,
    simcarAgentLogEndRef,
    simcarAnalysisAbortRef,
    simcarAnalysisProcessJobIdRef,
    simcarAuasAbortRef,
    simcarAuasProcessJobIdRef,
    // setters
    setSimcarAnalysisProcessing,
    setSimcarAnalysisProgress,
    setSimcarAgentLog,
    setSimcarAnalysisImages,
    setSimcarAnalysisMessages,
    setSimcarThinkingText,
    setSimcarThinkingHidden,
    setSimcarAnalysisInput,
    setSimcarAnalysisSending,
    setSimcarLiveThinkingText,
    setSimcarLiveAnswerText,
    setSimcarAnalysisStartTime,
    setSimcarElapsed,
    setSimcarAuasProcessing,
    setSimcarAuasProgress,
    setSimcarAuasImages,
    setSimcarImagePreview,
    setSimcarAuasMessages,
    setSimcarAuasAgentLog,
    setSimcarResultImagePanelsOpen,
  };
}
