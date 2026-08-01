/**
 * Defaults do chat do Dashboard GeoForest.
 * Plano 03 — DEFAULT_ASSISTANT_MESSAGE movido de Dashboard.tsx.
 */
import type { ChatMessage } from '@/dashboard/types/history';

export const DEFAULT_ASSISTANT_MESSAGE: ChatMessage = {
  id: 'seed',
  role: 'ai',
  text: 'Olá! Sou a GeoForest IA. Posso apoiar análises ambientais, processamento de imagens de satélite e interpretação de dados florestais. Como posso ajudar hoje?',
  time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  meta: { model: 'auto' },
};
