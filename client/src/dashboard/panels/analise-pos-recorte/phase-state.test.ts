/**
 * F-01 e F-02 do plano `docs/planos/analise-pos-recorte/09-testes-e-validacao.md`:
 * o painel mostra sempre os 3 cards, com bloqueio explicado em texto.
 */
import { describe, expect, it } from 'vitest';

import {
  buildPhaseCards,
  formatEta,
  isPhase1MetaCompleted,
  type PhaseStatus,
  type PhasesResponse,
} from './phase-state';

function status(overrides: Partial<PhaseStatus> = {}): PhaseStatus {
  return {
    state: 'BLOCKED',
    blockedReason: null,
    blockedMessage: null,
    rulesVersion: null,
    completedAt: null,
    stale: false,
    summary: null,
    estimate: null,
    report: null,
    ...overrides,
  };
}

function payload(overrides: Partial<Record<keyof PhasesResponse['phases'], PhaseStatus>> = {}): PhasesResponse {
  return {
    jobId: 'job-1',
    layers: { auasPolygonCount: 17, acPolygonCount: 9 },
    phases: {
      PRE_2008: status({
        state: 'AVAILABLE',
        estimate: { polygons: 17, scenesPerPolygon: 6, windowsPerPolygon: 3, etaSeconds: 2550 },
      }),
      POS_2008: status({ blockedReason: 'requires_PRE_2008', blockedMessage: 'Conclua a Fase 1 (AUAS 2003–2008) para liberar.' }),
      AC_VEG: status({ blockedReason: 'requires_PRE_2008', blockedMessage: 'Conclua a Fase 1 (AUAS 2003–2008) para liberar.' }),
      ...overrides,
    },
  };
}

describe('buildPhaseCards', () => {
  it('F-01: sempre 3 cards, com a Fase 1 habilitada e as outras bloqueadas com motivo legível', () => {
    const cards = buildPhaseCards(payload());
    expect(cards.map((c) => c.order)).toEqual([1, 2, 3]);
    expect(cards[0].actionEnabled).toBe(true);
    expect(cards[0].preview).toContain('17 polígono(s) AUAS');
    expect(cards[0].preview).toContain('~43 min');
    expect(cards[1].actionEnabled).toBe(false);
    expect(cards[1].blockedMessage).toMatch(/Fase 1/);
    expect(cards[2].actionEnabled).toBe(false);
    expect(cards[2].blockedMessage).toBeTruthy();
  });

  it('F-02: Fase 1 concluída vira "Refazer" e mostra o resultado resumido', () => {
    const cards = buildPhaseCards(
      payload({
        PRE_2008: status({
          state: 'COMPLETED',
          completedAt: '2026-08-05T17:20:00.000Z',
          summary: { alertCount: 3, inconclusiveCount: 2 },
        }),
      }),
    );
    expect(cards[0].state).toBe('COMPLETED');
    expect(cards[0].actionLabel).toBe('Refazer');
    expect(cards[0].resultLine).toContain('3 com evidência pré-2008');
    expect(cards[0].resultLine).toContain('2 inconclusivo(s)');
  });

  it('sem alerta a frase não sugere desmate', () => {
    const cards = buildPhaseCards(
      payload({
        PRE_2008: status({ state: 'COMPLETED', completedAt: '2026-08-05T17:20:00.000Z', summary: { alertCount: 0, inconclusiveCount: 0 } }),
      }),
    );
    expect(cards[0].resultLine).toContain('nenhuma evidência pré-2008');
  });

  it('fase ainda não implementada fica desabilitada e sinalizada como tal', () => {
    const cards = buildPhaseCards(
      payload({
        PRE_2008: status({ state: 'COMPLETED', completedAt: '2026-08-05T17:20:00.000Z' }),
        POS_2008: status({ blockedReason: 'phase_not_implemented', blockedMessage: 'Fase ainda não disponível nesta versão do GeoForest.' }),
      }),
    );
    expect(cards[1].notImplemented).toBe(true);
    expect(cards[1].actionEnabled).toBe(false);
    expect(cards[1].blockedMessage).toMatch(/não disponível/);
  });

  it('enquanto a Fase 1 roda, nenhuma outra fase pode ser disparada', () => {
    const cards = buildPhaseCards(payload(), { runningPhase: 'PRE_2008' });
    expect(cards[0].state).toBe('RUNNING');
    expect(cards[0].actionLabel).toBe('Analisando…');
    expect(cards[0].actionEnabled).toBe(false);
    expect(cards[1].actionEnabled).toBe(false);
    expect(cards[1].blockedMessage).toMatch(/Aguardando a Fase 1/);
  });

  it('falha na consulta não faz a Fase 1 sumir', () => {
    const cards = buildPhaseCards(null, { error: true });
    expect(cards).toHaveLength(3);
    expect(cards[0].actionEnabled).toBe(true);
    expect(cards[0].blockedMessage).toMatch(/continua disponível/);
    expect(cards[1].actionEnabled).toBe(false);
  });

  it('durante o carregamento nada é clicável, mas os 3 cards já aparecem', () => {
    const cards = buildPhaseCards(null, { loading: true, fallbackLayers: { auasPolygonCount: 4, acPolygonCount: 0 } });
    expect(cards).toHaveLength(3);
    expect(cards.every((c) => !c.actionEnabled)).toBe(true);
    expect(cards[0].preview).toContain('4 polígono(s) AUAS');
    expect(cards[2].preview).toContain('não tem Área Consolidada');
  });

  it('resultado de execução anterior é marcado como stale, não sumido', () => {
    const cards = buildPhaseCards(
      payload({ POS_2008: status({ blockedReason: 'requires_PRE_2008', blockedMessage: 'x', stale: true }) }),
    );
    expect(cards[1].stale).toBe(true);
  });

  it('camada AUAS vazia é explicada, não é erro', () => {
    const cards = buildPhaseCards({
      jobId: 'j',
      layers: { auasPolygonCount: 0, acPolygonCount: 0 },
      phases: {
        PRE_2008: status({ blockedReason: 'layer_empty_AUAS', blockedMessage: 'Este recorte não tem camada AUAS com polígonos.' }),
        POS_2008: status({ blockedReason: 'layer_empty_AUAS', blockedMessage: 'Este recorte não tem camada AUAS com polígonos.' }),
        AC_VEG: status({ blockedReason: 'layer_empty_AREA_CONSOLIDADA', blockedMessage: 'Este recorte não tem Área Consolidada.' }),
      },
    });
    expect(cards[0].actionEnabled).toBe(false);
    expect(cards[0].preview).toContain('Nenhum polígono AUAS');
    expect(cards[2].blockedMessage).toMatch(/Área Consolidada/);
  });
});

describe('formatEta', () => {
  it('formata segundos, minutos e horas', () => {
    expect(formatEta(45)).toBe('~45 s');
    expect(formatEta(600)).toBe('~10 min');
    expect(formatEta(4800)).toBe('~1 h 20 min');
    expect(formatEta(7200)).toBe('~2 h');
  });
});

describe('isPhase1MetaCompleted', () => {
  it('só aceita bloco V2 com completedAt', () => {
    expect(isPhase1MetaCompleted({ schemaVersion: 2, completedAt: '2026-08-05T17:20:00.000Z' })).toBe(true);
    expect(isPhase1MetaCompleted({ schemaVersion: 2, completedAt: '' })).toBe(false);
    expect(isPhase1MetaCompleted({ finalStatus: 'AUAS_VALIDA' })).toBe(false);
    expect(isPhase1MetaCompleted(undefined)).toBe(false);
  });
});

describe('as 3 análises são independentes no card', () => {
  it('nenhuma fase mostra rótulo de continuação — todas começam com "Analisar"', () => {
    const estado = payload({
      PRE_2008: status({ state: 'AVAILABLE' }),
      POS_2008: status({ state: 'AVAILABLE' }),
      AC_VEG: status({ state: 'AVAILABLE' }),
    });
    const cards = buildPhaseCards(estado, {});
    for (const card of cards) {
      expect(card.actionLabel).toBe('Analisar');
      expect(card.actionEnabled).toBe(true);
    }
  });

  it('fase COMPLETED tem o botão desabilitado enquanto outra roda', () => {
    // Sem isto o "Refazer" dispararia uma segunda análise no mesmo job.
    const estado = payload({
      PRE_2008: status({ state: 'AVAILABLE' }),
      POS_2008: status({ state: 'COMPLETED', completedAt: '2026-08-23T12:00:00.000Z' }),
      AC_VEG: status({ state: 'AVAILABLE' }),
    });
    const cards = buildPhaseCards(estado, { runningPhase: 'PRE_2008' });
    const f2 = cards.find((c) => c.id === 'POS_2008')!;
    expect(f2.actionEnabled).toBe(false);
    expect(f2.blockedMessage).toContain('Aguardando a Fase 1');
  });

  it('o laudo de cada fase aparece no card dela', () => {
    const links = { pdfUrl: 'https://s/f3.pdf', docxUrl: 'https://s/f3.docx', generatedAt: null, filename: 'f3.pdf' };
    const estado = payload({
      PRE_2008: status({ state: 'AVAILABLE' }),
      POS_2008: status({ state: 'AVAILABLE' }),
      AC_VEG: status({ state: 'COMPLETED', report: links }),
    });
    const cards = buildPhaseCards(estado, {});
    expect(cards.find((c) => c.id === 'AC_VEG')!.report?.pdfUrl).toBe('https://s/f3.pdf');
    expect(cards.find((c) => c.id === 'PRE_2008')!.report).toBeNull();
  });
});
