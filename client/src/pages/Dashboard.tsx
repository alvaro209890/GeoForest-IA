import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Leaf,
  Plus,
  Search,
  Send,
  Paperclip,
  MessageSquare,
  Map as MapIcon,
  Zap,
  Sparkles,
  Menu,
  User,
  ChevronDown,
  Settings,
  Bell,
  Shield,
  FileDown,
  Layers,
  LogOut,
  ImagePlus,
  FileText,
  Trash2,
  X,
} from 'lucide-react';
import { useLocation } from 'wouter';
import { onAuthStateChanged, sendPasswordResetEmail } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  deleteDoc,
  setDoc,
  serverTimestamp,
  type DocumentReference,
} from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { handleLogout, UserProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { nanoid } from 'nanoid';

type ChatMessage = {
  id: string;
  role: 'ai' | 'user';
  text: string;
  time?: string;
  meta?: {
    model?: string;
    imageUrl?: string;
    fileUrl?: string;
    fileDownloadUrl?: string;
    fileName?: string;
    uploadStatus?: 'uploading' | 'done' | 'error';
    fileType?: 'image' | 'pdf';
    thinkingText?: string;
    mapContext?: {
      layerName: string;
      bbox: [number, number, number, number];
      crs: string;
      source: 'SEMA_WMS';
      width?: number;
      height?: number;
    };
  };
};

type MapLayerOption = {
  name: string;
  title: string;
  crs?: string[];
  inferredYear?: string;
  group?: 'spot' | 'landsat' | 'sentinel' | 'other';
};

const SEMA_WMS_DIRECT_BASE =
  'https://geo.sema.mt.gov.br/geoserver/ows?service=WMS&version=1.1.1&authkey=541085de-9a2e-454e-bdba-eb3d57a2f492&request=GetMap';

const buildDirectWmsGetMapUrl = (
  layerName: string,
  bbox: [number, number, number, number],
  width = 1100,
  height = 700,
  format = 'image/png'
) => {
  const params = new URLSearchParams({
    layers: layerName,
    styles: '',
    format,
    transparent: 'false',
    srs: 'EPSG:4326',
    bbox: bbox.join(','),
    width: String(width),
    height: String(height),
  });
  return `${SEMA_WMS_DIRECT_BASE}&${params.toString()}`;
};

const REQUIRED_MODELS: Array<{ id: string; label: string; capabilities: string[]; description: string }> = [
  {
    id: 'meta-llama/llama-3.3-70b-versatile',
    label: 'Llama 3.3 70B',
    capabilities: ['text'],
    description: 'Equilíbrio geral para análise técnica e respostas longas em PT-BR.',
  },
  {
    id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    label: 'Llama 4 Maverick',
    capabilities: ['text', 'vision'],
    description: 'Melhor para imagem/satélite + interpretação contextual detalhada.',
  },
  {
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    label: 'Llama 4 Scout',
    capabilities: ['text', 'vision'],
    description: 'Rápido para triagem visual e respostas curtas com boa precisão.',
  },
  {
    id: 'meta-llama/llama-guard-4-12b',
    label: 'Llama Guard 4 12B',
    capabilities: ['text'],
    description: 'Focado em moderação e segurança; não é o principal para análise.',
  },
  {
    id: 'qwen/qwen3-32b',
    label: 'Qwen 3 32B',
    capabilities: ['text'],
    description: 'Bom para raciocínio estruturado, tabelas e extração de dados.',
  },
  {
    id: 'moonshotai/kimi-k2-instruct-0905',
    label: 'Kimi K2 Instruct (0905)',
    capabilities: ['text'],
    description: 'Ótimo para textos longos, síntese e revisão de documentos.',
  },
  {
    id: 'openai/gpt-oss-20b',
    label: 'GPT OSS 20B',
    capabilities: ['text'],
    description: 'Modelo alternativo rápido para tarefas gerais e QA técnico.',
  },
];

type Conversation = {
  id: string;
  title: string;
  updatedAt?: any;
  lastMessagePreview?: string;
  lastAttachmentType?: 'image' | 'pdf';
};

const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  id: 'seed',
  role: 'ai',
  text: 'Olá! Sou a GeoForest IA. Posso apoiar análises ambientais, processamento de imagens de satélite e interpretação de dados florestais. Como posso ajudar hoje?',
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  meta: { model: 'auto' },
};

type UserSettings = {
  theme: string;
  language: string;
  fontSize: string;
  coordSystem: string;
  unit: string;
  defaultLayer: string;
  exportFormat: string;
  includeMetadata: boolean;
  compressLarge: boolean;
  alertProcessing: boolean;
  alertNewFeatures: boolean;
  alertFires: boolean;
  twoFactorEnabled: boolean;
};

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'Escuro (Floresta)',
  language: 'Português (BR)',
  fontSize: 'Padrão',
  coordSystem: 'SIRGAS 2000 (Brasil)',
  unit: 'Hectares (ha)',
  defaultLayer: 'Satélite (Alta Res.)',
  exportFormat: 'KML / KMZ',
  includeMetadata: true,
  compressLarge: false,
  alertProcessing: true,
  alertNewFeatures: false,
  alertFires: true,
  twoFactorEnabled: true,
};

const sanitizeMessagesForFirestore = (msgs: ChatMessage[]) =>
  msgs.map((m) => {
    const meta = m.meta
      ? Object.fromEntries(Object.entries(m.meta).filter(([, v]) => v !== undefined))
      : undefined;
    const clean = {
      ...m,
      meta: meta && Object.keys(meta).length > 0 ? meta : undefined,
    };
    if (!clean.meta) delete (clean as any).meta;
    return clean;
  });

const toCloudinaryDownloadUrl = (url?: string) => {
  if (!url) return '';
  if (url.includes('/upload/fl_attachment/')) return url;
  if (url.includes('/upload/')) return url.replace('/upload/', '/upload/fl_attachment/');
  return url;
};

const toFileProxyUrl = (url?: string, name?: string, mode: 'inline' | 'download' = 'inline') => {
  if (!url) return '';
  const safeName = (name || 'documento.pdf').replace(/[^a-zA-Z0-9._-]/g, '_');
  return `/api/file-proxy?mode=${mode}&url=${encodeURIComponent(url)}&name=${encodeURIComponent(safeName)}`;
};

const renderInlineRichText = (text: string) => {
  const parts: React.ReactNode[] = [];
  const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > cursor) {
      parts.push(<span key={`txt-${idx++}`}>{text.slice(cursor, match.index)}</span>);
    }
    const token = match[0];
    if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`b-${idx++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(<code key={`c-${idx++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`i-${idx++}`}>{token.slice(1, -1)}</em>);
    } else {
      parts.push(<span key={`u-${idx++}`}>{token}</span>);
    }
    cursor = match.index + token.length;
  }

  if (cursor < text.length) {
    parts.push(<span key={`txt-${idx++}`}>{text.slice(cursor)}</span>);
  }

  return parts;
};

const renderRichText = (text: string) => {
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (bulletMatch) {
      return (
        <div key={`line-${i}`} className="pl-2">
          <span className="mr-2 text-emerald-300">•</span>
          {renderInlineRichText(bulletMatch[1])}
        </div>
      );
    }
    return (
      <div key={`line-${i}`}>
        {line.length ? renderInlineRichText(line) : <span>&nbsp;</span>}
      </div>
    );
  });
};

const parseKmlBboxOnClient = (kmlText: string): [number, number, number, number] => {
  const matches = [...kmlText.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)];
  if (!matches.length) {
    throw new Error('KML sem coordenadas válidas.');
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of matches) {
    const raw = String(m[1] || '').trim();
    const tuples = raw.split(/\s+/);
    for (const t of tuples) {
      const [xStr, yStr] = t.split(',');
      const x = Number(xStr);
      const y = Number(yStr);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    throw new Error('Não foi possível extrair bbox do KML.');
  }
  return [minX, minY, maxX, maxY];
};

const parseZipShpBboxOnClient = async (file: File): Promise<[number, number, number, number]> => {
  const arr = await file.arrayBuffer();
  const bytes = new Uint8Array(arr);
  let offset = 0;
  while (offset + 30 <= bytes.length) {
    const sig =
      bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24);
    if (sig !== 0x04034b50) break;
    const method = bytes[offset + 8] | (bytes[offset + 9] << 8);
    const compressedSize =
      bytes[offset + 18] |
      (bytes[offset + 19] << 8) |
      (bytes[offset + 20] << 16) |
      (bytes[offset + 21] << 24);
    const fileNameLength = bytes[offset + 26] | (bytes[offset + 27] << 8);
    const extraLength = bytes[offset + 28] | (bytes[offset + 29] << 8);
    const nameStart = offset + 30;
    const nameEnd = nameStart + fileNameLength;
    const name = new TextDecoder().decode(bytes.slice(nameStart, nameEnd)).toLowerCase();
    const dataStart = nameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) break;
    if (name.endsWith('.shp')) {
      if (method !== 0) {
        throw new Error('ZIP com SHP comprimido não suportado no frontend. Refaça ZIP sem compressão ou use backend novo.');
      }
      const dv = new DataView(arr, dataStart, compressedSize);
      const minX = dv.getFloat64(36, true);
      const minY = dv.getFloat64(44, true);
      const maxX = dv.getFloat64(52, true);
      const maxY = dv.getFloat64(60, true);
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
        throw new Error('Não foi possível extrair BBOX do shapefile.');
      }
      return [minX, minY, maxX, maxY];
    }
    offset = dataEnd;
  }
  throw new Error('ZIP sem arquivo .shp encontrado.');
};

export default function Dashboard() {
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [, setLocation] = useLocation();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [models] = useState<Array<{ id: string; label: string; capabilities: string[]; description: string }>>(REQUIRED_MODELS);
  const [selectedModel, setSelectedModel] = useState('auto');
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const modelMenuRef = useRef<HTMLDivElement | null>(null);

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pendingMapContext, setPendingMapContext] = useState<ChatMessage['meta']['mapContext'] | undefined>(undefined);
  const [pendingMapImageUrl, setPendingMapImageUrl] = useState<string | null>(null);
  const [mapDialogOpen, setMapDialogOpen] = useState(false);
  const [mapLayers, setMapLayers] = useState<MapLayerOption[]>([]);
  const [selectedMapLayer, setSelectedMapLayer] = useState('');
  const [mapLoading, setMapLoading] = useState(false);
  const [mapCapturing, setMapCapturing] = useState(false);
  const [mapBbox, setMapBbox] = useState<[number, number, number, number]>([-61, -18, -50, -8]);
  const [mapPreviewDataUrl, setMapPreviewDataUrl] = useState('');
  const [mapPreviewLoading, setMapPreviewLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const messagesRef = useRef<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState('');
  const [liveThinkingText, setLiveThinkingText] = useState('');
  const [liveThinkingTarget, setLiveThinkingTarget] = useState('');
  const thinkingTypingTimerRef = useRef<number | null>(null);
  const [aiThinking, setAiThinking] = useState(false);
  const [processingHintIndex, setProcessingHintIndex] = useState(0);
  const processingTimerRef = useRef<number | null>(null);
  const [expandedThinking, setExpandedThinking] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);

  const [conversationsRef, setConversationsRef] = useState<{
    collection: ReturnType<typeof collection>;
  } | null>(null);
  const [activeConversationRef, setActiveConversationRef] = useState<DocumentReference | null>(null);
  const [settingsRef, setSettingsRef] = useState<DocumentReference | null>(null);

  const systemPrompt = useMemo(
    () => ({
      role: 'system',
      content:
        [
          'Você é uma IA especializada em engenharia florestal e análise ambiental.',
          `Usuário atual: ${userProfile?.fullName || 'Usuário'}.`,
          'Responda em português do Brasil, com foco técnico, claro e orientado a ação.',
          'Considere o contexto da conversa atual como prioridade.',
          'Se faltarem dados, diga exatamente quais dados faltam.',
          'Não invente normas, números, fontes ou conclusões.',
        ].join(' '),
    }),
    [userProfile?.fullName]
  );

  const shouldUseCrossChatContext = (text: string) =>
    /(como falei|conforme falamos|outro chat|conversa anterior|continue|continuar|retome|retomar|lembr|mesmo assunto|igual ao anterior)/i.test(
      text
    );

  const buildCrossChatContext = (activeId: string | null, text: string) => {
    if (!shouldUseCrossChatContext(text)) return '';
    const others = conversations
      .filter((c) => c.id !== activeId)
      .slice(0, 4)
      .map((c, i) => {
        const preview = (c.lastMessagePreview || '').trim();
        if (!preview) return '';
        return `${i + 1}. ${c.title}: ${preview}`;
      })
      .filter(Boolean);
    if (!others.length) return '';
    return `Contexto de conversas anteriores (use apenas se ajudar na resposta atual):\n${others.join('\n')}`;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      try {
        if (!currentUser) {
          setLocation('/');
          return;
        }

        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);
        if (userDocSnap.exists()) {
          setUserProfile(userDocSnap.data() as UserProfile);
        }

        const collRef = collection(db, 'users', currentUser.uid, 'conversations');
        setConversationsRef({ collection: collRef });

        const nextSettingsRef = doc(db, 'users', currentUser.uid, 'settings', 'preferences');
        setSettingsRef(nextSettingsRef);
        const settingsSnap = await getDoc(nextSettingsRef);
        if (settingsSnap.exists()) {
          setSettings({ ...DEFAULT_SETTINGS, ...(settingsSnap.data() as Partial<UserSettings>) });
        } else {
          await setDoc(nextSettingsRef, DEFAULT_SETTINGS, { merge: true });
        }

        const qs = query(collRef, orderBy('updatedAt', 'desc'));
        const snap = await getDocs(qs);
        const list: Conversation[] = [];
        snap.forEach((docSnap) => {
          const data = docSnap.data() as Conversation;
          list.push({
            id: docSnap.id,
            title: data.title || 'Nova conversa',
            updatedAt: data.updatedAt,
            lastMessagePreview: data.lastMessagePreview,
            lastAttachmentType: (data as any).lastAttachmentType,
          });
        });

        if (list.length === 0) {
          await createConversation(collRef);
        } else {
          setConversations(list);
          await loadConversation(collRef, list[0].id);
        }
      } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        toast.error('Erro ao carregar perfil do usuário');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [setLocation]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!modelMenuRef.current) return;
      if (!modelMenuRef.current.contains(event.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    if (activeView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeView]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.style.setProperty('--app-font-size', settings.fontSize === 'Pequeno' ? '14px' : settings.fontSize === 'Grande' ? '17px' : '15px');

    if (settings.theme === 'Claro (Dia)') {
      body.classList.add('theme-light');
    } else {
      body.classList.remove('theme-light');
    }
  }, [settings.theme, settings.fontSize]);

  useEffect(() => {
    if (thinkingTypingTimerRef.current) {
      window.clearInterval(thinkingTypingTimerRef.current);
      thinkingTypingTimerRef.current = null;
    }

    if (!liveThinkingTarget) {
      setLiveThinkingText('');
      return;
    }

    if (liveThinkingTarget.length < liveThinkingText.length) {
      setLiveThinkingText(liveThinkingTarget);
      return;
    }

    thinkingTypingTimerRef.current = window.setInterval(() => {
      setLiveThinkingText((prev) => {
        if (prev.length >= liveThinkingTarget.length) {
          if (thinkingTypingTimerRef.current) {
            window.clearInterval(thinkingTypingTimerRef.current);
            thinkingTypingTimerRef.current = null;
          }
          return prev;
        }
        return liveThinkingTarget.slice(0, prev.length + 1);
      });
    }, 24);

    return () => {
      if (thinkingTypingTimerRef.current) {
        window.clearInterval(thinkingTypingTimerRef.current);
        thinkingTypingTimerRef.current = null;
      }
    };
  }, [liveThinkingTarget, liveThinkingText.length]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

  useEffect(() => {
    if (aiThinking || typingMessageId) {
      if (processingTimerRef.current) {
        window.clearInterval(processingTimerRef.current);
      }
      processingTimerRef.current = window.setInterval(() => {
        setProcessingHintIndex((prev) => (prev + 1) % 4);
      }, 1300);
    } else if (processingTimerRef.current) {
      window.clearInterval(processingTimerRef.current);
      processingTimerRef.current = null;
      setProcessingHintIndex(0);
    }

    return () => {
      if (processingTimerRef.current) {
        window.clearInterval(processingTimerRef.current);
        processingTimerRef.current = null;
      }
    };
  }, [aiThinking, typingMessageId]);

  const createConversation = async (collRef?: ReturnType<typeof collection>) => {
    const ref = collRef || conversationsRef?.collection;
    if (!ref) return;

    const id = nanoid();
    const docRef = doc(ref, id);
    const initialMessages = [DEFAULT_ASSISTANT_MESSAGE];
    await setDoc(docRef, {
      title: 'Nova conversa',
      messages: sanitizeMessagesForFirestore(initialMessages),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessagePreview: '',
      lastAttachmentType: null,
    });

    const nextConv: Conversation = {
      id,
      title: 'Nova conversa',
      lastMessagePreview: '',
      lastAttachmentType: undefined,
    };
    setConversations((prev) => [nextConv, ...prev]);
    setActiveConversationId(id);
    setActiveConversationRef(docRef);
    setMessages(initialMessages);
    setActiveView('chat');
  };

  const loadConversation = async (collRef: ReturnType<typeof collection>, id: string) => {
    const docRef = doc(collRef, id);
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      const data = snap.data() as { messages?: ChatMessage[]; title?: string };
      const rawMessages = data.messages?.length ? data.messages : [DEFAULT_ASSISTANT_MESSAGE];
      const normalizedMessages = rawMessages.map((msg) => {
        if (msg.meta?.fileType !== 'pdf') return msg;
        const downloadUrl = msg.meta.fileDownloadUrl || toCloudinaryDownloadUrl(msg.meta.fileUrl);
        if (downloadUrl === msg.meta.fileDownloadUrl) return msg;
        return {
          ...msg,
          meta: {
            ...(msg.meta || {}),
            fileDownloadUrl: downloadUrl,
          },
        };
      });
      setMessages(normalizedMessages);
      messagesRef.current = normalizedMessages;

      const hadLegacyPdfWithoutDownload = normalizedMessages.some(
        (msg, idx) => msg.meta?.fileType === 'pdf' && normalizedMessages[idx].meta?.fileDownloadUrl !== rawMessages[idx]?.meta?.fileDownloadUrl
      );
      if (hadLegacyPdfWithoutDownload) {
        await setDoc(
          docRef,
          { messages: sanitizeMessagesForFirestore(normalizedMessages), updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
    } else {
      setMessages([DEFAULT_ASSISTANT_MESSAGE]);
      messagesRef.current = [DEFAULT_ASSISTANT_MESSAGE];
    }
    setActiveConversationId(id);
    setActiveConversationRef(docRef);
    setActiveView('chat');
    setIsSidebarOpen(false);
  };

  const onSelectConversation = async (id: string) => {
    if (!conversationsRef) return;
    await loadConversation(conversationsRef.collection, id);
  };

  const onDeleteConversation = async (id: string) => {
    if (!conversationsRef) return;

    try {
      await deleteDoc(doc(conversationsRef.collection, id));
      const remaining = conversations.filter((c) => c.id !== id);
      setConversations(remaining);

      if (activeConversationId === id) {
        if (remaining.length > 0) {
          await loadConversation(conversationsRef.collection, remaining[0].id);
        } else {
          await createConversation(conversationsRef.collection);
        }
      }

      toast.success('Chat excluído');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao excluir chat');
    }
  };

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await handleLogout();
      toast.success('Logout realizado com sucesso');
      setLocation('/');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao fazer logout');
    } finally {
      setLoggingOut(false);
    }
  };

  const onEditProfileName = async () => {
    const current = userProfile?.fullName || '';
    const next = window.prompt('Digite seu nome:', current)?.trim();
    if (!next || next === current || !auth.currentUser) return;
    try {
      const userDocRef = doc(db, 'users', auth.currentUser.uid);
      await setDoc(userDocRef, { fullName: next, updatedAt: serverTimestamp() }, { merge: true });
      setUserProfile((prev) => (prev ? { ...prev, fullName: next } : prev));
      toast.success('Nome atualizado');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao atualizar nome');
    }
  };

  const onResetPassword = async () => {
    const email = auth.currentUser?.email || userProfile?.email;
    if (!email) {
      toast.error('Email não encontrado para redefinição de senha');
      return;
    }
    try {
      await sendPasswordResetEmail(auth, email);
      toast.success(`Email de redefinição enviado para ${email}`);
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao enviar email de redefinição');
    }
  };

  const clearAttachments = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
    setPendingMapImageUrl(null);
    setPendingMapContext(undefined);
  };

  const onPickAttachment = (file: File | null) => {
    if (!file) {
      clearAttachments();
      return;
    }
    const mime = (file.type || '').toLowerCase();
    const name = (file.name || '').toLowerCase();
    const isImage = mime.startsWith('image/');
    const isPdf = mime === 'application/pdf' || name.endsWith('.pdf') || mime.includes('pdf');

    if (isImage) {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setPdfFile(null);
      setPendingMapImageUrl(null);
      setPendingMapContext(undefined);
      return;
    }
    if (isPdf) {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageFile(null);
      setImagePreview(null);
      setPdfFile(file);
      setPendingMapImageUrl(null);
      setPendingMapContext(undefined);
      return;
    }
    toast.error('Selecione uma imagem ou PDF');
  };

  const uploadImageIfNeeded = async (): Promise<string | null> => {
    if (!imageFile) return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler a imagem.'));
      reader.readAsDataURL(imageFile);
    });

    const res = await fetch('/api/upload-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl,
        filename: imageFile.name,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Falha ao enviar imagem');
    }

    const data = await res.json();
    return data?.secure_url || null;
  };

  const uploadPdfIfNeeded = async (): Promise<{ url: string; extractedText: string; downloadUrl: string; pages: number } | null> => {
    if (!pdfFile) return null;

    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler o PDF.'));
      reader.readAsDataURL(pdfFile);
    });

    const res = await fetch('/api/upload-file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataUrl,
        filename: pdfFile.name,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || 'Falha ao enviar PDF');
    }

    const data = await res.json();
    if (!data?.secure_url) return null;
    return {
      url: data.secure_url as string,
      extractedText: (data.extracted_text as string) || '',
      downloadUrl: (data.download_url as string) || (data.secure_url as string),
      pages: Number(data.pages || 0),
    };
  };

  const openMapDialog = async () => {
    setMapDialogOpen(true);
    setMapPreviewDataUrl('');
    setMapLoading(true);
    try {
      const res = await fetch('/api/map/capabilities');
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Falha ao carregar camadas de mapa');
      }
      const data = await res.json();
      const layers = (data?.layers || []) as MapLayerOption[];
      setMapLayers(layers);
      const layerNames = new Set(layers.map((l) => l.name));
      const preferred = selectedMapLayer && layerNames.has(selectedMapLayer) ? selectedMapLayer : '';
      const chosenLayer = preferred || data?.defaultLayer || layers[0]?.name || '';
      setSelectedMapLayer(chosenLayer);
      if (chosenLayer) {
        setTimeout(() => {
          refreshMapPreview(chosenLayer, mapBbox);
        }, 0);
      }
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao abrir mapa');
    } finally {
      setMapLoading(false);
    }
  };

  const refreshMapPreview = async (layerName?: string, bboxValue?: [number, number, number, number]) => {
    const effectiveLayer = layerName || selectedMapLayer;
    const effectiveBbox = bboxValue || mapBbox;
    if (!effectiveLayer) return;
    setMapPreviewLoading(true);
    try {
      const res = await fetch('/api/map/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: effectiveLayer,
          bbox: effectiveBbox,
          crs: 'EPSG:4326',
          width: 1100,
          height: 700,
          format: 'image/png',
        }),
      });
      if (!res.ok) {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          const text = await res.text();
          throw new Error(text || 'Falha ao carregar prévia do mapa');
        }
        if (payload?.availableLayers?.length) {
          const fallbackLayer = String(payload.availableLayers[0] || '');
          if (fallbackLayer) {
            setSelectedMapLayer(fallbackLayer);
            toast.error(`Layer inválida. Usando '${fallbackLayer}'.`);
            await refreshMapPreview(fallbackLayer, effectiveBbox);
            return;
          }
        }
        throw new Error(payload?.error || 'Falha ao carregar prévia do mapa');
      }
      const data = await res.json();
      setMapPreviewDataUrl(String(data?.dataUrl || ''));
    } catch (error: any) {
      const directUrl = buildDirectWmsGetMapUrl(effectiveLayer, effectiveBbox, 1100, 700, 'image/png');
      setMapPreviewDataUrl(directUrl);
      toast.error('WMS via backend falhou. Usando prévia direta do WMS.');
    } finally {
      setMapPreviewLoading(false);
    }
  };

  const captureVisibleMapArea = async () => {
    if (!selectedMapLayer) {
      toast.error('Selecione uma camada');
      return;
    }

    const bbox: [number, number, number, number] = mapBbox;

    setMapCapturing(true);
    try {
      const res = await fetch('/api/map/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          layerName: selectedMapLayer,
          bbox,
          crs: 'EPSG:4326',
          width: 1280,
          height: 960,
          format: 'image/png',
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Falha ao capturar imagem do mapa');
      }

      const data = await res.json();
      const dataUrl = String(data?.dataUrl || '');
      if (!dataUrl) throw new Error('Imagem do mapa não retornou dataUrl');

      const blob = await fetch(dataUrl).then((r) => r.blob());
      const file = new File([blob], `mapa-${Date.now()}.png`, { type: blob.type || 'image/png' });

      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageFile(file);
      setImagePreview(URL.createObjectURL(file));
      setPdfFile(null);
      setPendingMapContext((data?.mapContext as ChatMessage['meta']['mapContext']) || undefined);
      setMapDialogOpen(false);
      toast.success('Área do mapa anexada ao chat');
    } catch (error: any) {
      const directUrl = buildDirectWmsGetMapUrl(selectedMapLayer, bbox, 1280, 960, 'image/png');
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageFile(null);
      setImagePreview(null);
      setPdfFile(null);
      setPendingMapImageUrl(directUrl);
      setPendingMapContext({
        layerName: selectedMapLayer,
        bbox,
        crs: 'EPSG:4326',
        source: 'SEMA_WMS',
        width: 1280,
        height: 960,
      });
      setMapDialogOpen(false);
      toast.error('Captura via backend falhou. Usando URL direta do WMS no anexo.');
    } finally {
      setMapCapturing(false);
    }
  };

  const onPickAreaFile = async (file: File | null) => {
    if (!file) return;
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.kml') && !fileName.endsWith('.zip')) {
      toast.error('Envie um arquivo .kml ou .zip (shapefile)');
      return;
    }
    try {
      if (fileName.endsWith('.kml')) {
        const text = await file.text();
        const bbox = parseKmlBboxOnClient(text);
        setMapBbox(bbox);
        await refreshMapPreview(undefined, bbox);
        toast.success('Área do KML carregada no frontend');
        return;
      }
      if (fileName.endsWith('.zip')) {
        try {
          const bbox = await parseZipShpBboxOnClient(file);
          setMapBbox(bbox);
          await refreshMapPreview(undefined, bbox);
          toast.success('BBOX do shapefile ZIP carregada no frontend');
          return;
        } catch (localErr) {
          // Fallback to backend parser if frontend parser can't handle this zip flavor.
        }
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Falha ao ler arquivo de área'));
        reader.readAsDataURL(file);
      });
      const res = await fetch('/api/geometry/bbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataUrl, filename: file.name }),
      });
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Endpoint /api/geometry/bbox não encontrado. Atualize o backend na Render.');
        }
        const text = await res.text();
        throw new Error(text || 'Falha ao processar arquivo de área');
      }
      const data = await res.json();
      const bbox = data?.bbox as [number, number, number, number];
      if (!bbox || bbox.length !== 4) throw new Error('BBox inválida retornada do arquivo');
      setMapBbox(bbox);
      await refreshMapPreview(undefined, bbox);
      toast.success('Área carregada do arquivo e aplicada no mapa');
    } catch (error: any) {
      toast.error(error?.message || 'Erro ao carregar arquivo de área');
    }
  };

  const updateConversationMeta = async (updatedMessages: ChatMessage[], lastUserText: string) => {
    if (!activeConversationRef) return;
    const title =
      conversations.find((c) => c.id === activeConversationId)?.title || 'Nova conversa';
    const shouldSetTitle = title === 'Nova conversa' && lastUserText.trim().length > 0;
    const nextTitle = shouldSetTitle
      ? lastUserText.trim().split(/\s+/).slice(0, 6).join(' ')
      : title;

    const lastUser = [...updatedMessages].reverse().find((m) => m.role === 'user');
    const lastAttachmentType = lastUser?.meta?.fileType;

    await setDoc(
      activeConversationRef,
      {
        title: nextTitle,
        messages: sanitizeMessagesForFirestore(updatedMessages),
        updatedAt: serverTimestamp(),
        lastMessagePreview: lastUserText.slice(0, 120),
        lastAttachmentType: lastAttachmentType || null,
      },
      { merge: true }
    );

    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === activeConversationId
            ? {
                ...c,
                title: nextTitle,
                lastMessagePreview: lastUserText.slice(0, 120),
                lastAttachmentType: lastAttachmentType,
              }
            : c
        )
        .sort((a, b) => (a.id === activeConversationId ? -1 : b.id === activeConversationId ? 1 : 0))
    );
  };

  const updateSettings = async (next: Partial<UserSettings>) => {
    const updated = { ...settings, ...next };
    setSettings(updated);
    if (settingsRef) {
      await setDoc(settingsRef, updated, { merge: true });
    }
  };

  const splitThinkContent = (raw: string) => {
    const thinkRegex = /<think>([\s\S]*?)<\/think>/gi;
    const thinkParts: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = thinkRegex.exec(raw)) !== null) {
      thinkParts.push((match[1] || '').trim());
    }
    const cleanText = raw.replace(thinkRegex, '').trim();
    return {
      cleanText: cleanText || 'Desculpe, não consegui formular uma resposta.',
      thinkingText: thinkParts.join('\n\n').trim(),
    };
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Falha ao ler arquivo anexado.'));
      reader.readAsDataURL(file);
    });

  const patchMessageMeta = async (messageId: string, patch: Partial<NonNullable<ChatMessage['meta']>>, lastUserText: string) => {
    const updatedMessages = messagesRef.current.map((msg) =>
      msg.id === messageId
        ? {
            ...msg,
            meta: {
              ...(msg.meta || {}),
              ...patch,
            },
          }
        : msg
    );
    messagesRef.current = updatedMessages;
    setMessages(updatedMessages);
    await updateConversationMeta(updatedMessages, lastUserText || 'Nova conversa');
  };

  const handleSend = async () => {
    if ((!input.trim() && !imageFile && !pdfFile && !pendingMapImageUrl) || sending) return;
    if (!activeConversationRef && conversationsRef) {
      await createConversation(conversationsRef.collection);
    }

    const userText = input.trim();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const selectedImageFile = imageFile;
    const selectedPdfFile = pdfFile;
    const selectedMapImageUrl = pendingMapImageUrl;

    let userPayloadText = userText;
    if (selectedImageFile || selectedMapImageUrl) {
      userPayloadText =
        `${userText || 'Analise a imagem anexada.'}

` +
        'Contexto: a imagem foi anexada pelo usuário para interpretação ambiental/florestal. ' +
        'Descreva achados objetivos, limitações e próximos dados necessários.' +
        (pendingMapContext
          ? `\n\nContexto do mapa: camada=${pendingMapContext.layerName}; bbox=${pendingMapContext.bbox.join(
              ','
            )}; crs=${pendingMapContext.crs}; fonte=${pendingMapContext.source}.`
          : '');
    } else if (selectedPdfFile) {
      userPayloadText =
        `${userText || 'Analise o PDF anexado.'}

` +
        `Nome do arquivo: ${selectedPdfFile.name || 'documento.pdf'}
` +
        'O documento está em processamento. Faça análise preliminar e refine com o texto extraído quando disponível.';
    }

    const userMessage: ChatMessage = {
      id: nanoid(),
      role: 'user',
      text: userText || (selectedImageFile || selectedMapImageUrl ? 'Analise a imagem.' : 'Analise o PDF.'),
      time,
      meta: selectedImageFile || selectedMapImageUrl
        ? {
            fileType: 'image',
            fileName: selectedImageFile?.name || 'mapa-wms.png',
            uploadStatus: selectedMapImageUrl ? 'done' : 'uploading',
            imageUrl: selectedMapImageUrl || undefined,
            mapContext: pendingMapContext,
          }
        : selectedPdfFile
        ? { fileType: 'pdf', fileName: selectedPdfFile?.name || 'documento.pdf', uploadStatus: 'uploading' }
        : undefined,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    messagesRef.current = nextMessages;
    setInput('');
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
    setPendingMapImageUrl(null);
    setPendingMapContext(undefined);
    setSending(true);
    setUploading(Boolean(selectedImageFile || selectedPdfFile));
    setAiThinking(true);
    const typingId = nanoid();
    setTypingMessageId(typingId);
    setTypingText('');
    setLiveThinkingText('');
    setLiveThinkingTarget('');
    setProcessingHintIndex(0);

    const currentUserMessageId = userMessage.id;

    const imageUploadPromise = selectedImageFile ? uploadImageIfNeeded() : Promise.resolve(selectedMapImageUrl || null);
    const pdfUploadPromise = selectedPdfFile ? uploadPdfIfNeeded() : Promise.resolve(null);

    Promise.allSettled([imageUploadPromise, pdfUploadPromise]).finally(() => setUploading(false));

    imageUploadPromise
      .then(async (uploadedImageUrl) => {
        if (!uploadedImageUrl) return;
        await patchMessageMeta(
          currentUserMessageId,
          { imageUrl: uploadedImageUrl, uploadStatus: 'done' },
          userText || 'Nova conversa'
        );
      })
      .catch(async () => {
        await patchMessageMeta(currentUserMessageId, { uploadStatus: 'error' }, userText || 'Nova conversa');
      });

    pdfUploadPromise
      .then(async (uploadedPdf) => {
        if (!uploadedPdf) return;
        await patchMessageMeta(
          currentUserMessageId,
          {
            fileUrl: uploadedPdf.url,
            fileDownloadUrl: uploadedPdf.downloadUrl,
            uploadStatus: 'done',
          },
          userText || 'Nova conversa'
        );
      })
      .catch(async () => {
        await patchMessageMeta(currentUserMessageId, { uploadStatus: 'error' }, userText || 'Nova conversa');
      });

    let imageDataUrlForAi: string | null = null;
    let pdfDataUrlForAi: string | null = null;
    try {
      if (selectedImageFile) imageDataUrlForAi = await readFileAsDataUrl(selectedImageFile);
      if (selectedPdfFile) pdfDataUrlForAi = await readFileAsDataUrl(selectedPdfFile);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao ler arquivo anexado');
    }

    const crossChatContext = buildCrossChatContext(activeConversationId, userText);
    const contextualMessages = nextMessages.slice(-40);
    const apiMessages = [
      systemPrompt,
      ...(crossChatContext ? [{ role: 'system', content: crossChatContext }] : []),
      ...contextualMessages.map((m) => {
        if (m.role === 'user' && (m.meta?.imageUrl || (m.id === currentUserMessageId && imageDataUrlForAi))) {
          const imageUrlForModel = m.id === currentUserMessageId ? imageDataUrlForAi || m.meta?.imageUrl : m.meta?.imageUrl;
          const promptText =
            m.id === currentUserMessageId
              ? userPayloadText
              : `${m.text || 'Imagem anexada.'}

Arquivo de imagem previamente anexado pelo usuário.`;
          return {
            role: 'user',
            content: [
              { type: 'text', text: promptText },
              { type: 'image_url', image_url: { url: imageUrlForModel } },
            ],
          };
        }
        if (m.role === 'user' && m.meta?.fileType === 'pdf') {
          if (m.id === currentUserMessageId) {
            return { role: 'user', content: userPayloadText };
          }
          const historicalPdfContext =
            `PDF previamente anexado pelo usuário.
` +
            `Nome do arquivo: ${m.meta.fileName || 'documento.pdf'}
` +
            `Link: ${m.meta.fileUrl || ''}
` +
            `Resumo do pedido original: ${m.text || 'Analisar PDF.'}`;
          return { role: 'user', content: historicalPdfContext };
        }
        return { role: m.role === 'ai' ? 'assistant' : 'user', content: m.text };
      }),
    ];

    try {
      const res = await fetch('/api/chat-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          model: selectedModel,
          pendingPdf:
            selectedPdfFile && pdfDataUrlForAi
              ? { dataUrl: pdfDataUrlForAi, filename: selectedPdfFile.name }
              : undefined,
        }),
      });

      if (!res.ok) {
        if (res.status === 404) {
          const fallback = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: apiMessages, model: selectedModel }),
          });
          if (!fallback.ok) {
            const fallbackText = await fallback.text();
            throw new Error(fallbackText || 'Falha ao consultar IA');
          }
          const fallbackData = await fallback.json();
          const parsedFallback = splitThinkContent(String(fallbackData?.content || ''));
          const aiMessage: ChatMessage = {
            id: typingId,
            role: 'ai',
            text: parsedFallback.cleanText,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            meta: {
              model: fallbackData?.model || selectedModel,
              thinkingText: parsedFallback.thinkingText || undefined,
            },
          };
          setAiThinking(false);
          setTypingMessageId(null);
          setTypingText('');
          setLiveThinkingText('');
          setLiveThinkingTarget('');
          const latestMessages = messagesRef.current.length ? messagesRef.current : nextMessages;
          const updatedMessages = [...latestMessages.filter((m) => m.id !== typingId), aiMessage];
          setMessages(updatedMessages);
          messagesRef.current = updatedMessages;
          await updateConversationMeta(updatedMessages, userText || 'Nova conversa');
          return;
        }

        const text = await res.text();
        throw new Error(text || 'Falha ao consultar IA');
      }

      if (!res.body) {
        throw new Error('Resposta de streaming inválida');
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finalContent = '';
      let finalThinking = '';
      let usedModel = selectedModel;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          let chunk: any;
          try {
            chunk = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (typeof chunk.model === 'string' && chunk.model) {
            usedModel = chunk.model;
          }
          if (typeof chunk.thinkingText === 'string') {
            finalThinking = chunk.thinkingText;
            setLiveThinkingTarget(chunk.thinkingText);
          }
          if (typeof chunk.content === 'string') {
            finalContent = chunk.content;
            setTypingText(chunk.content);
            setAiThinking(false);
          }
        }
      }

      if (buffer.trim()) {
        const trailing = buffer.trim().split('\n');
        for (const line of trailing) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            if (typeof chunk.model === 'string' && chunk.model) usedModel = chunk.model;
            if (typeof chunk.thinkingText === 'string') {
              finalThinking = chunk.thinkingText;
              setLiveThinkingTarget(chunk.thinkingText);
            }
            if (typeof chunk.content === 'string') {
              finalContent = chunk.content;
              setTypingText(chunk.content);
            }
          } catch {
            // ignore trailing malformed line
          }
        }
      }

      const aiMessage: ChatMessage = {
        id: typingId,
        role: 'ai',
        text: finalContent || 'Desculpe, não consegui responder agora.',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        meta: {
          model: usedModel,
          thinkingText: finalThinking || undefined,
        },
      };
      setAiThinking(false);
      setTypingMessageId(null);
      setTypingText('');
      setLiveThinkingText('');
      setLiveThinkingTarget('');
      const latestMessages = messagesRef.current.length ? messagesRef.current : nextMessages;
      const updatedMessages = [...latestMessages.filter((m) => m.id !== typingId), aiMessage];
      setMessages(updatedMessages);
      messagesRef.current = updatedMessages;
      await updateConversationMeta(updatedMessages, userText || 'Nova conversa');
    } catch (error: any) {
      toast.error(error.message || 'Erro ao conversar com a IA');
      setAiThinking(false);
      setTypingMessageId(null);
      setTypingText('');
      setLiveThinkingText('');
      setLiveThinkingTarget('');
    } finally {
      setSending(false);
    }
  };

  const onClearChat = async () => {
    const cleared: ChatMessage[] = [DEFAULT_ASSISTANT_MESSAGE];
    setMessages(cleared);
    if (activeConversationRef) {
      await setDoc(
        activeConversationRef,
        { messages: sanitizeMessagesForFirestore(cleared), updatedAt: serverTimestamp() },
        { merge: true }
      );
    }
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedModelLabel =
    selectedModel === 'auto'
      ? 'Auto (Florestal)'
      : models.find((m) => m.id === selectedModel)?.label || selectedModel;

  // Custom components
  const CustomSelect = ({ label, icon: Icon, options, value, onChange }: any) => (
    <div className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
      <div className="flex items-center gap-3">
        {Icon && <Icon size={16} className="text-slate-500 group-hover:text-emerald-400 transition-colors" />}
        <span className="text-slate-300 text-sm">{label}</span>
      </div>
      <div className="relative">
        <select
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          className="appearance-none bg-[#050b08] border border-white/10 rounded-lg text-xs text-slate-300 py-2 pl-3 pr-8 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 cursor-pointer transition-all hover:border-emerald-500/30"
        >
          {options.map((opt: string, idx: number) => (
            <option key={idx} value={opt} className="bg-[#0e1612] text-slate-200 py-2">
              {opt}
            </option>
          ))}
        </select>
        <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
      </div>
    </div>
  );

  const ToggleSwitch = ({ label, sub, isActive, onToggle }: any) => (
    <div
      className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors cursor-pointer group"
      onClick={() => onToggle?.(!isActive)}
    >
      <div className="flex flex-col">
        <span className="text-slate-300 text-sm group-hover:text-white transition-colors">{label}</span>
        {sub && <span className="text-slate-500 text-[10px]">{sub}</span>}
      </div>
      <div
        className={`w-10 h-5 rounded-full relative transition-colors ${
          isActive ? 'bg-emerald-600 shadow-lg shadow-emerald-500/20' : 'bg-slate-700'
        }`}
      >
        <div
          className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${
            isActive ? 'left-6' : 'left-1'
          }`}
        />
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-screen w-full bg-[#050b08] text-slate-200 items-center justify-center">
        Carregando...
      </div>
    );
  }

  return (
    <div
      className="flex h-screen w-full bg-[#050b08] text-slate-200 overflow-hidden font-sans selection:bg-emerald-500/30 transition-colors duration-300"
      style={{ fontSize: 'var(--app-font-size, 15px)' }}
    >
      <div className="fixed inset-0 z-0 pointer-events-none">
        <div
          className="absolute top-[-10%] left-[-10%] w-[50vw] h-[50vw] bg-emerald-900/20 rounded-full blur-[120px] mix-blend-screen animate-pulse"
          style={{ animationDuration: '10s' }}
        />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-green-900/10 rounded-full blur-[100px] mix-blend-screen" />
      </div>

      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden backdrop-blur-sm"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      <aside
        className={`
          fixed lg:relative z-30 flex flex-col h-full w-80 
          bg-[#0a120e]/80 backdrop-blur-xl border-r border-white/5
          transition-transform duration-300 ease-in-out
          ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0 lg:w-20 xl:w-80'}
        `}
      >
        <div className="p-6 flex items-center gap-3 cursor-pointer" onClick={() => setActiveView('chat')}>
          <div className="relative group">
            <div className="absolute inset-0 bg-emerald-500 blur opacity-40 group-hover:opacity-60 transition-opacity rounded-lg"></div>
            <div className="relative bg-gradient-to-br from-emerald-400 to-green-600 p-2.5 rounded-xl shadow-lg shadow-emerald-900/50">
              <Leaf size={24} className="text-white" fill="currentColor" fillOpacity={0.2} />
            </div>
          </div>
          <div className="flex flex-col xl:flex lg:hidden overflow-hidden">
            <span className="font-bold text-lg tracking-tight text-white">GeoForest IA</span>
            <span className="text-xs text-emerald-400/80 font-medium tracking-wide">INTELLIGENCE</span>
          </div>
        </div>

        <div className="px-4 mb-6 space-y-2">
          <button
            onClick={() => createConversation()}
            className="w-full group relative overflow-hidden rounded-xl bg-emerald-600 hover:bg-emerald-500 transition-all duration-300 p-[1px]"
          >
            <div className="relative flex items-center justify-center gap-2 bg-[#0f241a] group-hover:bg-transparent text-emerald-100 py-3 rounded-[11px] transition-colors">
              <Plus size={20} />
              <span className="font-medium xl:block lg:hidden">Novo chat</span>
            </div>
          </button>
          <div className="relative">
            <Search size={16} className="text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar conversa..."
              className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-emerald-400 focus:ring-emerald-400/40"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 space-y-1 custom-scrollbar">
          {filteredConversations.map((conv) => (
            <div
              key={conv.id}
              className={`w-full flex items-center gap-2 p-2 rounded-lg transition-colors group ${
                conv.id === activeConversationId ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-slate-400'
              }`}
            >
              <button
                onClick={() => onSelectConversation(conv.id)}
                className="flex-1 min-w-0 text-left flex items-center gap-3"
              >
                <MessageSquare
                  size={18}
                  className={conv.id === activeConversationId ? 'text-emerald-400' : 'text-slate-500 group-hover:text-emerald-400'}
                />
                <div className="overflow-hidden xl:block lg:hidden">
                  <p className="text-sm text-slate-300 truncate group-hover:text-white transition-colors inline-flex items-center gap-2">
                    {conv.lastAttachmentType === 'pdf' && <FileText size={12} className="text-emerald-300 shrink-0" />}
                    {conv.lastAttachmentType === 'image' && <ImagePlus size={12} className="text-emerald-300 shrink-0" />}
                    <span className="truncate">{conv.title}</span>
                  </p>
                  {conv.lastMessagePreview && <p className="text-[10px] text-slate-600 truncate">{conv.lastMessagePreview}</p>}
                </div>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(conv.id);
                }}
                className="shrink-0 p-1.5 rounded-md text-slate-500 hover:text-red-400 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition"
                title="Excluir chat"
                aria-label="Excluir chat"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        <div className="p-4 border-t border-white/5">
          <button
            onClick={() => setActiveView('settings')}
            className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group mb-2"
          >
            <Settings size={18} className="text-slate-500 group-hover:text-emerald-400 transition-colors" />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors xl:block lg:hidden">
              Configurações
            </span>
          </button>
          <div className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-white/5 transition-colors group">
            <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center ring-2 ring-transparent group-hover:ring-emerald-500/30 transition-all">
              <span className="font-bold text-white text-sm">
                {(userProfile?.fullName || 'U')
                  .split(' ')
                  .map((n) => n[0])
                  .slice(0, 2)
                  .join('')}
              </span>
            </div>
            <div className="flex-1 text-left overflow-hidden xl:block lg:hidden">
              <p className="text-sm font-medium text-white truncate">{userProfile?.fullName || 'Usuário'}</p>
              <p className="text-xs text-emerald-400/70">{userProfile?.email || 'Plano Pro'}</p>
            </div>
            <LogOut size={18} className="text-slate-500 group-hover:text-red-400 transition-colors xl:block lg:hidden" />
          </div>
        </div>
      </aside>

      <main
        className={`flex-1 flex flex-col relative h-full w-full overflow-hidden ${
          mapDialogOpen ? 'z-[220]' : 'z-10'
        }`}
      >
        <header className="h-16 flex-shrink-0 flex items-center justify-between px-6 border-b border-white/5 bg-[#050b08]/50 backdrop-blur-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="lg:hidden p-2 text-slate-400 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-emerald-400 fill-current" />
              <span className="font-medium text-slate-200">
                {activeView === 'chat' ? 'GeoForest v2.0' : 'Configurações'}
              </span>
              {activeView === 'chat' && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-bold text-emerald-400 uppercase tracking-wide">
                  Online
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2"></div>
        </header>

        {activeView === 'chat' ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth custom-scrollbar relative z-0">
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg) => {
                  const parsedFromText = splitThinkContent(msg.text || '');
                  const displayThinking = msg.meta?.thinkingText || parsedFromText.thinkingText;
                  const displayText = parsedFromText.cleanText;
                  return (
                  <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'flex-row-reverse' : ''} animate-fade-in-up`}>
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                        msg.role === 'ai'
                          ? 'bg-gradient-to-br from-emerald-500 to-green-700 shadow-lg shadow-emerald-900/50'
                          : 'bg-slate-700'
                      }`}
                    >
                      {msg.role === 'ai' ? <Leaf size={14} className="text-white" /> : <User size={14} className="text-slate-300" />}
                    </div>
                    <div
                      className={`
                        relative max-w-[85%] lg:max-w-[75%] p-4 rounded-2xl
                        ${msg.role === 'ai'
                          ? 'bg-[#131f18]/80 border border-emerald-500/10 text-slate-200 rounded-tl-sm'
                          : 'bg-emerald-600 text-white rounded-tr-sm shadow-md shadow-emerald-900/20'
                        }
                      `}
                    >
                      {(msg.meta?.fileType === 'pdf' || msg.meta?.fileType === 'image') && (
                        <div
                          role={msg.meta?.fileType === 'pdf' && msg.meta?.fileUrl ? 'button' : undefined}
                          tabIndex={msg.meta?.fileType === 'pdf' && msg.meta?.fileUrl ? 0 : -1}
                          onClick={() => {
                            const pdfUrl = msg.meta?.fileUrl || msg.meta?.fileDownloadUrl;
                            if (msg.meta?.fileType === 'pdf' && pdfUrl) {
                              window.open(toFileProxyUrl(pdfUrl, msg.meta.fileName, 'download'), '_blank', 'noopener,noreferrer');
                            }
                          }}
                          onKeyDown={(e) => {
                            const pdfUrl = msg.meta?.fileUrl || msg.meta?.fileDownloadUrl;
                            if ((e.key === 'Enter' || e.key === ' ') && msg.meta?.fileType === 'pdf' && pdfUrl) {
                              e.preventDefault();
                              window.open(toFileProxyUrl(pdfUrl, msg.meta.fileName, 'download'), '_blank', 'noopener,noreferrer');
                            }
                          }}
                          className={`mb-2 inline-flex max-w-[260px] items-center gap-2 rounded-xl px-2.5 py-2 text-[11px] border ${
                            msg.role === 'user'
                              ? 'bg-emerald-700/45 border-emerald-300/30 text-emerald-50'
                              : 'bg-[#0f1713] border-white/10 text-slate-200'
                          } ${msg.meta?.fileType === 'pdf' && (msg.meta?.fileUrl || msg.meta?.fileDownloadUrl) ? 'cursor-pointer hover:border-emerald-400/40' : ''}`}
                        >
                          <div
                            className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${
                              msg.meta?.fileType === 'pdf'
                                ? 'bg-red-500/20 text-red-300'
                                : 'bg-emerald-500/20 text-emerald-300'
                            }`}
                          >
                            {msg.meta?.fileType === 'pdf' ? <FileText size={13} /> : <ImagePlus size={13} />}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate font-medium">{msg.meta?.fileName || (msg.meta?.fileType === 'pdf' ? 'Documento PDF' : 'Imagem anexada')}</p>
                            <p className={`text-[10px] ${msg.role === 'user' ? 'text-emerald-100/80' : 'text-slate-500'}`}>
                              {msg.meta?.fileType === 'pdf' ? 'Documento' : 'Imagem'}
                            </p>
                          </div>
                        </div>
                      )}
                      {msg.role === 'ai' && displayThinking && (
                        <div className="mb-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-[10px] uppercase tracking-wider text-emerald-300/80">
                              Pensamento da IA
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedThinking((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                              }
                              className="text-[10px] text-emerald-300 hover:text-emerald-200"
                            >
                              {expandedThinking[msg.id] ? 'Ocultar' : 'Expandir'}
                            </button>
                          </div>
                          {expandedThinking[msg.id] && (
                            <p className="mt-2 text-xs leading-relaxed text-slate-300 whitespace-pre-wrap">
                              {displayThinking}
                            </p>
                          )}
                        </div>
                      )}
                      {msg.role === 'ai' ? (
                        <div className="chat-markdown text-sm leading-relaxed">{renderRichText(displayText)}</div>
                      ) : (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{displayText}</p>
                      )}
                      {msg.meta?.fileType === 'image' && msg.meta.imageUrl && (
                        <img src={msg.meta.imageUrl} alt="Imagem" className="mt-3 rounded-xl max-h-52 border border-white/10" />
                      )}
                      {msg.meta?.fileType === 'pdf' && !msg.meta?.fileUrl && !msg.meta?.fileDownloadUrl && (
                        <div className="mt-3">
                          <span className="inline-flex items-center gap-2 text-xs text-slate-400">
                            <FileText size={14} /> Enviando PDF...
                          </span>
                        </div>
                      )}
                      <span
                        className={`text-[10px] absolute bottom-2 right-4 opacity-50 ${
                          msg.role === 'user' ? 'text-emerald-100' : 'text-slate-500'
                        }`}
                      >
                        {msg.time}
                      </span>
                    </div>
                  </div>
                )})}
                {(typingMessageId || aiThinking) && (
                  <div className="flex gap-4 animate-fade-in-up">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-[#203127] border border-emerald-500/20">
                      <Sparkles size={14} className="text-emerald-300" />
                    </div>
                    <div className="relative max-w-[85%] lg:max-w-[75%] p-4 rounded-2xl bg-[#0f1713]/90 border border-dashed border-emerald-500/35 text-slate-200">
                      <div className="mb-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-emerald-300/80 mb-1">
                          Pensamento da IA
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-slate-300/90">
                          {liveThinkingText ||
                            [
                              'Lendo sua solicitação',
                              'Analisando contexto ambiental',
                              'Selecionando estratégia de resposta',
                              'Consolidando resultado',
                            ][processingHintIndex]}
                        </p>
                      </div>
                      <div className="chat-markdown text-sm leading-relaxed text-slate-200/95 min-h-5">
                        {renderRichText(typingText || 'Gerando resposta...')}
                      </div>
                      <div className="flex items-center gap-2 mt-2">
                        <span className="typing-dot"></span>
                        <span className="typing-dot"></span>
                        <span className="typing-dot"></span>
                      </div>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="p-4 pb-6 w-full flex-shrink-0 relative z-30">
              <div className="max-w-3xl mx-auto relative group z-30">
                <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl blur-sm group-focus-within:bg-emerald-500/10 transition-all duration-500" />
                <div className="relative bg-[#0e1612]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-visible focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all duration-300">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    placeholder="Descreva sua análise ambiental ou anexe um mapa..."
                    className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 px-4 py-4 min-h-[60px] max-h-[200px] resize-none focus:outline-none text-sm leading-relaxed custom-scrollbar"
                    rows={1}
                    style={{ height: input ? `${Math.min(input.split('\n').length * 24 + 32, 200)}px` : '60px' }}
                  />
                  {(imageFile || pdfFile || pendingMapImageUrl) && (
                    <div className="px-4 pb-2">
                      <div className="inline-flex max-w-[320px] items-center gap-2 px-2.5 py-2 rounded-xl bg-[#0c1511] border border-white/10 text-xs text-slate-200 shadow-sm">
                        <div
                          className={`h-7 w-7 shrink-0 rounded-lg flex items-center justify-center ${
                            imageFile || pendingMapImageUrl ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
                          }`}
                        >
                          {imageFile || pendingMapImageUrl ? <ImagePlus size={13} /> : <FileText size={13} />}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium">{imageFile?.name || pdfFile?.name || 'mapa-wms.png'}</p>
                          <p className="text-[10px] text-slate-500">
                            {imageFile || pendingMapImageUrl ? 'Imagem pronta para envio' : 'PDF pronto para envio'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => clearAttachments()}
                          className="ml-1 h-6 w-6 shrink-0 rounded-md text-slate-500 hover:text-red-300 hover:bg-red-500/10"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center justify-between px-3 pb-3 pt-1">
                    <div className="flex items-center gap-2">
                      <label className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs cursor-pointer">
                        <ImagePlus size={16} className="text-emerald-300" />
                        Anexar
                        <input
                          type="file"
                          accept="image/*,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            onPickAttachment(e.target.files?.[0] || null);
                            e.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={openMapDialog}
                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs"
                      >
                        <MapIcon size={16} className="text-emerald-300" />
                        Mapa
                      </button>
                      <div className="relative z-40" ref={modelMenuRef}>
                        <button
                          type="button"
                          onClick={() => setModelMenuOpen((v) => !v)}
                          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs"
                        >
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.7)]"></span>
                          <span className="max-w-[140px] truncate">{selectedModelLabel}</span>
                          <ChevronDown
                            size={13}
                            className={`text-slate-400 transition-transform ${modelMenuOpen ? 'rotate-180' : ''}`}
                          />
                        </button>

                        {modelMenuOpen && (
                          <div className="absolute left-0 bottom-full mb-2 w-80 rounded-2xl bg-[#0d1612]/95 border border-white/10 shadow-2xl backdrop-blur-xl z-[120] overflow-hidden">
                            <div className="px-4 py-3 border-b border-white/10">
                              <p className="text-[10px] uppercase tracking-wider text-slate-500">Seleção de modelo</p>
                              <p className="text-xs text-slate-300 mt-1">Escolha manualmente ou use Auto</p>
                            </div>
                            <div className="max-h-80 overflow-auto custom-scrollbar p-2 space-y-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedModel('auto');
                                  setModelMenuOpen(false);
                                }}
                                className={`w-full text-left rounded-xl px-3 py-2 border transition-colors ${
                                  selectedModel === 'auto'
                                    ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                                    : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                                }`}
                              >
                                <div className="text-xs font-medium">Auto (Florestal)</div>
                                <div className="text-[11px] text-slate-400 mt-0.5">
                                  Escolhe modelo por contexto (texto, imagem e documento)
                                </div>
                              </button>
                              {models.map((model) => (
                                <button
                                  key={model.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedModel(model.id);
                                    setModelMenuOpen(false);
                                  }}
                                  className={`w-full text-left rounded-xl px-3 py-2 border transition-colors ${
                                    selectedModel === model.id
                                      ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200'
                                      : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="text-xs font-medium">{model.label}</div>
                                    <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                                      {(model.capabilities || ['text']).join(' + ')}
                                    </div>
                                  </div>
                                  <div className="text-[11px] text-slate-400 mt-1 leading-relaxed">
                                    {model.description}
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-4 w-[1px] bg-white/10 mx-1"></div>
                      <button
                        onClick={handleSend}
                        disabled={!input.trim() && !imageFile && !pdfFile && !pendingMapImageUrl}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                          input.trim() || imageFile || pdfFile || pendingMapImageUrl
                            ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25 hover:bg-emerald-400'
                            : 'bg-white/5 text-slate-500 cursor-not-allowed'
                        }`}
                      >
                        <span>{sending || uploading ? 'Enviando...' : 'Enviar'}</span>
                        <Send size={14} className={input.trim() ? 'fill-current' : ''} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-center mt-2">
                  <p className="text-[10px] text-slate-600">A IA pode cometer erros. Verifique informações críticas.</p>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-8 custom-scrollbar">
            <div className="max-w-4xl mx-auto space-y-8 animate-fade-in-up">
              <section className="relative group">
                <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl blur-sm" />
                <div className="relative bg-[#0e1612]/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 md:p-8 flex flex-col md:flex-row items-center gap-6">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-full bg-gradient-to-tr from-slate-700 to-slate-600 flex items-center justify-center text-3xl font-bold text-white shadow-2xl ring-4 ring-[#0e1612]">
                      {(userProfile?.fullName || 'U')
                        .split(' ')
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join('')}
                    </div>
                    <button className="absolute bottom-0 right-0 p-2 bg-emerald-600 rounded-full text-white hover:bg-emerald-500 transition-colors shadow-lg">
                      <Plus size={16} />
                    </button>
                  </div>
                  <div className="flex-1 text-center md:text-left space-y-2">
                    <h2 className="text-2xl font-semibold text-white">{userProfile?.fullName || 'Usuário'}</h2>
                    <p className="text-slate-400">{userProfile?.email || 'email@exemplo.com'}</p>
                    <div className="flex items-center justify-center md:justify-start gap-2 pt-2">
                      <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 text-xs font-medium border border-emerald-500/20">
                        Plano Pro
                      </span>
                      <span className="px-3 py-1 rounded-full bg-white/5 text-slate-400 text-xs font-medium border border-white/10">
                        Membro desde 2023
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={onEditProfileName}
                      className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-slate-200 transition-all"
                    >
                      Editar Perfil
                    </button>
                  </div>
                </div>
              </section>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <Settings size={20} />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-200">Interface Geral</h3>
                  </div>
                  <p className="text-sm text-slate-400">
                    Preferências visuais (tema, fonte e idioma) foram removidas desta versão.
                  </p>
                </div>

                <div className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-orange-500/10 text-orange-400">
                      <FileDown size={20} />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-200">Exportação</h3>
                  </div>
                  <div className="space-y-1">
                    <CustomSelect
                      label="Formato de Vetor"
                      value={settings.exportFormat}
                      onChange={(value: string) => updateSettings({ exportFormat: value })}
                      options={['KML / KMZ', 'Shapefile (.shp)', 'GeoJSON', 'DXF (AutoCAD)']}
                    />
                    <ToggleSwitch
                      label="Incluir metadados no relatório"
                      sub="Adiciona data, hora e fonte das imagens"
                      isActive={settings.includeMetadata}
                      onToggle={(value: boolean) => updateSettings({ includeMetadata: value })}
                    />
                    <ToggleSwitch
                      label="Comprimir arquivos grandes"
                      sub="Gera .zip automaticamente acima de 50MB"
                      isActive={settings.compressLarge}
                      onToggle={(value: boolean) => updateSettings({ compressLarge: value })}
                    />
                  </div>
                </div>

                <div className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-purple-500/10 text-purple-400">
                      <Bell size={20} />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-200">Notificações</h3>
                  </div>
                  <div className="space-y-1">
                    <ToggleSwitch
                      label="Alertas de processamento"
                      sub="Quando um mapa terminar de processar"
                      isActive={settings.alertProcessing}
                      onToggle={(value: boolean) => updateSettings({ alertProcessing: value })}
                    />
                    <ToggleSwitch
                      label="Novos recursos da IA"
                      sub="Atualizações semanais do sistema"
                      isActive={settings.alertNewFeatures}
                      onToggle={(value: boolean) => updateSettings({ alertNewFeatures: value })}
                    />
                    <ToggleSwitch
                      label="Avisos de Queimadas"
                      sub="Alertas em tempo real na sua área"
                      isActive={settings.alertFires}
                      onToggle={(value: boolean) => updateSettings({ alertFires: value })}
                    />
                  </div>
                </div>

                <div className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4 md:col-span-2">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-red-500/10 text-red-400">
                      <Shield size={20} />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-200">Segurança e Assinatura</h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-3">
                      <button
                        onClick={onResetPassword}
                        className="w-full flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                      >
                        <span className="text-sm text-slate-300">Alterar Senha</span>
                        <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
                      </button>
                      <button
                        onClick={() => updateSettings({ twoFactorEnabled: !settings.twoFactorEnabled })}
                        className="w-full flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group"
                      >
                        <div className="flex flex-col text-left">
                          <span className="text-sm text-slate-300">Autenticação em 2 Etapas</span>
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">
                            {settings.twoFactorEnabled ? 'Ativado' : 'Desativado'}
                          </span>
                        </div>
                        <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
                      </button>
                    </div>
                    <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-900/20 to-slate-900/40 border border-emerald-500/10">
                      <div className="flex justify-between items-start mb-2">
                        <div>
                          <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Plano Atual</p>
                          <p className="text-lg font-bold text-white mt-1">GeoForest Pro</p>
                        </div>
                        <span className="px-2 py-1 bg-white/10 rounded text-xs text-white">R$ 120/mês</span>
                      </div>
                      <div className="w-full bg-black/40 h-1.5 rounded-full overflow-hidden mb-2">
                        <div className="bg-emerald-500 h-full w-[75%] rounded-full"></div>
                      </div>
                      <p className="text-[10px] text-slate-400 flex justify-between">
                        <span>750/1000 análises</span>
                        <span className="text-emerald-400 hover:underline cursor-pointer">Gerenciar</span>
                      </p>
                    </div>
                  </div>
                </div>

                <div className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4 md:col-span-2">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                      <FileDown size={20} />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-200">Créditos</h3>
                  </div>
                  <p className="text-sm text-slate-400">
                    Plataforma desenvolvida para apoio técnico em engenharia florestal e análise ambiental.
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wider text-slate-500">Frontend</p>
                      <p className="text-sm text-slate-200 mt-1">React + Vite + Tailwind</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wider text-slate-500">Backend</p>
                      <p className="text-sm text-slate-200 mt-1">Node + Express + Firebase + Cloudinary</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wider text-slate-500">Modelos de IA</p>
                      <p className="text-sm text-slate-200 mt-1">Groq API (modo automático e manual)</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-wider text-slate-500">Conta atual</p>
                      <p className="text-sm text-slate-200 mt-1">{userProfile?.email || 'Usuário autenticado'}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {mapDialogOpen && (
          <div className="fixed inset-0 z-[140] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-6xl h-[82vh] rounded-2xl border border-white/10 bg-[#0b120f] shadow-2xl overflow-hidden flex flex-col">
              <div className="h-14 px-4 border-b border-white/10 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MapIcon size={16} className="text-emerald-300" />
                  <span className="text-sm text-white font-medium">Selecionar Área no Mapa</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMapDialogOpen(false)}
                  className="h-8 w-8 rounded-md text-slate-400 hover:text-white hover:bg-white/10"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] min-h-0 flex-1">
                <div className="border-r border-white/10 p-4 space-y-4 overflow-auto custom-scrollbar">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500 mb-2">Camada WMS (SEMA)</p>
                    <select
                      value={selectedMapLayer}
                      onChange={(e) => {
                        const v = e.target.value;
                        setSelectedMapLayer(v);
                        refreshMapPreview(v, mapBbox);
                      }}
                      className="w-full bg-[#050b08] border border-white/10 rounded-lg text-xs text-slate-300 py-2 px-3 outline-none focus:border-emerald-500/50"
                    >
                      {mapLayers.map((layer) => (
                        <option key={layer.name} value={layer.name}>
                          {layer.title} {layer.inferredYear ? `(${layer.inferredYear})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3">
                    <p className="text-[11px] text-slate-400 leading-relaxed">
                      Selecione a BBOX da área de interesse. A prévia e o snapshot são carregados direto do WMS da
                      SEMA.
                    </p>
                  </div>
                  <label className="inline-flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs cursor-pointer">
                    <FileText size={14} className="text-emerald-300" />
                    Importar área (.kml/.zip)
                    <input
                      type="file"
                      accept=".kml,.zip,application/vnd.google-earth.kml+xml,application/zip"
                      className="hidden"
                      onChange={(e) => {
                        onPickAreaFile(e.target.files?.[0] || null);
                        e.currentTarget.value = '';
                      }}
                    />
                  </label>
                  <div className="rounded-lg border border-white/10 bg-white/5 p-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500">BBox (fallback manual)</p>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="number"
                        step="0.000001"
                        value={mapBbox[0]}
                        onChange={(e) => setMapBbox([Number(e.target.value), mapBbox[1], mapBbox[2], mapBbox[3]])}
                        className="bg-[#050b08] border border-white/10 rounded px-2 py-1 text-xs text-slate-300"
                        placeholder="minX"
                      />
                      <input
                        type="number"
                        step="0.000001"
                        value={mapBbox[1]}
                        onChange={(e) => setMapBbox([mapBbox[0], Number(e.target.value), mapBbox[2], mapBbox[3]])}
                        className="bg-[#050b08] border border-white/10 rounded px-2 py-1 text-xs text-slate-300"
                        placeholder="minY"
                      />
                      <input
                        type="number"
                        step="0.000001"
                        value={mapBbox[2]}
                        onChange={(e) => setMapBbox([mapBbox[0], mapBbox[1], Number(e.target.value), mapBbox[3]])}
                        className="bg-[#050b08] border border-white/10 rounded px-2 py-1 text-xs text-slate-300"
                        placeholder="maxX"
                      />
                      <input
                        type="number"
                        step="0.000001"
                        value={mapBbox[3]}
                        onChange={(e) => setMapBbox([mapBbox[0], mapBbox[1], mapBbox[2], Number(e.target.value)])}
                        className="bg-[#050b08] border border-white/10 rounded px-2 py-1 text-xs text-slate-300"
                        placeholder="maxY"
                      />
                    </div>
                    <p className="text-[10px] text-slate-500">
                      Coordenadas em EPSG:4326 (longitude/latitude).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => refreshMapPreview()}
                    disabled={mapLoading || mapPreviewLoading || !selectedMapLayer}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition ${
                      mapLoading || mapPreviewLoading || !selectedMapLayer
                        ? 'bg-white/10 text-slate-500 cursor-not-allowed'
                        : 'bg-white/10 text-slate-200 hover:bg-white/20'
                    }`}
                  >
                    {mapPreviewLoading ? 'Atualizando prévia...' : 'Atualizar Prévia WMS'}
                  </button>
                  <button
                    type="button"
                    onClick={captureVisibleMapArea}
                    disabled={mapLoading || mapCapturing || !selectedMapLayer}
                    className={`w-full py-2.5 rounded-lg text-sm font-medium transition ${
                      mapLoading || mapCapturing || !selectedMapLayer
                        ? 'bg-white/10 text-slate-500 cursor-not-allowed'
                        : 'bg-emerald-500 text-white hover:bg-emerald-400'
                    }`}
                  >
                    {mapCapturing ? 'Capturando...' : 'Capturar Área Visível'}
                  </button>
                </div>
                <div className="relative min-h-0">
                  {mapLoading || mapPreviewLoading ? (
                    <div className="h-full w-full flex items-center justify-center text-slate-400 text-sm">
                      {mapLoading ? 'Carregando camadas do mapa...' : 'Carregando prévia WMS...'}
                    </div>
                  ) : mapPreviewDataUrl ? (
                    <img
                      src={mapPreviewDataUrl}
                      alt="Prévia WMS da área selecionada"
                      className="h-full w-full object-contain bg-black/25"
                    />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center text-slate-400 text-sm px-6 text-center">
                      Selecione uma camada e clique em “Atualizar Prévia WMS”.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <style>{`
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.1);
            border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: rgba(16, 185, 129, 0.4);
          }
          @keyframes fade-in-up {
            from { opacity: 0; transform: translateY(12px) scale(0.995); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in-up {
            animation: fade-in-up 0.48s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
          }
          .typing-dot {
            width: 6px;
            height: 6px;
            background: rgba(16, 185, 129, 0.7);
            border-radius: 999px;
            display: inline-block;
            animation: typing 1.2s infinite ease-in-out;
          }
          .typing-dot:nth-child(2) { animation-delay: 0.15s; }
          .typing-dot:nth-child(3) { animation-delay: 0.3s; }
          @keyframes typing {
            0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
            40% { transform: scale(1); opacity: 1; }
          }
          .chat-markdown p {
            margin: 0;
            white-space: pre-wrap;
          }
          .chat-markdown p + p {
            margin-top: 0.55rem;
          }
          .chat-markdown strong {
            color: #e8fff2;
            font-weight: 700;
          }
          .chat-markdown em {
            color: #b6f3d0;
          }
          .chat-markdown ul, .chat-markdown ol {
            margin: 0.45rem 0 0.2rem 1.05rem;
            padding: 0;
          }
          .chat-markdown li + li {
            margin-top: 0.2rem;
          }
          .chat-markdown code {
            background: rgba(255, 255, 255, 0.08);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 6px;
            padding: 0.08rem 0.35rem;
            font-size: 0.82em;
          }
          .chat-markdown a {
            color: #6ee7b7;
            text-decoration: underline;
          }
          body.theme-light {
            background: #edf7f1;
          }
          body.theme-light #root {
            filter: saturate(0.95);
          }
          @media (prefers-reduced-motion: reduce) {
            .animate-fade-in-up, .typing-dot {
              animation: none !important;
            }
          }
        `}</style>
      </main>
    </div>
  );
}
