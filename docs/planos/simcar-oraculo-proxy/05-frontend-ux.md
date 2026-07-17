# 05 — Frontend UX (v2: ORACULO-only, sem validação local)

## Arquivos

- `client/src/components/ProcessarProjetoAnalysis.tsx` (reescrita grande)
- `client/src/pages/Dashboard.tsx` — **4 pontos de wiring** (mapeados na leitura de 16/07):
  restauração de job (~4395-4414), sidebar histórico (~8248-8321), render (~11856-11889) e
  `mapProcessarDocToHistoryItem`. Todos hardcodam o union de status — atualizar os QUATRO
  juntos, senão cards caem no fallback "Falhou".

## Fatos do código atual que condicionam o design

| Fato | Consequência |
|------|--------------|
| Upload já devolve `mode/testCarId/simcarConfigured/shapePreview`, mas `applyZipFile` (253-257) ignora | ponto de entrada da UI nova |
| Não existe stepper/timeline em lugar nenhum (só barra única 893-909) | criar componente `OraculoTimeline` |
| SSE é parse manual de stream, sem retry (436-439) | adicionar retry/reconexão + fallback poll `/jobs/:id` |
| `applySnapshot`/`restoreFromEntry` inferem `importOk` do status (375-380, 579-581) | trocar por campos explícitos `importOk/processOk` do job novo |
| `startNewZip` (212-216) aborta SSE e reseta tudo | botão "Corrigir e reenviar" NÃO passa por ele (mantém job/contexto) |
| Jobs restaurados têm `File` placeholder vazio (384, 558) | nada novo pode depender de `file.size>0` |
| `onJobSnapshot` persiste o job inteiro no doc local | NÃO persistir `timeline` gigante/`rows` no histórico — só resumo + refs de artefatos |

## Layout da aba (v2)

```
┌──────────────────────────────────────────────────────────────┐
│ Processar projeto — SIMCAR real (SEMA)                        │
│ Projeto-teste: CAR 270069 · Santa clara · fila: livre         │
│ ⚠ O robô usa a conta técnica do escritório: sua sessão manual │
│   no SIMCAR pode ser derrubada enquanto um job roda.          │
├──────────────────────────────────────────────────────────────┤
│ [ Arraste o ZIP do recorte SIMCAR ]                           │
│ preview: 12 camadas · município detectado: QUERÊNCIA (IBGE)   │
│ [se não detectado: dropdown municípios MT]                    │
│ [▶ Enviar ao SIMCAR]  (auto: importa → processa → corrige ≤3) │
├──────────────────────────────────────────────────────────────┤
│ Timeline (rodada 2/3)                                         │
│ ✓ 10:01 Na fila (0 à frente)                                  │
│ ✓ 10:01 Município já é Querência                              │
│ ✓ 10:02 Abrangência cobre o imóvel                            │
│ ✓ 10:04 Importação FINALIZADA                                 │
│ ✓ 10:10 Processamento COM PENDÊNCIA (41 erros)                │
│ ✓ 10:11 Correção: recorte de AREA_UMIDA (41 feições)          │
│ ⏳ 10:13 Reimportando ZIP corrigido…       (████░░ 60%)        │
├──────────────────────────────────────────────────────────────┤
│ Resultado (por rodada, expansível)                            │
│ Rodada 1 ✗ process: AREA_UMIDA contida ×41                    │
│   [📄 PDF importação SEMA] [📄 PDF processamento SEMA]         │
│   [⬇ ZIP erros] [⬇ Enviado] [⬇ Processado] [⬇ Conferência]    │
│   [⬇ Pendências] [🔍 o que a IA entendeu]                     │
│ Rodada 2 ⏳ …                                                  │
├──────────────────────────────────────────────────────────────┤
│ [✨ Corrigir e reenviar]  (só quando loop automático parou e   │
│    ainda há ação mapeada; mostra modal com o FixPlan)         │
│ [✋ Cancelar job]  [🆕 Novo projeto (outro ZIP)]               │
└──────────────────────────────────────────────────────────────┘
```

## O que SOME da UI (D2)

- Seções "Importar (local)" / relatório local / tabela de erros do detector GeoForest.
- Botão de PDF de importação GeoForest (`import-report-pdf`) — substituído pelos PDFs da SEMA.
- Os 3 mini-cards estáticos "1 Importar / 2 Processar / Saída ZIP".
- Qualquer texto que sugira que o GeoForest valida algo: o veredito é da SEMA.

Sem credencial no servidor (`simcarConfigured=false`): a aba mostra estado vazio explicativo
("O servidor não está configurado para falar com o SIMCAR") — sem fallback local.

## Estados da UI

| Estado | Fonte |
|--------|-------|
| idle → dropzone | — |
| uploaded → preview + município + botão Enviar | upload response |
| queued/running → timeline viva | SSE + snapshot |
| import_fail / process_fail (rodada) → card da rodada + downloads + (se loop parou) botão Corrigir | job.rounds |
| done ok → verde + downloads da última rodada | job |
| failed (infra) → vermelho + motivo + tentar de novo | job.error |
| cancelled | job |

## Copy obrigatória

- Aviso de que o shape vai para o **projeto-teste do escritório** (CAR 270069), não para o CAR
  do cliente; jobs entram em fila.
- No FixPlan (modal e card): texto da explicação do DeepSeek + lista de ações mecânicas com
  contagens ("Remover 11 vértices repetidos em AREA_UMIDA").
- Quando autofix para: motivo claro ("Rodada 3/3 sem melhora" / "Erro exige edição no GIS:
  reservatório sem barramento").

## Histórico (Dashboard)

- `mapProcessarDocToHistoryItem` lê `simcar_oraculo_jobs` (novo) e `processar_projeto_jobs`
  (legado, só leitura).
- Card: nome do ZIP, data, rodadas, badge resultado final (import/process/corrigido), botão
  reabrir → snapshot + downloads (sem religar SSE se `completed`).

## Testes front

- Sem infra de teste de componente no repo → checklist visual em `09-validacao-santa-clara.md`
  + QA Playwright manual como nas outras abas (gotcha preview: usar chrome do sistema).

## Implementação T10 (2026-07-16)

- A aba foi reescrita como ORACULO-only: não chama mais `/importar` nem `/processar` locais.
- SSE consome envelopes `snapshot|event` reais, tenta reconectar três vezes e então consulta
  `GET /api/simcar-oraculo/jobs/:id` a cada 5 s; jobs terminais restauram só o snapshot.
- O callback do Dashboard recebe `roundsSummary` e `artifactRefs`, sem replicar `timeline` ou
  erros parseados completos.
- Verificação estática: TypeScript estrito e build Vite de produção verdes.

## Implementação T11 (2026-07-16)

- Dashboard consulta novo+legado em paralelo, deduplica por `jobId` e prefere o registro
  server-owned do Oráculo; o legado continua disponível sem escrita/exclusão.
- Mapper, restauração de job ativo, sidebar e callback do componente reconhecem todos os
  estados novos e usam `importOk/processOk` explícitos, sem inferir aprovação de `completed`.
- Cards mostram data, número de rodadas e resultado final; o card inteiro é um botão acessível.
- O callback atualiza apenas o estado React. Depois do F5, a fonte é o snapshot do backend.

## Encerramento P4 / T12 (2026-07-16)

- Os POSTs locais de importar/processar não possuem mais executor: respondem 410 com hint
  para `/api/simcar-oraculo/pipeline` durante uma versão de compatibilidade.
- Gate, auto-import fallback e job local saíram do caminho do produto. O PDF “estilo SEMA”
  fica disponível apenas para registros/testes legados e nunca é mostrado pela aba nova.
- Upload/preview e a aba Erros de Geometria permanecem independentes e cobertos por regressão.
