import { describe, expect, it } from 'vitest';
import { mapLotesDocToHistoryItem } from './mappers';

describe('mapLotesDocToHistoryItem', () => {
  it('mapeia um job concluído com o relatório dos lotes', () => {
    const item = mapLotesDocToHistoryItem('job-1', {
      jobId: 'job-1',
      status: 'completed',
      fase: 'concluido',
      percent: 100,
      filename: 'recibos.zip',
      lotesConcluidos: 2,
      totalLotes: 2,
      outputFilename: 'lotes_simcar_20260805-140233.zip',
      outputBytes: 654219,
      downloadUrl: '/api/simcar-lotes/download/job-1',
      completedAt: '2026-08-05T17:40:00.000Z',
      relatorio: [
        {
          filename: 'recibo1.pdf',
          car: 'MT10005/2019',
          propriedade: 'LOTE RURAL 81',
          municipio: 'Querência',
          pasta: 'MT10005-2019 - LOTE_RURAL_81',
          baixados: ['Arquivo Enviado.zip', 'Recibo de Inscricao.pdf'],
          faltantes: ['Arquivo Processado.zip'],
          erro: null,
        },
      ],
    });

    expect(item).toMatchObject({
      jobId: 'job-1',
      status: 'completed',
      percent: 100,
      filename: 'recibos.zip',
      lotesConcluidos: 2,
      totalLotes: 2,
      outputFilename: 'lotes_simcar_20260805-140233.zip',
      outputBytes: 654219,
      timestamp: '2026-08-05T17:40:00.000Z',
    });
    expect(item.downloadUrl).toContain('/api/simcar-lotes/download/job-1');
    expect(item.relatorio?.[0].faltantes).toEqual(['Arquivo Processado.zip']);
  });

  it('trata status desconhecido como processando', () => {
    const item = mapLotesDocToHistoryItem('job-2', { status: 'seja-la-o-que-for' });
    expect(item.status).toBe('processing');
    expect(item.percent).toBe(0);
  });

  it('conta lotes sem erro quando lotesConcluidos não veio', () => {
    const item = mapLotesDocToHistoryItem('job-3', {
      status: 'completed',
      relatorio: [
        { filename: 'a.pdf', car: 'MT1/2020', baixados: ['Arquivo Enviado.zip'], faltantes: [], erro: null },
        { filename: 'b.pdf', car: null, baixados: [], faltantes: [], erro: 'CAR não localizado' },
      ],
    });
    expect(item.lotesConcluidos).toBe(1);
    expect(item.totalLotes).toBe(2);
    // Sem `percent` no doc, um job concluído aparece como 100%.
    expect(item.percent).toBe(100);
  });

  it('sobrevive a um doc vazio (job recém-criado)', () => {
    const item = mapLotesDocToHistoryItem('job-4', {});
    expect(item.jobId).toBe('job-4');
    expect(item.filename).toBe('Lotes SIMCAR');
    expect(item.relatorio).toBeUndefined();
    expect(item.status).toBe('processing');
  });
});
