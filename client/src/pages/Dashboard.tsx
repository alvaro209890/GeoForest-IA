/**
 * IA Hub - ChatGPT/Claude style with conversations sidebar
 */

import { useEffect, useMemo, useState } from 'react';
import {
  LogOut,
  ImagePlus,
  Sparkles,
  ChevronDown,
  Plus,
  Search,
  Menu,
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
  role: 'user' | 'assistant';
  content: any;
  meta?: {
    model?: string;
    imageUrl?: string;
  };
};

type Conversation = {
  id: string;
  title: string;
  updatedAt?: any;
  lastMessagePreview?: string;
};

const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  role: 'assistant',
  content:
    'Olá! Sou a IA da GeoForest. Posso apoiar análises ambientais, dúvidas técnicas e interpretação de dados florestais.',
  meta: { model: 'auto' },
};

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; label: string; capabilities: string[] }>>([]);
  const [selectedModel, setSelectedModel] = useState('auto');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([DEFAULT_ASSISTANT_MESSAGE]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const systemPrompt = useMemo(
    () => ({
      role: 'system',
      content:
        'Você é uma IA especializada em engenharia florestal e análise ambiental. Responda em português do Brasil, com foco técnico, conciso e orientado a ações. Se não tiver certeza, diga claramente o que falta e peça os dados necessários. Não invente normas, números ou conclusões.',
    }),
    []
  );

  const [conversationsRef, setConversationsRef] = useState<{
    collection: ReturnType<typeof collection>;
  } | null>(null);
  const [activeConversationRef, setActiveConversationRef] = useState<DocumentReference | null>(null);

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
      messages: initialMessages,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessagePreview: '',
    });

    const nextConv: Conversation = {
      id,
      title: 'Nova conversa',
      lastMessagePreview: '',
    };
    setConversations((prev) => [nextConv, ...prev]);
    setActiveConversationId(id);
    setActiveConversationRef(docRef);
    setMessages(initialMessages);
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
  };

  const onSelectConversation = async (id: string) => {
    if (!conversationsRef) return;
    await loadConversation(conversationsRef.collection, id);
    setSidebarOpen(false);
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

  const onPickImage = (file: File | null) => {
    if (!file) {
      if (imagePreview) URL.revokeObjectURL(imagePreview);
      setImageFile(null);
      setImagePreview(null);
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Selecione um arquivo de imagem');
      return;
    }
    if (imagePreview) URL.revokeObjectURL(imagePreview);
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const uploadImageIfNeeded = async (): Promise<string | null> => {
    if (!imageFile) return null;
    setImageUploading(true);

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

  const updateConversationMeta = async (updatedMessages: ChatMessage[], lastUserText: string) => {
    if (!activeConversationRef) return;
    const title =
      conversations.find((c) => c.id === activeConversationId)?.title || 'Nova conversa';
    const shouldSetTitle = title === 'Nova conversa' && lastUserText.trim().length > 0;
    const nextTitle = shouldSetTitle
      ? lastUserText.trim().split(/\s+/).slice(0, 6).join(' ')
      : title;

    await setDoc(
      activeConversationRef,
      {
        title: nextTitle,
        messages: updatedMessages,
        updatedAt: serverTimestamp(),
        lastMessagePreview: lastUserText.slice(0, 120),
      },
      { merge: true }
    );

    setConversations((prev) =>
      prev
        .map((c) =>
          c.id === activeConversationId
            ? { ...c, title: nextTitle, lastMessagePreview: lastUserText.slice(0, 120) }
            : c
        )
        .sort((a, b) => (a.id === activeConversationId ? -1 : b.id === activeConversationId ? 1 : 0))
    );
  };

  const onSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = chatInput.trim();
    if ((!content && !imageFile) || chatLoading) return;

    if (!activeConversationRef && conversationsRef) {
      await createConversation(conversationsRef.collection);
    }

    let imageUrl: string | null = null;
    try {
      if (imageFile) {
        imageUrl = await uploadImageIfNeeded();
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao enviar imagem');
      setImageUploading(false);
      return;
    } finally {
      setImageUploading(false);
    }

    const userContent = imageUrl
      ? [
          { type: 'text', text: content || 'Analise a imagem.' },
          { type: 'image_url', image_url: { url: imageUrl } },
        ]
      : content;

    const nextMessages: ChatMessage[] = [
      ...messages,
      { role: 'user', content: userContent as any, meta: imageUrl ? { imageUrl } : undefined },
    ];
    setMessages(nextMessages);
    setChatInput('');
    setImageFile(null);
    setImagePreview(null);
    setChatLoading(true);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [systemPrompt, ...nextMessages],
          model: selectedModel,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Falha ao consultar IA');
      }

      const data = await res.json();
      const reply = data?.content || 'Desculpe, não consegui responder agora.';
      const usedModel = data?.model || selectedModel;
      const updatedMessages: ChatMessage[] = [
        ...nextMessages,
        { role: 'assistant', content: reply, meta: { model: usedModel } },
      ];
      setMessages(updatedMessages);

      const userTextForTitle = typeof content === 'string' ? content : 'Nova conversa';
      await updateConversationMeta(updatedMessages, userTextForTitle);
    } catch (error: any) {
      toast.error(error.message || 'Erro ao conversar com a IA');
    } finally {
      setChatLoading(false);
    }
  };

  const onClearChat = async () => {
    const cleared: ChatMessage[] = [DEFAULT_ASSISTANT_MESSAGE];
    setMessages(cleared);
    if (activeConversationRef) {
      await setDoc(activeConversationRef, { messages: cleared, updatedAt: serverTimestamp() }, { merge: true });
    }
  };

  const filteredConversations = conversations.filter((c) =>
    c.title.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
          <p className="text-green-300 font-semibold">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-green-950 to-gray-950">
      <div className="absolute inset-0 bg-[radial-gradient(1000px_700px_at_10%_10%,rgba(34,197,94,0.18),transparent_60%),radial-gradient(900px_700px_at_90%_20%,rgba(234,179,8,0.12),transparent_60%)] pointer-events-none" />

      {/* Mobile top bar */}
      <div className="relative z-10 lg:hidden flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gray-900/60 backdrop-blur-md">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          className="text-white/80 hover:text-white"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="text-sm text-green-200/80">GeoForest IA</div>
        <Button
          onClick={onLogout}
          disabled={loggingOut}
          variant="outline"
          className="border-green-600 text-green-200 hover:bg-green-900/30 h-8 px-2"
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
          {/* Sidebar */}
          <aside
            className={`bg-gray-900/70 backdrop-blur-md rounded-3xl border border-green-900/30 shadow-2xl p-4 lg:p-5 flex flex-col gap-4 lg:static lg:translate-x-0 lg:opacity-100 lg:visible transition-all ${
              sidebarOpen ? 'fixed inset-4 z-50' : 'hidden lg:flex'
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-green-500 to-green-700 shadow-lg flex items-center justify-center">
                  <span className="text-lg">🌲</span>
                </div>
                <div>
                  <div className="text-sm font-semibold text-white">GeoForest IA</div>
                  <div className="text-[11px] text-green-200/70">
                    {userProfile?.fullName || 'Usuário'}
                  </div>
                </div>
              </div>
              <button
                className="lg:hidden text-white/70 hover:text-white"
                onClick={() => setSidebarOpen(false)}
                type="button"
              >
                ✕
              </button>
            </div>

            <Button
              onClick={() => createConversation()}
              className="bg-green-600 hover:bg-green-700 text-white font-semibold w-full"
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova conversa
            </Button>

            <div className="relative">
              <Search className="w-4 h-4 text-white/40 absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar conversa..."
                className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
              />
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {filteredConversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => onSelectConversation(conv.id)}
                  className={`w-full text-left px-3 py-2 rounded-xl border transition-colors ${
                    conv.id === activeConversationId
                      ? 'bg-white/10 border-green-500/40 text-white'
                      : 'bg-white/5 border-white/10 text-white/80 hover:bg-white/10'
                  }`}
                >
                  <div className="text-sm font-medium truncate">{conv.title}</div>
                  {conv.lastMessagePreview && (
                    <div className="text-[11px] text-white/50 truncate">{conv.lastMessagePreview}</div>
                  )}
                </button>
              ))}
            </div>

            <Button
              onClick={onLogout}
              disabled={loggingOut}
              variant="outline"
              className="border-green-600 text-green-200 hover:bg-green-900/30"
            >
              <LogOut className="w-4 h-4 mr-2" />
              {loggingOut ? 'Saindo...' : 'Sair'}
            </Button>
          </aside>

          {/* Chat */}
          <section className="bg-gray-900/60 backdrop-blur-md rounded-3xl border border-green-900/30 shadow-2xl overflow-hidden flex flex-col min-h-[70vh]">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="text-sm text-green-200/80 inline-flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-300" />
                IA Conversacional • respostas técnicas
              </div>
              <button
                type="button"
                onClick={onClearChat}
                className="text-xs text-green-200 hover:text-white transition-colors"
              >
                Limpar conversa
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 space-y-3 bg-gradient-to-b from-transparent to-black/20">
              {messages.map((msg, idx) => (
                <div
                  key={`${msg.role}-${idx}`}
                  className={`rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-green-600/30 text-white ml-auto max-w-[85%]'
                      : 'bg-white/10 text-green-100 max-w-[85%]'
                  }`}
                >
                  {typeof msg.content === 'string'
                    ? msg.content
                    : Array.isArray(msg.content)
                    ? msg.content
                        .map((part: any) => (part?.type === 'text' ? part.text : '[Imagem]'))
                        .join(' ')
                    : ''}
                  {msg.meta?.model && msg.role === 'assistant' && (
                    <div className="mt-2 text-[10px] uppercase tracking-wide text-green-200/60">
                      Modelo: {msg.meta.model}
                    </div>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="bg-white/10 text-green-100 max-w-[85%] rounded-2xl px-4 py-3 text-sm">
                  Pensando...
                </div>
              )}
            </div>

            <form onSubmit={onSendMessage} className="p-5 border-t border-white/10 space-y-3">
              {imagePreview && (
                <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-2">
                  <img src={imagePreview} alt="Prévia" className="h-14 w-14 object-cover rounded-lg" />
                  <div className="text-xs text-white/70 flex-1">
                    {imageFile?.name || 'Imagem selecionada'}
                  </div>
                  <button
                    type="button"
                    onClick={() => onPickImage(null)}
                    className="text-xs text-red-200 hover:text-red-100"
                  >
                    Remover
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 relative">
                  <Input
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Digite sua pergunta técnica..."
                    className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40 pr-36"
                  />
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <div className="relative">
                      <select
                        value={selectedModel}
                        onChange={(e) => setSelectedModel(e.target.value)}
                        className="bg-white/10 border border-white/20 text-white text-xs rounded-lg pl-3 pr-7 py-1.5 focus:border-green-400 focus:ring-green-400/40 appearance-none"
                      >
                        <option value="auto" className="bg-gray-900">
                          Auto
                        </option>
                        {models.map((model) => (
                          <option key={model.id} value={model.id} className="bg-gray-900">
                            {model.label}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-3.5 h-3.5 text-white/60 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 cursor-pointer hover:bg-white/15 transition-colors inline-flex items-center gap-2">
                    <ImagePlus className="w-4 h-4 text-green-300" />
                    Anexar imagem
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => onPickImage(e.target.files?.[0] || null)}
                    />
                  </label>
                  <Button
                    type="submit"
                    disabled={chatLoading || imageUploading}
                    className="bg-green-600 hover:bg-green-700 text-white font-semibold px-5"
                  >
                    {imageUploading ? 'Enviando...' : 'Enviar'}
                  </Button>
                </div>
              </div>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
