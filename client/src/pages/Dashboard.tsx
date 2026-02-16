/**
 * Dashboard Page - Página Principal Após Autenticação
 * 
 * Design Philosophy: Natureza Elevada com Tecnologia Integrada
 * - Layout profissional com tema escuro
 * - Cartões informativos com dados do usuário
 * - Integração com Firestore para exibir dados do perfil
 * - Botão de logout
 */

import { useEffect, useMemo, useState } from 'react';
import { LogOut, User, Briefcase, Calendar, Leaf } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { handleLogout, getCurrentUser, UserProfile } from '@/lib/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Input } from '@/components/ui/input';

export default function Dashboard() {
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
        'Olá! Sou a IA da GeoForest. Posso ajudar com análises ambientais, dúvidas sobre dados florestais e próximos passos do seu projeto.',
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
  const chatDocRef = useMemo(() => {
    const user = getCurrentUser();
    return user ? doc(db, 'chat_sessions', user.uid) : null;
  }, []);

  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        const currentUser = getCurrentUser();
        if (!currentUser) {
          window.location.href = '/';
          return;
        }

        // Buscar dados do usuário no Firestore
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDocSnap = await getDoc(userDocRef);

        if (userDocSnap.exists()) {
          setUserProfile(userDocSnap.data() as UserProfile);
        } else {
          toast.error('Perfil do usuário não encontrado');
        }

        if (chatDocRef) {
          const chatSnap = await getDoc(chatDocRef);
          if (chatSnap.exists()) {
            const data = chatSnap.data() as { messages?: Array<{ role: 'user' | 'assistant'; content: string }> };
            if (data.messages && data.messages.length > 0) {
              setMessages(data.messages);
            }
          }
        }
      } catch (error) {
        console.error('Erro ao carregar perfil:', error);
        toast.error('Erro ao carregar perfil do usuário');
      } finally {
        setLoading(false);
      }
    };

    loadUserProfile();
  }, []);

  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

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
        // ignore if backend not available
      }
    };
    loadModels();
  }, []);

  const onLogout = async () => {
    setLoggingOut(true);
    try {
      await handleLogout();
      toast.success('Logout realizado com sucesso');
      window.location.href = '/';
    } catch (error: any) {
      toast.error(error.message || 'Erro ao fazer logout');
    } finally {
      setLoggingOut(false);
    }
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
        await setDoc(
          chatDocRef,
          { messages: updatedMessages, updatedAt: serverTimestamp() },
          { merge: true }
        );
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
          'Olá! Sou a IA da GeoForest. Posso ajudar com análises ambientais, dúvidas sobre dados florestais e próximos passos do seu projeto.',
      },
    ];
    setMessages(cleared);
    if (chatDocRef) {
      await setDoc(chatDocRef, { messages: cleared, updatedAt: serverTimestamp() }, { merge: true });
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

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto mb-4"></div>
          <p className="text-green-300 font-semibold">Carregando perfil...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-green-900 to-gray-900">
      {/* Header */}
      <header className="bg-gray-800/50 backdrop-blur-md shadow-lg border-b border-green-900/30">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-green-700 rounded-full flex items-center justify-center">
              <span className="text-xl">🌲</span>
            </div>
            <h1 className="text-2xl font-bold text-white">GeoForest IA</h1>
          </div>
          <Button
            onClick={onLogout}
            disabled={loggingOut}
            variant="outline"
            className="flex items-center gap-2 border-green-600 text-green-300 hover:bg-green-900/20"
          >
            <LogOut className="w-4 h-4" />
            {loggingOut ? 'Saindo...' : 'Sair'}
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-12">
        {/* Welcome Section */}
        <div className="mb-12">
          <h2 className="text-4xl font-bold text-white mb-2">
            Bem-vindo, {userProfile?.fullName}! 👋
          </h2>
          <p className="text-green-300 text-lg">
            Acesse as ferramentas de análise e gestão florestal
          </p>
        </div>

        {/* User Profile Card */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-12">
          {/* Profile Info */}
          <div className="bg-gray-800/40 backdrop-blur-sm rounded-2xl shadow-lg p-8 border border-green-900/30">
            <h3 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
              <User className="w-6 h-6 text-green-500" />
              Informações do Perfil
            </h3>

            <div className="space-y-6">
              <div>
                <label className="block text-sm font-semibold text-green-300 mb-2">
                  Nome Completo
                </label>
                <p className="text-gray-200 text-lg">{userProfile?.fullName}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-green-300 mb-2">
                  E-mail
                </label>
                <p className="text-gray-200 text-lg">{userProfile?.email}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-green-300 mb-2 flex items-center gap-2">
                  <Briefcase className="w-4 h-4" />
                  Registro CREA
                </label>
                <p className="text-gray-200 text-lg font-mono">{userProfile?.creaNumber}</p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-green-300 mb-2 flex items-center gap-2">
                  <Leaf className="w-4 h-4" />
                  Área de Atuação
                </label>
                <p className="text-gray-200 text-lg capitalize">
                  {userProfile?.specialization === 'manejo' && 'Manejo Florestal'}
                  {userProfile?.specialization === 'silvicultura' && 'Silvicultura'}
                  {userProfile?.specialization === 'inventario' && 'Inventário Florestal'}
                  {userProfile?.specialization === 'conservacao' && 'Conservação'}
                  {userProfile?.specialization === 'outro' && 'Outro'}
                </p>
              </div>

              <div>
                <label className="block text-sm font-semibold text-green-300 mb-2 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Data de Cadastro
                </label>
                <p className="text-gray-200 text-lg">
                  {userProfile?.createdAt
                    ? new Date(userProfile.createdAt.toMillis()).toLocaleDateString('pt-BR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : 'N/A'}
                </p>
              </div>
            </div>
          </div>

          {/* Quick Stats */}
          <div className="space-y-6">
            {/* Stat Card 1 */}
            <div className="bg-gradient-to-br from-green-600 to-green-800 rounded-2xl shadow-lg p-8 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-green-100 text-sm font-semibold mb-2">Status</p>
                  <p className="text-3xl font-bold">Ativo</p>
                </div>
                <Leaf className="w-12 h-12 text-green-200 opacity-50" />
              </div>
            </div>

            {/* Stat Card 2 */}
            <div className="bg-gradient-to-br from-amber-600 to-amber-800 rounded-2xl shadow-lg p-8 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-amber-100 text-sm font-semibold mb-2">Projetos</p>
                  <p className="text-3xl font-bold">0</p>
                </div>
                <Briefcase className="w-12 h-12 text-amber-200 opacity-50" />
              </div>
            </div>

            {/* Stat Card 3 */}
            <div className="bg-gradient-to-br from-blue-600 to-blue-800 rounded-2xl shadow-lg p-8 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-blue-100 text-sm font-semibold mb-2">Análises</p>
                  <p className="text-3xl font-bold">0</p>
                </div>
                <User className="w-12 h-12 text-blue-200 opacity-50" />
              </div>
            </div>
          </div>
        </div>

        {/* Features Section */}
        <div className="bg-gray-800/40 backdrop-blur-sm rounded-2xl shadow-lg p-8 border border-green-900/30">
          <h3 className="text-2xl font-bold text-white mb-6">Funcionalidades Disponíveis</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="p-6 bg-green-900/20 rounded-xl border border-green-900/40">
              <div className="text-3xl mb-3">📊</div>
              <h4 className="font-bold text-white mb-2">Análise de Dados</h4>
              <p className="text-green-300 text-sm">
                Ferramentas avançadas para análise de dados florestais
              </p>
            </div>

            <div className="p-6 bg-green-900/20 rounded-xl border border-green-900/40">
              <div className="text-3xl mb-3">🌍</div>
              <h4 className="font-bold text-white mb-2">Monitoramento</h4>
              <p className="text-green-300 text-sm">
                Acompanhe suas áreas florestais em tempo real
              </p>
            </div>

            <div className="p-6 bg-green-900/20 rounded-xl border border-green-900/40">
              <div className="text-3xl mb-3">🤖</div>
              <h4 className="font-bold text-white mb-2">IA Assistente</h4>
              <p className="text-green-300 text-sm">
                Consulte nossa IA especializada em engenharia florestal
              </p>
            </div>
          </div>
        </div>

        {/* IA Conversacional */}
        <div className="bg-gray-800/40 backdrop-blur-sm rounded-2xl shadow-lg p-6 border border-green-900/30">
          <div className="flex items-center justify-between mb-4 gap-4">
            <h3 className="text-xl font-bold text-white">IA Conversacional</h3>
            <div className="flex items-center gap-3">
              <select
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                className="bg-white/10 border border-white/20 text-white text-xs rounded-lg px-2 py-1 focus:border-green-400 focus:ring-green-400/40"
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
                className="text-xs text-green-200 hover:text-white transition-colors"
              >
                Limpar conversa
              </button>
              <span className="text-xs text-green-300">Beta</span>
            </div>
          </div>

          <div className="h-72 md:h-80 overflow-y-auto pr-2 space-y-3">
            {messages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                className={`rounded-xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-green-600/30 text-white ml-auto max-w-[85%]'
                    : 'bg-white/10 text-green-100 max-w-[85%]'
                }`}
              >
                {msg.content}
              </div>
            ))}
            {chatLoading && (
              <div className="bg-white/10 text-green-100 max-w-[85%] rounded-xl px-4 py-3 text-sm">
                Pensando...
              </div>
            )}
          </div>

          <form onSubmit={onSendMessage} className="mt-4 flex flex-col gap-3">
            {imagePreview && (
              <div className="flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl p-2">
                <img
                  src={imagePreview}
                  alt="Prévia"
                  className="h-16 w-16 object-cover rounded-lg"
                />
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
              placeholder="Digite sua pergunta..."
              className="bg-white/10 border-white/20 text-white placeholder:text-white/40 focus:border-green-400 focus:ring-green-400/40"
            />
            <div className="flex gap-3">
              <label className="bg-white/10 border border-white/20 text-white text-xs rounded-lg px-3 py-2 cursor-pointer hover:bg-white/15 transition-colors">
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
                className="bg-green-600 hover:bg-green-700 text-white font-semibold px-4"
              >
                {imageUploading ? 'Enviando...' : 'Enviar'}
              </Button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
