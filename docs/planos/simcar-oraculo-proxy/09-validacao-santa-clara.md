# 09 — Validação E2E (CAR 270069 Santa clara)

## Pré-requisitos

```bash
set -a && source .oraculo-scratch/simcar-oraculo.env && set +a   # neste PC (gitignored)
# ou env do systemd no PC servidor
```

ZIPs-oráculo (resultados REAIS já conhecidos da SEMA, 16/07):

| ZIP | Import esperado | Process esperado |
|-----|-----------------|------------------|
| `backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip` | [FINALIZADO] | pendências reais (reservatório/ARL dup) |
| `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V22_*.zip` | [FINALIZADO] | [COM_PENDENCIA] AREA_UMIDA contida ×41 |
| `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V23_*.zip` | [COM_PENDENCIA] pontos repetidos ×11 | — |
| `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V24_*.zip` | [FINALIZADO] | a confirmar |

Estado do CAR-teste é descartável (D1), mas ao TERMINAR uma bateria: reimportar o FINAL
para deixar o projeto num estado conhecido.

Calibração offline T7 concluída com cópias imutáveis dos PDFs reais em
`backend/fixtures/teste_1/`: V21 import (`AREA_UMIDA`, sobreposição ×1), V22 import aprovado,
V23 import (`AREA_UMIDA`, pontos repetidos ×11) e V22 process (`AREA_UMIDA`, contenção ×41).
Os hashes SHA-256 e o contrato estruturado estão registrados em `02-modulo-simcar-oraculo.md`.

Gate offline T8 concluído: mock aprovado encadeou prepare→import→ProcessarGeo; V23 reprovado
parou antes do process e estruturou pontos repetidos ×11; cancelamento durante import tentou o
endpoint remoto e terminou `cancelled`. A validação live desta seção continua pendente para T19.

Probe live read-only T9 no 270069: PDFs e ZIP enviado/conferência disponíveis; ZIP de erros,
processado e pendências responderam 400 (ausência válida no estado atual). O probe não alterou
o CAR; hashes/tamanhos estão em `11-endpoints-sema-descobertos.md`.

Gate offline T13 no V23 real: `remove_duplicate_vertices` alterou as mesmas 11 feições do
oráculo (73 vértices detalhados pelo detector), descartou 2 registros que colapsaram e deixou
zero ocorrência. A saída tem as mesmas 38 feições, 48 anéis, 3.187 pontos, sequência de IDs e
conjuntos de coordenadas do V24 `[FINALIZADO]`; apenas preserva a ordem original dos anéis onde
o protótipo os ordenava por área. Nenhuma chamada SEMA foi feita nesta prova; rodada real é T16.

Gate live T16 concluído em 2026-07-17 com o V23 de SHA-256 `22d79a…f21f5a`: prepare fez
skip seguro em Querência; rodada 1 voltou `[COM_PENDENCIA]` com os 11 pontos repetidos. O
plano veio de `deepseek-v4-pro` com uma única ação `remove_duplicate_vertices→AREA_UMIDA`;
diff: 11 feições, 73 vértices, 2 anéis e 2 registros removidos. O `corrigido_r2.zip` e o ZIP
oficial devolvido por `DownloadArquivoEnviado` foram byte a byte iguais (SHA-256
`5ba311…042e8d`). A rodada 2 voltou `[FINALIZADO]`, sem erros, em 138,5 s. Nome “Santa clara”
e município Querência/5107065 permaneceram intactos. A prova usou `autoProcess:false` para
isolar P5; T17 assume o processamento `[EM_ABERTO]`.

Gate T14: planner mockado passou 9/9 cenários (JSON válido/inválido, conteúdo vazio, timeout,
ação fora do inventário, camada inventada e ausência de chave). O teste live isolado com
DeepSeek V4 Pro e a chave efêmera de `~/.hermes/.env` passou em 8,6 s: propôs somente
`remove_duplicate_vertices` para `AREA_UMIDA`. Nenhuma credencial foi persistida e nenhuma
mutação SEMA ocorreu.

## Checklist P1.5 (rotas persistem de verdade)

- [ ] `POST /api/simcar-oraculo/pipeline` com V24 → doc em `users/{uid}/simcar_oraculo_jobs/{id}` existe e atualiza
- [ ] Timeline acumula (≥6 eventos distintos no doc final)
- [ ] Derrubar backend no meio → reiniciar → job marcado `interrupted` (não fica `running`)

## Checklist P2 (município + abrangência)

- [ ] Upload de shape de OUTRO município (usar recorte de teste de Nova Mutum/Canarana se
      houver; senão deslocar o bbox numa cópia sintética) → preview mostra município detectado
- [ ] Job muda o município do 270069 (timeline mostra antes/depois); `Buscar` confirma;
      `PropriedadeNome` continua **"Santa clara"** (D5 — conferir explicitamente)
- [ ] Job volta com shape da Querência → município restaurado automaticamente
- [ ] Reduzir abrangência na mão (app SIMCAR) → job expande; BaseRef aguardada; import OK
- [ ] Shape com centroid fora de MT → job falha CEDO com mensagem clara (não toca SEMA)

## Checklist P3.5/P4 (pipeline + front)

- [ ] V22 → timeline completa: fila→município(skip)→abrangência(skip)→upload→import
      FINALIZADO→process COM_PENDENCIA→artefatos; cards da rodada com PDF import, PDF process,
      ZIP erros, ZIP enviado baixáveis
- [ ] V23 (com autofix DESLIGADO via flag) → import_fail; PDF import baixável; resumo "pontos
      repetidos AREA_UMIDA ×11" parseado
- [ ] NENHUM traço de validação local na aba (sem relatório GeoForest, sem gate local)
- [ ] 2 uploads simultâneos (2 navegadores) → segundo mostra posição na fila; jobs não se
      intercalam; resultados corretos para cada um
- [ ] Cancelar no meio do poll → job `cancelled`, fila liberada
- [ ] Restaurar do histórico após F5 → snapshot + downloads ok (sem SSE religado se completed)
- [ ] Mobile: timeline legível, botões full-width

## Checklist P5/P6 (autofix)

- [x] V23 com autofix ligado → rodada 1 reprova, FixPlan gerado (explicação DeepSeek visível),
      rodada 2 importa **[FINALIZADO]** no SIMCAR real
- [x] fixplan.json salvo com ações + fonte (deepseek|fallback) — contrato e round-trip mock T15
- [ ] Derrubar DEEPSEEK_API_KEY → mesmo fluxo funciona via fallback (explicação template)
- [ ] V22 (P6) → clip de úmida na rodada 2 → process real sem os 41; reservatório/ARL dup
      reportados como "exige edição no GIS" (naoCorrigivel)
- [x] ZIP que não melhora (subir 2× o mesmo quebrado sem ação nova) → para com "sem melhora"
      antes do teto; botão manual desabilitado com motivo
- [x] 3 rodadas sem sucesso → para no teto com resumo do que sobrou (mock decrescente T15)

## Anti-regressão

```bash
npx vitest run --root . backend/simcar-oraculo backend/geometry-errors.test.ts
```
- [ ] Aba "Erros de Geometria" intacta (upload + análise local lá continua funcionando)
- [ ] `processar-projeto.test.ts`: testes das fases locais REMOVIDOS junto com o código (D2);
      upload/shape-context/storage continuam cobertos

## Critério de aceite final (espelha `12-checklist-mestre.md`)

- [ ] Credenciais só em env (repo público limpo — grep do 08 vazio)
- [ ] ZIP do usuário → veredito REAL da SEMA sem intervenção manual
- [ ] Município/abrangência ajustados sozinhos quando necessário, nome intocado
- [ ] Reprovações viram downloads oficiais + explicação + correção automática ≤3 rodadas
- [ ] Deploy no PC servidor validado com E2E deste arquivo
