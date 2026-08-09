# 2026-08-09 — Varredura de bugs (somente leitura, nada foi alterado)

Varredura completa do código atrás de bugs, erros de código e erros de documentação.
Consolidação de **6 auditorias paralelas** (geometry, simcar, pós-recorte, core,
frontend, docs) disparadas como subagentes, com os achados **críticos/altos
re-verificados diretamente no código**.

**Baseline confirmado:** `pnpm check` limpo · `pnpm test` 632 passed / 8 skipped /
0 falhas · `tsc --noEmit` limpo.

**Regra de ouro desta rodada:** nada foi corrigido — é só registro para o trabalho
seguinte. Nada aqui toca em segurança.

---

## 🔴 Crítico / Alto (verificados)

### 1. Download do recorte SIMCAR sempre dá 401 — `backend/simcar/routes.ts:721`

`GET /api/simcar/clip/download/:jobId` exige `req.authUid`, mas nenhum middleware o
popula: a rota não está em `auth-required-paths.ts` (a regex `^\/api\/simcar\/clip\/[^/]+$`
não cobre 2 segmentos) e `attachOptionalAuth` só é aplicado em `POST /api/simcar/clip`
e uploads. O `downloadUrl` que o backend anuncia (`clip-pipeline.ts:1048`,
`routes.ts:660`) **falha sempre**. Mitigado porque o front prefere `outputZipUrl`
(estático), mas é endpoint morto/mentiroso.

### 2. Reprovação do SIMCAR vira "importação OK" — `backend/simcar-oraculo/import-shape.ts:195-207`

`ok: reallyOk || ok` ≡ `ok`, já que `reallyOk` é mais restrito. Resultado
`FINALIZADO … REPROVADO` sai com `ok: true` → autofix não dispara
(`pipeline.ts:643`) e o pipeline emite *"Importação aprovada pela SEMA."* para uma
reprovação. `process-geo.ts:170` faz certo (`ok: reallyOk`) — cópia divergente.

### 3. Job de geometria trava com camada UTM — `backend/geometry/utils.ts:378` (`sampleRingEveryMeters`)

Projeta **sempre de WGS84** (`proj4("WGS84", metricProjDef)`), ignorando o CRS da
camada. Em camada UTM (metros), `toM.forward()` re-projeta metros como lon/lat → `len`
vira milhões → `steps` explode (medido: ~953k pontos num anel de 4 segmentos) →
`detectUmidaContainment` roda incondicionalmente (`umida-containment.ts:95`) e o job
nunca termina. O padrão correto já existe em `gaps.ts:87-95` (checa `crs.kind`).

### 4. Race de conversa no chat (corrupção de dados) — `client/src/pages/Dashboard.tsx:3751` + `2843`

No fim do SSE, `updateConversationMeta` grava em **`activeConversationRef` — a
conversa ativa no momento do término**, não a de origem. Trocar de conversa enquanto o
stream roda grava a resposta da conversa A **no Firestore da conversa B**.

### 5. CRS UTM sem a palavra "ZONE" não é reconhecido — `backend/geo-utils.ts:146-148`

`.prj` ESRI oficial `SIRGAS_2000_UTM_21S` não tem "ZONE" → `detectUtmProj` retorna
null → `detectCrs` classifica camada UTM como geográfica EPSG:4674 → áreas em metros
viram graus (validações impeditivas falsas ou silêncio, sem warning).
`resolveShapefileCrs` (174-199) pelo menos lança erro; `detectCrs` não usa esse caminho.

### 6. `minOverlapM2` vaza para contenção, vazios e AIR×ATP — `backend/geometry/job.ts:105,131,178`

O comentário (100-104) diz que `minOverlapM2` "não serve para contenção", mas ele
entra no `Math.max(..., sliver)` (105), no `minDiffM2` (131) e no `minGapM2` (178).
Subir o limiar de sobreposição na UI muda silenciosamente 3 outras validações —
contradiz o changelog 2026-08-08 §1.5 ("pisos próprios").

---

## 🟠 Médio (resumo, com localização)

| # | Onde | Bug |
|---|---|---|
| 7 | `geometry/vertices-proximas/detector.ts:39-49` | Sem tolerância: loop O(n²) materializa **todos** os pares em memória (estoura em camadas reais) |
| 8 | `geometry/detectors/containment.ts:108` | Sliver filtrado **por parte**, não pelo total: 6 lascas de 400 m² (2.400 m² fora) passam despercebidas |
| 9 | `geometry/detectors/reservatorio.ts:33-53` | Sem `.dbf`, acusa reservatório "sem barramento" às cegas — filosofia oposta à ARL (`containment.ts:56-64`, que não aplica regra sem dbf) |
| 10 | `geometry/routes.ts:140-168` | Corrida no SSE: job pode concluir entre leitura de status e `set` do subscriber → cliente fica pendurado sem evento terminal |
| 11 | `geometry/job.ts:105` vs `process-phase.ts:72` | Pisos divergentes entre os 2 pipelines: contenção 500 m² vs 100 m²; `pairMin` só num deles → mesmo ZIP reprovado num e aprovado no outro |
| 12 | `geometry/report.ts:157-158,164-218` | `.prj` de saída usa a **primeira** camada para todos os shapefiles de erro (camadas com CRS mistos saem georreferenciadas errado) |
| 13 | `overlap/utils.ts:64-70` vs `72-127` | Área esférica (turf) e planar (UTM densificado) misturadas no mesmo limiar (0,5) → decisões borderline arbitrárias |
| 14 | `analise-pos-recorte/wms-scenes.ts:117-126` | `Number(env)` sem validação: env não numérica → `Math.max(1, NaN)` = **NaN** → gates de resolução quebram silenciosamente |
| 15 | `analise-pos-recorte/text-sanitizer.ts:29-40` | Plurais não casam: `\binfracao\b` não pega "infrações", nem "multas"/"embargos"/"irregularidades" (mesma lacuna no check do laudo DeepSeek) |
| 16 | `analise-pos-recorte/schemas.ts:86-90` | **Fase 1 não valida `year` vs sceneId** (F2/F3 validam) — ano alucinado entra no redutor |
| 17 | `analise-pos-recorte/ac-vegetacao/evidence-reducer.ts:202-206` | `SEM_VEGETACAO_APARENTE` possível **sem a cena atual**: cena 2024 `NOT_OBSERVABLE` + NIR+SPOT (2008, contexto) dizem NONE → veredito com 2 cenas e a mais relevante fora (`DEFAULT_MIN_USABLE=2`) |
| 18 | `analise-pos-recorte/pos2008/report-builder.ts:149` | `retryable` calculado e **nunca usado** — F2 não retenta DeepSeek (F1 retenta 2×); model hardcoded `deepseek-v4-pro` |
| 19 | `simcar-lotes/resolver.ts` | `fetch` sem timeout no `listarPublico` (job pendura) + fallback `encontrados[0]` pode resolver **CAR errado** |
| 20 | `simcar/attribute-mapper.ts:137-139` | `FAIXA_APP=30` sobrescreve valor real do WFS (`setMappedAttribute` em vez de `IfEmpty`) — contradiz comentário 124-126 |
| 21 | `simcar/analysis.ts:3737-3753` | `AUAS_INVALIDA` inalcançável no determinístico (só via parsing da IA); sem AUAS + sem evidência → `AUAS_VALIDA` |
| 22 | `client/src/lib/localFirestore.ts:75-100` | `getDoc`/`setDoc`/`deleteDoc` **não checam `res.ok`** — falha de rede "some" silenciosamente (chat/preferências) |
| 23 | `client/src/dashboard/hooks/useLandsatJobs.ts:431-445` | DELETE não aborta SSE → snapshot posterior **ressuscita job deletado** |
| 24 | `client/src/components/Map.tsx:198-249` + `Dashboard.tsx:7247` | Mapa de erros de geometria **stale**: `initialCenter`/`onMapReady` só no mount; trocar de erro A→B mantém marcador em A (mesmo padrão no preview Landsat) |
| 25 | `client/src/pages/Dashboard.tsx:827` | "Uso de hoje" com `toISOString().slice(0,10)` — **UTC**: entre 21h e 23h59 agrupa no dia anterior |
| 26 | `client/src/dashboard/hooks/useSimcarClipJobs.ts:82` | `loadSimcarClipLayers` usa fetch cru sem `Authorization` (todos os outros usam apiFetch) |
| 27 | `client/src/pages/Dashboard.tsx:3711-3713` + `779-849` | `applyBillingToWallet` acumula a cada chunk com `billing` — billing duplicado no stream dobra saldo local |

---

## 🟡 Baixo (seleção)

- **Mojibake em mensagens de erro exibidas ao usuário** (latin-1 vs UTF-8):
  `backend/index.ts:493-818`, `routes/map.ts:58-153`, `routes/geometry.ts`, e regex
  de seleção de modelo com `sat[eÃ©]lite` (`index.ts:388-404`) que não casa "satélite".
- **Fetches sem timeout**: `routes/map.ts:129`, `lib/map-utils.ts:396`,
  `landsat/composite.ts:42`, `cbers/archive.ts`, `simcar-lotes/resolver.ts`,
  `index.ts:554-580` (chat Groq) — todos penduram com upstream travado.
- **Caches sem teto**: `billing.ts:63` (`usageStore` push eterno),
  `knowledge-base.ts:524` (selectionCache sem poda), `simcar-lotes/sse.ts`
  (subscribers nunca removidos no close).
- **`/api/me` sem try/catch** (`routes/account.ts:28`) — token inválido vira unhandled rejection.
- **Código morto**: `ManusDialog.tsx` (não importado), `compressForVision`,
  `buildWmsMapUrl`, `AC_AVN_FIXED_KEYS` (chaves não existem), `force` em
  `routes.ts:1683`, `preserveOriginalCrs`/`useMetricTemporaryCrs`.
- **Oráculo ainda montado** (`_registry.ts:47`) com o cabeçalho "DESATIVADO PARA
  SEMPRE" — rotas vivas por HTTP se as credenciais existirem (decisão de produto).
- **Doc drift**:
  - README "Estrutura do Projeto" descreve monólito pré-desmembramento (arquivos que
    não existem: `landsat.ts`, `cbers-archive.ts`; contagens 2× erradas);
  - `env.example` sem ~25 vars novas (SIMCAR_AUAS_*, SIMCAR_AC_VEG_*,
    SIMCAR_MONITOR_*);
  - CLAUDE.md: KB em `config/knowledge-base/` que não existe (é `banco_de_dados/`);
  - PRODES/SFB documentadas mas **nunca lidas**;
  - changelog F2_F3 diz "config.ts ainda não lê as flags" (superado no mesmo dia);
  - `STATUS.md` sem a rodada 08/08.

---

## Limpas (sem achados)

- fila simcar-lotes (session-queue)
- download cbers com stall detection
- stac-search landsat
- processar-projeto (410 legado)
- autofix do oráculo
- fases/phases.ts (gates F1→F2→F3 corretos)

---

## Método

6 subagentes paralelos por área (geometry, simcar, pós-recorte, core, frontend, docs),
consolidação manual, re-verificação adversarial dos achados críticos/altos direto no
código, e validação de baseline (`pnpm check`, `pnpm test`, `tsc --noEmit`).

Nada foi alterado no repo. Próximo passo proposto (não executado): corrigir os itens
1–6 (críticos), depois os médios em lote por pacote.
