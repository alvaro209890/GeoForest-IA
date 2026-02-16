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
} from 'lucide-react';
import { useLocation } from 'wouter';
import { onAuthStateChanged } from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
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
    fileType?: 'image' | 'pdf';
  };
};

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

export default function Dashboard() {
  const [input, setInput] = useState('');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const [, setLocation] = useLocation();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [models, setModels] = useState<Array<{ id: string; label: string; capabilities: string[] }>>([]);
  const [selectedModel, setSelectedModel] = useState('auto');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [typingMessageId, setTypingMessageId] = useState<string | null>(null);
  const [typingText, setTypingText] = useState('');
  const typingTimerRef = useRef<number | null>(null);
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
        'Você é uma IA especializada em engenharia florestal e análise ambiental. Responda em português do Brasil, com foco técnico, conciso e orientado a ações. Se não tiver certeza, diga claramente o que falta e peça os dados necessários. Não invente normas, números ou conclusões.',
    }),
    []
  );

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
    const loadModels = async () => {
      try {
        const res = await fetch('/api/models');
        if (!res.ok) return;
        const data = await res.json();
        if (Array.isArray(data.models)) {
          setModels(data.models);
        }
      } catch {
        // ignore
      }
    };
    loadModels();
  }, []);

  useEffect(() => {
    if (activeView === 'chat') {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeView]);

  useEffect(() => {
    return () => {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
    };
  }, [imagePreview]);

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
      setMessages(data.messages?.length ? data.messages : [DEFAULT_ASSISTANT_MESSAGE]);
    } else {
      setMessages([DEFAULT_ASSISTANT_MESSAGE]);
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

  const clearAttachments = () => {
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
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
      return;
    }
    if (isPdf) {
      clearAttachments();
      setPdfFile(file);
      return;
    }
    toast.error('Selecione uma imagem ou PDF');
  };

  const uploadImageIfNeeded = async (): Promise<string | null> => {
    if (!imageFile) return null;
    setUploading(true);

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

  const uploadPdfIfNeeded = async (): Promise<{ url: string; extractedText: string } | null> => {
    if (!pdfFile) return null;
    setUploading(true);

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
    return { url: data.secure_url as string, extractedText: (data.extracted_text as string) || '' };
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

  const handleSend = async () => {
    if ((!input.trim() && !imageFile && !pdfFile) || sending) return;
    if (!activeConversationRef && conversationsRef) {
      await createConversation(conversationsRef.collection);
    }

    let imageUrl: string | null = null;
    let pdfResult: { url: string; extractedText: string } | null = null;
    try {
      if (imageFile) imageUrl = await uploadImageIfNeeded();
      if (pdfFile) pdfResult = await uploadPdfIfNeeded();
    } catch (error: any) {
      toast.error(error.message || 'Erro ao enviar arquivo');
      setUploading(false);
      return;
    } finally {
      setUploading(false);
    }

    const userText = input.trim();
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let userPayloadText = userText;
    if (imageUrl) {
      userPayloadText = userText || 'Analise a imagem.';
    } else if (pdfResult?.url) {
      const context = pdfResult.extractedText
        ? `\n\nConteúdo extraído do PDF:\n${pdfResult.extractedText}`
        : '';
      userPayloadText = `${userText || 'Analise o PDF.'}\n\nArquivo PDF: ${pdfResult.url}${context}`;
    }

    const userMessage: ChatMessage = {
      id: nanoid(),
      role: 'user',
      text: userText || (imageUrl ? 'Analise a imagem.' : 'Analise o PDF.'),
      time,
      meta: imageUrl
        ? { imageUrl, fileType: 'image' }
        : pdfResult?.url
        ? { fileUrl: pdfResult.url, fileType: 'pdf' }
        : undefined,
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setImageFile(null);
    setImagePreview(null);
    setPdfFile(null);
    setSending(true);
    const typingId = nanoid();
    setTypingMessageId(typingId);
    setTypingText('');

    const currentUserMessageId = userMessage.id;
    const apiMessages = [
      systemPrompt,
      ...nextMessages.map((m) => {
        if (m.role === 'user' && m.meta?.imageUrl) {
          return {
            role: 'user',
            content: [
              { type: 'text', text: userPayloadText },
              { type: 'image_url', image_url: { url: m.meta.imageUrl } },
            ],
          };
        }
        if (m.role === 'user' && m.meta?.fileType === 'pdf' && m.id === currentUserMessageId) {
          return { role: 'user', content: userPayloadText };
        }
        return { role: m.role === 'ai' ? 'assistant' : 'user', content: m.text };
      }),
    ];

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, model: selectedModel }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Falha ao consultar IA');
      }

      const data = await res.json();
      const reply = data?.content || 'Desculpe, não consegui responder agora.';
      const usedModel = data?.model || selectedModel;
      const aiMessage: ChatMessage = {
        id: typingId,
        role: 'ai',
        text: reply,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        meta: { model: usedModel },
      };

      // Typing animation
      const full = reply;
      let idx = 0;
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
      }
      typingTimerRef.current = window.setInterval(() => {
        idx += 1;
        setTypingText(full.slice(0, idx));
        if (idx >= full.length) {
          window.clearInterval(typingTimerRef.current!);
          typingTimerRef.current = null;
          setTypingMessageId(null);
          setTypingText('');
          const updatedMessages = [...nextMessages, aiMessage];
          setMessages(updatedMessages);
          updateConversationMeta(updatedMessages, userText || 'Nova conversa');
        }
      }, 18);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao conversar com a IA');
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
    <div className="flex h-screen w-full bg-[#050b08] text-slate-200 overflow-hidden font-sans selection:bg-emerald-500/30">
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
            <button
              key={conv.id}
              onClick={() => onSelectConversation(conv.id)}
              className={`w-full text-left flex items-center gap-3 p-2.5 rounded-lg transition-colors group ${
                conv.id === activeConversationId ? 'bg-white/10 text-white' : 'hover:bg-white/5 text-slate-400'
              }`}
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

      <main className="flex-1 flex flex-col relative z-10 h-full w-full overflow-hidden">
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
          <div className="flex items-center gap-2">
            {activeView === 'chat' && (
              <div className="relative flex items-center">
                <div className="relative">
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="appearance-none bg-[#050b08] border border-white/10 rounded-lg text-xs text-slate-300 py-2 pl-3 pr-16 outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 cursor-pointer transition-all hover:border-emerald-500/30"
                  >
                    <option value="auto" className="bg-[#0e1612] text-slate-200 py-2">
                      Auto (Florestal)
                    </option>
                    {models
                      .filter((m) =>
                        [
                          'meta-llama/llama-3.3-70b-versatile',
                          'meta-llama/llama-4-maverick-17b-128e-instruct',
                          'qwen/qwen3-32b',
                        ].includes(m.id)
                      )
                      .map((model) => (
                        <option key={model.id} value={model.id} className="bg-[#0e1612] text-slate-200 py-2">
                          {model.label}
                        </option>
                      ))}
                  </select>
                  <ChevronDown size={14} className="absolute right-8 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                  <div className="absolute right-1 top-1/2 -translate-y-1/2 group">
                    <button
                      type="button"
                      className="px-2 py-1 text-[10px] rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200"
                    >
                      +
                    </button>
                    <div className="absolute right-0 mt-2 w-56 rounded-xl bg-[#0e1612]/95 border border-white/10 shadow-2xl opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-all z-20">
                      <div className="p-2 text-[10px] uppercase tracking-wider text-slate-500">Mais modelos</div>
                      <div className="max-h-60 overflow-auto custom-scrollbar">
                        {models
                          .filter(
                            (m) =>
                              ![
                                'meta-llama/llama-3.3-70b-versatile',
                                'meta-llama/llama-4-maverick-17b-128e-instruct',
                                'qwen/qwen3-32b',
                              ].includes(m.id)
                          )
                          .map((model) => (
                            <button
                              key={model.id}
                              onClick={() => setSelectedModel(model.id)}
                              className="w-full text-left px-3 py-2 text-xs text-slate-300 hover:bg-white/5"
                            >
                              {model.label}
                            </button>
                          ))}
                        {models.length === 0 && <div className="px-3 py-2 text-xs text-slate-500">Carregando...</div>}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </header>

        {activeView === 'chat' ? (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-6 scroll-smooth custom-scrollbar">
              <div className="max-w-3xl mx-auto space-y-6">
                {messages.map((msg) => (
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
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                      {msg.meta?.fileType === 'image' && msg.meta.imageUrl && (
                        <img src={msg.meta.imageUrl} alt="Imagem" className="mt-3 rounded-lg max-h-48" />
                      )}
                      {msg.meta?.fileType === 'pdf' && msg.meta.fileUrl && (
                        <a
                          href={msg.meta.fileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex items-center gap-2 text-xs text-emerald-200 hover:text-emerald-100"
                        >
                          <FileText size={14} /> Abrir PDF
                        </a>
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
                ))}
                {typingMessageId && (
                  <div className="flex gap-4 animate-fade-in-up">
                    <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-gradient-to-br from-emerald-500 to-green-700 shadow-lg shadow-emerald-900/50">
                      <Leaf size={14} className="text-white" />
                    </div>
                    <div className="relative max-w-[85%] lg:max-w-[75%] p-4 rounded-2xl bg-[#131f18]/80 border border-emerald-500/10 text-slate-200 rounded-tl-sm">
                      {typingText ? (
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{typingText}</p>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="typing-dot"></span>
                          <span className="typing-dot"></span>
                          <span className="typing-dot"></span>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="p-4 pb-6 w-full flex-shrink-0">
              <div className="max-w-3xl mx-auto relative group">
                <div className="absolute inset-0 bg-emerald-500/5 rounded-2xl blur-sm group-focus-within:bg-emerald-500/10 transition-all duration-500" />
                <div className="relative bg-[#0e1612]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden focus-within:border-emerald-500/40 focus-within:ring-1 focus-within:ring-emerald-500/20 transition-all duration-300">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
                    placeholder="Descreva sua análise ambiental ou anexe um mapa..."
                    className="w-full bg-transparent text-slate-200 placeholder:text-slate-500 px-4 py-4 min-h-[60px] max-h-[200px] resize-none focus:outline-none text-sm leading-relaxed custom-scrollbar"
                    rows={1}
                    style={{ height: input ? `${Math.min(input.split('\n').length * 24 + 32, 200)}px` : '60px' }}
                  />
                  {(imageFile || pdfFile) && (
                    <div className="px-4 pb-2">
                      <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-xs text-slate-300">
                        {imageFile ? <ImagePlus size={14} className="text-emerald-300" /> : <FileText size={14} className="text-emerald-300" />}
                        <span className="truncate max-w-[240px]">{imageFile?.name || pdfFile?.name}</span>
                        <button
                          type="button"
                          onClick={() => clearAttachments()}
                          className="text-slate-500 hover:text-red-300 ml-1"
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
                          onChange={(e) => onPickAttachment(e.target.files?.[0] || null)}
                        />
                      </label>
                      <button className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-emerald-200 hover:border-emerald-500/40 hover:bg-emerald-500/10 transition-all text-xs">
                        <MapIcon size={16} className="text-emerald-300" />
                        Mapa
                      </button>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-4 w-[1px] bg-white/10 mx-1"></div>
                      <button
                        onClick={handleSend}
                        disabled={!input.trim() && !imageFile && !pdfFile}
                        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-300 ${
                          input.trim() || imageFile || pdfFile
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
                    <button className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-sm text-slate-200 transition-all">
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
                  <div className="space-y-1">
                    <CustomSelect
                      label="Tema"
                      value={settings.theme}
                      onChange={(value: string) => updateSettings({ theme: value })}
                      options={['Escuro (Floresta)', 'Claro (Dia)', 'Alto Contraste', 'Sistema']}
                    />
                    <CustomSelect
                      label="Idioma"
                      value={settings.language}
                      onChange={(value: string) => updateSettings({ language: value })}
                      options={['Português (BR)', 'English', 'Español']}
                    />
                    <CustomSelect
                      label="Tamanho da Fonte"
                      value={settings.fontSize}
                      onChange={(value: string) => updateSettings({ fontSize: value })}
                      options={['Pequeno', 'Padrão', 'Grande']}
                    />
                  </div>
                </div>

                <div className="bg-[#0e1612]/60 backdrop-blur-md border border-white/5 rounded-2xl p-6 space-y-4">
                  <div className="flex items-center gap-3 mb-2">
                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-400">
                      <MapIcon size={20} />
                    </div>
                    <h3 className="font-semibold text-lg text-slate-200">Mapas e Dados</h3>
                  </div>
                  <div className="space-y-1">
                    <CustomSelect
                      label="Sistema de Coordenadas"
                      icon={MapIcon}
                      value={settings.coordSystem}
                      onChange={(value: string) => updateSettings({ coordSystem: value })}
                      options={['SIRGAS 2000 (Brasil)', 'WGS 84 (Global)', 'SAD 69']}
                    />
                    <CustomSelect
                      label="Unidade de Medida"
                      value={settings.unit}
                      onChange={(value: string) => updateSettings({ unit: value })}
                      options={['Hectares (ha)', 'Metros Quadrados (m²)', 'Alqueires Paulistas', 'Alqueires Mineiros']}
                    />
                    <CustomSelect
                      label="Camada Padrão"
                      icon={Layers}
                      value={settings.defaultLayer}
                      onChange={(value: string) => updateSettings({ defaultLayer: value })}
                      options={['Satélite (Alta Res.)', 'Topográfico', 'Híbrido', 'Biomassa']}
                    />
                  </div>
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
                      <button className="w-full flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group">
                        <span className="text-sm text-slate-300">Alterar Senha</span>
                        <ChevronDown size={16} className="text-slate-500 -rotate-90 group-hover:text-white transition-colors" />
                      </button>
                      <button className="w-full flex items-center justify-between p-3 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group">
                        <div className="flex flex-col text-left">
                          <span className="text-sm text-slate-300">Autenticação em 2 Etapas</span>
                          <span className="text-[10px] text-emerald-400 flex items-center gap-1">Ativado</span>
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
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .animate-fade-in-up {
            animation: fade-in-up 0.4s ease-out forwards;
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
        `}</style>
      </main>
    </div>
  );
}
