/**
 * Hook de estado do chat principal do Dashboard GeoForest.
 * Plano 03, passo 7 — extrai estado puro de Dashboard.tsx.
 *
 * Padrão: retorna estado + setters + refs. Os callbacks pesados
 * (handleSend, loadConversation, handleInsufficientCredits) permanecem
 * no Dashboard e consomem os setters deste hook.
 */
import { useRef, useState } from 'react';
import type { ChatMessage, Conversation } from '@/dashboard/types/history';
import type { UserSettings } from '@/dashboard/settings/types';
import { DEFAULT_ASSISTANT_MESSAGE } from '@/dashboard/lib/chatDefaults';
import { DEFAULT_SETTINGS } from '@/dashboard/settings/types';

export function useChat() {
  const [input, setInput] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);

  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const chatAbortRef = useRef<AbortController | null>(null);
  const chatProcessJobIdRef = useRef<string | null>(null);
  const runningProcessingJobsCountRef = useRef(0);
  const [chatError, setChatError] = useState<string | null>(null);
  const [lastPromptText, setLastPromptText] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const messagesRef = useRef<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState('');
  const typingTargetRef = useRef('');
  const typingDisplayedRef = useRef('');
  const typingAnimationFrameRef = useRef<number | null>(null);
  const [liveThinkingText, setLiveThinkingText] = useState('');
  const [liveThinkingTarget, setLiveThinkingTarget] = useState('');
  const thinkingTypingTimerRef = useRef<number | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
  const [processingHintIndex, setProcessingHintIndex] = useState(0);
  const processingTimerRef = useRef<number | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});

  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  return {
    input,
    setInput,
    imageFile,
    setImageFile,
    imagePreview,
    setImagePreview,
    pdfFile,
    setPdfFile,
    queuedFiles,
    setQueuedFiles,
    uploading,
    setUploading,
    sending,
    setSending,
    chatAbortRef,
    chatProcessJobIdRef,
    runningProcessingJobsCountRef,
    chatError,
    setChatError,
    lastPromptText,
    setLastPromptText,
    copiedMessageId,
    setCopiedMessageId,
    messages,
    setMessages,
    messagesRef,
    conversations,
    setConversations,
    activeConversationId,
    setActiveConversationId,
    searchTerm,
    setSearchTerm,
    typingMessageId,
    setTypingMessageId,
    typingText,
    setTypingText,
    typingTargetRef,
    typingDisplayedRef,
    typingAnimationFrameRef,
    liveThinkingText,
    setLiveThinkingText,
    liveThinkingTarget,
    setLiveThinkingTarget,
    thinkingTypingTimerRef,
    aiThinking,
    setAiThinking,
    resettingPassword,
    setResettingPassword,
    processingHintIndex,
    setProcessingHintIndex,
    processingTimerRef,
    expandedThinking,
    setExpandedThinking,
    settings,
    setSettings,
  };
}
