# STATUS do plano — Oráculo SIMCAR (v2)

**Atualizado:** 2026-07-16 (noite) — plano reescrito (v2) com decisões do Álvaro + descoberta
completa dos endpoints SEMA. Rodada anterior (Hermes, P0/P1/P3) permanece válida.

## Decisões novas (ver 00-README)

D1 CAR-teste 270069 · D2 **remover validação local de vez** · D3 DeepSeek V4 Pro só
planeja/explica · D4 loop automático ≤3 rodadas · D5 `PropriedadeNome` intocável ·
D6 repo PÚBLICO → segredos só em env.

## Progresso

| Fase | Nome | Status |
|------|------|--------|
| P0 | Cliente + health + Buscar | ✅ (Hermes 16/07; live login/Buscar revalidado à noite) |
| P1 | Import API no CAR-teste | ✅ rotas prontas |
| **P1.5** | **Bugs bloqueantes (B1–B9)** | ✅ T1–T3 concluídas; B9 (modo local) sai em T18 |
| P2 | Município + abrangência | ✅ T4–T6; prepare live em skip e mutações T5 comprovadas |
| P3 | ProcessarGeo API | ✅ rotas prontas |
| P3.5 | Pipeline único + SSE + parse PDF | ⏳ T7–T9 |
| P4 | Front ORACULO-only | ⏳ T10–T12 |
| P5 | Autofix import + DeepSeek + loop | ⏳ T13–T16 |
| P6 | Autofix process | ⏳ T17 |
| P7 | Limpeza + deploy + E2E | ⏳ T18–T19 |

## Descobertas de 2026-07-16 (noite) — ver `11-endpoints-sema-descobertos.md`

- Endpoints de ESCRITA achados no bundle: `SalvarGrupoPropriedade`, `SalvarGrupoCaracterizacao`,
  `SalvarAreaAbrangencia {Id + 4 coords Gdec}`, `LimparAreaAbrangencia` (**destrutivo**),
  `ReprocessarBaseRef`.
- Live (read-only, conta técnica): `Buscar/270069` completo (abrangência mora nele;
  `Municipio {Id:751, Codigo IBGE 5107065}`), `BuscarStatusProcessamento` (BaseRef/Croqui),
  `ListarMatoGrosso` (142 `{Chave,Texto}`), `BuscarMunicipioGeo/{IBGE}` → polígono oficial.
- `ListarRasc` exige filtro específico (400 genérico) — desnecessário p/ nós.
- Estado atual do 270069: Situacao `[EM_CADASTRAMENTO]`, import `[FINALIZADO]` (V24),
  process `[COM_PENDENCIA]`, município Querência.

## Bugs achados na revisão do código (P1.5 — detalhe em `02`)

B1 whitelist `simcar_oraculo_jobs` AUSENTE (rotas não persistem!) · B2 completed fixo ·
B3 timeline não acumula · B4 pdf-import/process mesmo campo · B5 GET sem timeout ·
B6 sem relogin 401 · B7 interrupted não cobre coleções novas · B8 áreas de storage sem tipo ·
B9 comentário × código do default de modo.

### Evidência de implementação desta retomada

- **T1 concluída (2026-07-16):** `simcar_oraculo_jobs` liberada para leitura, escrita e
  listagem no storage local; áreas de artefato `simcar-oraculo/*` tipadas e criadas no
  scaffold. `backend/simcar-oraculo/local-storage.test.ts`: **7/7 testes verdes** em storage
  temporário isolado.
- **T2 concluída (2026-07-16):** timeline agora faz read+append+write do array real durante o
  job; reprovação da regra SEMA é `completed` com `importOk=false`; import e process usam
  `importPdf*`/`processPdf*` independentes. `job-store.test.ts`: **3/3 testes verdes**.
- **T3 concluída (2026-07-16):** GET respeita timeout; `withSimcarAuthRetry` reloga uma vez
  em 401 e é usado em Buscar/import/process/download; boot marca jobs ativos do oráculo e do
  legado como `interrupted`. Declaração de `scramble-impl.js` adicionada e `tsc --noEmit`
  ficou limpo. Gate: **64/64** testes do oráculo+geometria e **11/11** de processar-projeto.
- **T4 concluída (2026-07-16):** malha oficial IBGE 2024 simplificada e reproduzível
  (`config/municipios-mt.geojson`, 142 feições); detecção local no `shape-context` com
  reprojeção UTM→4326; fallback live `Geoportal:LIM_MUNICIPIOS_MT`; endpoint de dropdown
  casa a lista SIMCAR (142 itens) com IBGE. Querência = `5107065`/Chave `751` confirmada live.
- **T5 concluída (2026-07-16):** probe guardado por `SIMCAR_LIVE=1` validou no 270069:
  Querência→Canarana→Querência com `PropriedadeNome="Santa clara"` intacto; sobrescrita direta
  da abrangência confirmou em 4,883 s, **sem Limpar**, e restauração em 1,817 s. BaseRef ficou
  `null` após alterar/restaurar (3 polls, ~11 s), comportamento aceito pelo contrato. Estado
  final confirmado: Querência/5107065 e bbox original.
- **T6 concluída (2026-07-16):** `prepare-project.ts` implementa confirmação oficial do
  município, payload integral com guard de `PropriedadeNome`, cobertura com margem, overwrite
  direto + `Limpar` somente no fallback e máquina BaseRef (`null`/CONCLUIDO/ERRO/timeout).
  **11/11 testes**; smoke live com o ZIP FINAL confirmou skip seguro em Querência, abrangência
  já suficiente e zero mutações.

## Credenciais

- Conta técnica: valores em `.oraculo-scratch/simcar-oraculo.env` (gitignored, este PC) e no
  env do PC servidor. **Nunca** commitadas (repo público).
- DeepSeek: `DEEPSEEK_API_KEY` de `~/.hermes/.env` → env do backend.

## Como retomar

1. `12-checklist-mestre.md` (visão) → `07-tarefas-implementacao.md` (T1 em diante)
2. Antes de codar SEMA: `11-endpoints-sema-descobertos.md`
3. Validação: `09-validacao-santa-clara.md`
