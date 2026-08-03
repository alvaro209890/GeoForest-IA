# CHANGELOG 2026-08-03 — Auditoria pós-divisão (Planos 01–03) + correção de constantes/tipo fantasma em `backend/simcar/`

> Verificação solicitada após o pull das 34 commits do desmembramento (`backend/index.ts`,
> `backend/simcar-clip.ts`, `client/src/pages/Dashboard.tsx`). Objetivo: confirmar que as
> divisões não introduziram bugs. Resultado: **nenhum bug funcional em produção**, mas 3
> divergências latentes encontradas e corrigidas no barrel público de `backend/simcar/`.

## Validação geral (antes de qualquer mudança)

| Checagem | Resultado |
|---|---|
| `pnpm run check` (`tsc --noEmit`) | ✅ limpo |
| `pnpm test` (`vitest run`) | ✅ 386 testes passando, 8 skipped (testes "live" que exigem API keys reais) |
| `pnpm run build:app` (Vite, frontend) | ✅ build ok, chunks lazy dos panels preservados |
| `pnpm run build:admin` | ✅ build ok |
| `esbuild backend/index.ts` (bundle backend) | ✅ 1.2mb, ok |

Conclusão: os Planos 01–03 (backend/index.ts, simcar-clip.ts → `backend/simcar/`,
Dashboard.tsx → `client/src/dashboard/`) não quebraram nada em produção — tudo que roda
hoje usa os arquivos corretos.

## Achados: constantes e tipo duplicados divergentes em `backend/simcar/`

Auditoria manual (grep de exports top-level duplicados entre arquivos do mesmo módulo)
achou 3 nomes exportados em **dois lugares com conteúdo diferente** — sobra da extração
do monólito, nunca centralizados como o plano recomendava ("tipos usados por múltiplos
módulos → `types.ts`"). O **barrel público** `backend/simcar/index.ts` reexportava a
versão **errada/obsoleta** das três:

| Nome | Versão viva (usada de fato pelas rotas/análise) | Versão fantasma que o barrel expunha |
|---|---|---|
| `ANALYSIS_VISION_MODELS` | `analysis.ts:886` — `meta-llama/llama-4-maverick...`, `llama-4-scout...` | `constants.ts:92` — `groq/qwen-qwen3.6-27b`, `groq/llama-4-scout...` (lista diferente) |
| `GROQ_TEXT_MODELS` | `analysis.ts:890` — `gpt-oss-120b`, `llama-3.3-70b`, `qwen3-32b` | `constants.ts:97` — `llama-4-maverick`, `qwen-qwen3.6-27b`, `deepseek-r1` (lista totalmente diferente) |
| `SimcarReportArtifact` (type) | `report.ts:20` — campos de PDF (`reportPdfUrl`, `reportPdfStatus`...) | `types.ts:203` — campos de área/resumo (`areaTotalHa`, `summaryMd`...) — mesmo nome, formato incompatível |

**Impacto real:** nenhum, hoje — `routes.ts` e `analysis.ts` sempre importaram essas três
coisas diretamente do arquivo certo (`./analysis`, `./report`), nunca do barrel. Nenhum
consumidor externo ao módulo importava do barrel `backend/simcar` até agora (confirmado
por grep no repo inteiro).

**Risco que existia:** o barrel é a "API pública" do módulo segundo o próprio
`plano_melhoria_codigo/02_simcar_clip.md`. Qualquer código futuro (novo endpoint, script,
frontend) que importasse `ANALYSIS_VISION_MODELS`/`GROQ_TEXT_MODELS`/`SimcarReportArtifact`
de `backend/simcar` receberia dados/tipos errados silenciosamente, sem erro de compilação
(TypeScript não acusa porque os nomes não colidem — estão em arquivos-fonte diferentes).

## Correção aplicada

- `backend/simcar/constants.ts` — removidas as constantes `ANALYSIS_VISION_MODELS` e
  `GROQ_TEXT_MODELS` obsoletas (a versão viva já existia em `analysis.ts`).
- `backend/simcar/types.ts` — removido o tipo `SimcarReportArtifact` obsoleto (a versão
  viva já existia em `report.ts`).
- `backend/simcar/index.ts` — barrel agora reexporta as três coisas das fontes vivas
  (`./analysis` e `./report`) em vez das obsoletas.

Zero mudança de comportamento — só remoção de código morto/divergente e correção do
barrel. Revalidado após a correção: `tsc --noEmit`, `vitest run` (386 testes),
`esbuild backend/index.ts` — todos verdes.

## Auditoria do lado do Dashboard (Plano 03)

Mesma checagem (exports duplicados entre arquivos) rodada em `client/src/dashboard/`:
**nenhuma duplicação encontrada**. A divisão do Dashboard está limpa.
