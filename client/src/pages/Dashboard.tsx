/**
 * Dashboard - Split View IA Chat (modern, responsive)
 */

import { useEffect, useMemo, useState } from 'react';
import { LogOut, ImagePlus, Leaf, Sparkles, History, UploadCloud, Layers } from 'lucide-react';
import { useLocation } from 'wouter';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp, type DocumentReference } from 'firebase/firestore';
import { auth, db } from '@/lib/firebase';
import { handleLogout, UserProfile } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loggingOut, setLoggingOut] = useState(false);

  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [models, setModels] = useState<Array<{ id: string; label: string; capabilities: string[] }>>([]);
  const [selectedModel, setSelectedModel] = useState('llama-3.3-70b-versatile');

  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; content: any }>>([
    {
      role: 'assistant',
      content:
        'Olá! Sou a IA da GeoForest. Posso apoiar análises ambientais, dúvidas técnicas e interpretação de dados florestais.',
    },
  ]);

  const systemPrompt = useMemo(
    () => ({
      role: 'system',
      content:
        'Você é uma IA especializada em engenharia florestal e análise ambiental. Responda em português do Brasil, com foco técnico, conciso e orientado a ações. Se não tiver certeza, diga claramente o que falta e peça os dados necessários. Não invente normas, números ou conclusões.',
    }),
    []
  );

  const [chatDocRef, setChatDocRef] = useState<DocumentReference | null>(null);

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

        const nextChatDocRef = doc(db, 'chat_sessions', currentUser.uid);
        setChatDocRef(nextChatDocRef);
        const chatSnap = await getDoc(nextChatDocRef);
        if (chatSnap.exists()) {
          const data = chatSnap.data() as { messages?: Array<{ role: 'user' | 'assistant'; content: any }> };
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
          }
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
        if (data.defaultModel) {
          setSelectedModel(data.defaultModel);
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

  const onSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    const content = chatInput.trim();
    if ((!content && !imageFile) || chatLoading) return;

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

    const nextMessages = [...messages, { role: 'user' as const, content: userContent as any }];
    setMessages(nextMessages);
    setChatInput('');
    setImageFile(null);
    setImagePreview(null);
    setChatLoading(true);

    try {
      let modelToSend = selectedModel;
      if (imageUrl) {
        const selected = models.find((m) => m.id === selectedModel);
        const supportsVision = selected?.capabilities?.includes('vision');
        if (!supportsVision) {
          const visionModel = models.find((m) => m.capabilities?.includes('vision'));
          modelToSend = visionModel?.id || 'meta-llama/llama-4-maverick-17b-128e-instruct';
        }
      }

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [systemPrompt, ...nextMessages],
          model: modelToSend,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Falha ao consultar IA');
      }

      const data = await res.json();
      const reply = data?.content || 'Desculpe, não consegui responder agora.';
      const updatedMessages = [...nextMessages, { role: 'assistant' as const, content: reply }];
      setMessages(updatedMessages);

      if (chatDocRef) {
        await setDoc(chatDocRef, { messages: updatedMessages, updatedAt: serverTimestamp() }, { merge: true });
      }
    } catch (error: any) {
      toast.error(error.message || 'Erro ao conversar com a IA');
    } finally {
      setChatLoading(false);
    }
  };

  const onClearChat = async () => {
    const cleared = [
      {
        role: 'assistant' as const,
        content:
          'Olá! Sou a IA da GeoForest. Posso apoiar análises ambientais, dúvidas técnicas e interpretação de dados florestais.',
      },
    ];
    setMessages(cleared);
    if (chatDocRef) {
      await setDoc(chatDocRef, { messages: cleared, updatedAt: serverTimestamp() }, { merge: true });
    }
  };

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
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-gray-900">
      <div className="absolute inset-0 bg-[radial-gradient(1000px_700px_at_10%_10%,rgba(34,197,94,0.18),transparent_60%),radial-gradient(900px_700px_at_90%_20%,rgba(234,179,8,0.12),transparent_60%)] pointer-events-none" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-6 lg:py-10">
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
          {/* Sidebar */}
          <aside className="bg-gray-900/60 backdrop-blur-md rounded-3xl border border-green-900/30 shadow-2xl p-5 lg:p-6 flex flex-col gap-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-green-500 to-green-700 shadow-lg flex items-center justify-center">
                <span className="text-lg">🌲</span>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">GeoForest IA</h1>
                <p className="text-xs text-green-200/80">Assistente Florestal</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4">
              <div className="text-xs text-green-200/70 mb-2">Perfil ativo</div>
              <div className="text-white font-semibold">{userProfile?.fullName || 'Usuário'}</div>
              <div className="text-xs text-green-200/60 mt-1">
                {userProfile?.email || 'E-mail não informado'}
              </div>
              <div className="mt-3 inline-flex items-center gap-2 text-xs text-green-200/80">
                <Leaf className="w-4 h-4 text-green-400" />
                Status: ativo
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs uppercase tracking-wide text-green-200/60">Ações rápidas</div>
              <button className="w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/90 transition-colors inline-flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-300" />
                Nova análise
              </button>
              <button className="w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/90 transition-colors inline-flex items-center gap-2">
                <UploadCloud className="w-4 h-4 text-green-300" />
                Importar shapefile
              </button>
              <button className="w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/90 transition-colors inline-flex items-center gap-2">
                <History className="w-4 h-4 text-green-300" />
                Ver histórico
              </button>
              <button className="w-full text-left px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm text-white/90 transition-colors inline-flex items-center gap-2">
                <Layers className="w-4 h-4 text-green-300" />
                Camadas e mapas
              </button>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
              <div className="text-xs uppercase tracking-wide text-green-200/60">Modelo</div>
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="w-full bg-white/10 border border-white/20 text-white text-xs rounded-lg px-2 py-2 focus:border-green-400 focus:ring-green-400/40"
              >
                {models.length === 0 && (
                  <option value={selectedModel} className="bg-gray-900">
                    {selectedModel}
                  </option>
                )}
                {models.map((model) => (
                  <option key={model.id} value={model.id} className="bg-gray-900">
                    {model.label}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={onClearChat}
                className="w-full text-xs text-green-200 hover:text-white transition-colors py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10"
              >
                Limpar conversa
              </button>
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
          <section className="bg-gray-800/40 backdrop-blur-sm rounded-3xl border border-green-900/30 shadow-2xl overflow-hidden flex flex-col">
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <div className="text-sm text-green-200/80">
                Conversa ativa • respostas técnicas e objetivas
              </div>
              <div className="text-xs text-green-200/60">IA Conversacional</div>
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

              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Digite sua pergunta técnica..."
                className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
              />

              <div className="flex flex-wrap items-center gap-3">
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
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
