# 09 — Validação com Santa Clara (CAR 270069)

## Pré-requisitos

```bash
export SIMCAR_CPF='...'          # técnico Álvaro
export SIMCAR_SENHA='...'
export SIMCAR_TEST_CAR_ID=270069
export PROCESSAR_MODE=ORACULO
```

ZIPs de laboratório (já no scratch / fixtures):

| ZIP | Expectativa import SEMA | Expectativa process |
|-----|-------------------------|---------------------|
| `backend/fixtures/teste_1/Recorte_SANTA_CLARA_FINAL_16-07-26.zip` | FINALIZADO (histórico) | pode ter pendências |
| `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V22_*.zip` | FINALIZADO | AREA_UMIDA contida ×41 |
| `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V23_*.zip` | COM_PENDENCIA: pontos repetidos ×11 | — |
| `.oraculo-scratch/santa_clara/Recorte_SANTA_CLARA_V24_*.zip` | FINALIZADO (se gerado) | a confirmar process |

## Checklist P1 (import via API do site)

1. Subir backend local com env.
2. Abrir aba Processar projeto.
3. Upload V23.
4. Timeline mostra: fila → prepare → upload → import poll.
5. Resultado COM_PENDENCIA; PDF import baixável.
6. Resumo: AREA_UMIDA pontos repetidos quantidade 11 (ou equivalente parseado).

## Checklist P3 (process)

1. Upload V22 ou V24 com import FINALIZADO.
2. Clicar Processar.
3. Aguardar COM_PENDENCIA ou FINALIZADO.
4. PDF process + (se houver) ZIP erros.
5. V22: esperar mensagem contenção AREA_UMIDA qty ~41.

## Checklist prepare (P2)

1. Forçar município diferente no projeto-teste (manual no SIMCAR).
2. Upload shape Santa Clara.
3. Timeline: “ajustando município…”.
4. `Buscar` após job: município restaurado/alvo.
5. Abrangência: reduzir artificialmente no SIMCAR → job expande → import ok.

## Checklist anti-regressão LOCAL

```bash
PROCESSAR_MODE=LOCAL npx vitest run --root . \
  backend/processar-projeto.test.ts \
  backend/geometry-errors.test.ts
```
Expected: pass (paridade local oráculo geométrico preservada).

## Critério de aceite da fase ORACULO (P0–P4)

- [ ] Credenciais só no env do PC
- [ ] Import de ZIP do usuário no CAR teste
- [ ] PDF import no front
- [ ] Process + PDF process no front
- [ ] Timeline compreensível
- [ ] Fila serial (2 uploads simultâneos não corrompem)
- [ ] Prepare município/abrangência quando endpoints prontos
- [ ] Botão autofix visível mas disabled (P5)

## Não fazer nesta validação

- Loop de 20 versões de shape
- Push de credenciais
- Processar CAR de cliente real
