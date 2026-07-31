import { describe, expect, it } from 'vitest';

import { formatSimcarAuasPolygonStatus, formatSimcarAuasPre2008Status } from './AuasPre2008Summary';

describe('formatSimcarAuasPre2008Status', () => {
  it('mapeia ALERTA_PRE_2008 para badge vermelho', () => {
    const result = formatSimcarAuasPre2008Status('ALERTA_PRE_2008');
    expect(result.label).toBe('Alerta pré-2008');
    expect(result.className).toContain('red');
  });

  it('mapeia SEM_EVIDENCIA_PRE_2008 para badge neutro/verde', () => {
    const result = formatSimcarAuasPre2008Status('SEM_EVIDENCIA_PRE_2008');
    expect(result.label).toBe('Sem evidência pré-2008');
    expect(result.className).toContain('emerald');
  });

  it('mapeia INCONCLUSIVO e valores ausentes para âmbar', () => {
    expect(formatSimcarAuasPre2008Status('INCONCLUSIVO').className).toContain('amber');
    expect(formatSimcarAuasPre2008Status(undefined).className).toContain('amber');
  });
});

describe('formatSimcarAuasPolygonStatus', () => {
  it('distingue os dois tipos inconclusivos com rótulos diferentes', () => {
    const marco = formatSimcarAuasPolygonStatus('INCONCLUSIVO_NO_MARCO_2008');
    const generic = formatSimcarAuasPolygonStatus('INCONCLUSIVO');
    expect(marco.label).toBe('Inconclusivo no marco 2008');
    expect(generic.label).toBe('Inconclusivo');
    expect(marco.className).toContain('amber');
    expect(generic.className).toContain('amber');
  });

  it('mapeia alerta e sem evidência corretamente', () => {
    expect(formatSimcarAuasPolygonStatus('ALERTA_PRE_2008').label).toBe('Alerta pré-2008');
    expect(formatSimcarAuasPolygonStatus('SEM_EVIDENCIA_PRE_2008').label).toBe('Sem evidência pré-2008');
  });
});
