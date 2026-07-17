# Plano v2: Processar Projeto = SIMCAR real (oráculo), sem validação local

> **For Hermes:** use subagent-driven-development; uma task de `07-tarefas-implementacao.md`
> por vez; commit ao fim de cada task. **Ler `11-endpoints-sema-descobertos.md` antes de
> qualquer código que fale com a SEMA.**

**Goal:** Na aba **Análise de Erros → Processar projeto**, o GeoForest **não valida nem
processa mais nada localmente**. O ZIP que o usuário sobe é enviado ao SIMCAR real da SEMA
no **CAR-teste 270069** (conta técnica do Álvaro): o backend confere o município do shape e,
se preciso, altera o município na aba Propriedade (**sem mudar o nome da propriedade**),
ajusta a área de abrangência na Caracterização, importa o ZIP, e — se a importação aprovar —
dispara o ProcessarGeo automaticamente. Reprovou (import OU process): o front mostra os erros
com PDF/ZIPs oficiais da SEMA para download e um botão **“Corrigir e reenviar”** que aplica
correções mecânicas calibradas (DeepSeek V4 Pro planeja/explica) e reentra no fluxo sozinho,
até 3 rodadas.

**Architecture:** módulo `backend/simcar-oraculo/` (já existe, P0/P1/P3 prontos) vira o ÚNICO
motor da aba; `runImportPhase`/`runProcessPhase` saem do fluxo do produto. Fila serial
(1 sessão SIMCAR por conta), credenciais só em env do PC servidor, job único com timeline
por etapas persistida + SSE.

---

## Decisões fechadas com o Álvaro (2026-07-16/17)

| # | Decisão |
|---|---------|
| D1 | CAR-teste = **270069** (Santa clara). Cada uso sobrescreve o estado dele — aceito. |
| D2 | Validação local: **remover de vez** da aba e do backend (as fases locais de importar/processar do processar-projeto morrem). O veredito é SEMPRE da SEMA; a validação pós-correção é o próprio reenvio. |
| D3 | IA = **DeepSeek V4 Pro** (`deepseek-v4-pro`, chave copiada do Hermes `~/.hermes/.env` → env do backend) no papel de **planejador/explicador** do autofix. As correções aplicadas são só as rotinas determinísticas calibradas. |
| D4 | Loop de correção **automático até 3 rodadas** (`AUTOFIX_MAX_ROUNDS=3`): corrigiu → reimporta → aprovou? processa → reprovou? corrige de novo. Para se não houver ação mapeada, se não melhorar, ou no teto. |
| D5 | Nome da propriedade do CAR-teste **nunca** é alterado (`PropriedadeNome` intocável); município e demais dados podem. |
| D6 | Repo é **PÚBLICO** → CPF/senha/chaves NUNCA em arquivo commitado. Valores ficam em env do PC servidor e em `.oraculo-scratch/simcar-oraculo.env` (gitignored) neste PC. |

## Fluxo do produto (ponta a ponta)

```
ZIP do usuário
  └─ upload → contexto local do shape (bbox/centroid/camadas/município via malha IBGE)   [sem SEMA]
  └─ pipeline SIMCAR (job único, fila serial):
       1. login (token cache 25 min)
       2. Buscar CAR-teste → município atual + abrangência atual (Menor/Maior*Gdec)
       3. município difere? → SalvarGrupoPropriedade (Municipio novo, PropriedadeNome intacto)
       4. abrangência não cobre bbox+margem? → SalvarAreaAbrangencia (bbox expandido)
          → poll BaseRefStatus até [CONCLUIDO]
       5. Arquivo/Upload + ImportarArquivoShape → poll ImportacaoShapeStatus
       6. sempre: baixa PDF de importação da SEMA
       7. ImportacaoResultado == [FINALIZADO]?
            SIM → ProcessarGeo → poll → PDF process + ZIP erros + processado/conferência/pendências
            NÃO → front mostra erros + downloads + botão “Corrigir e reenviar”
       8. botão Corrigir (ou rodada automática ≤3): parse PDF → FixPlan (DeepSeek explica)
          → aplica ações mecânicas → corrigido_r{N}.zip → volta ao passo 5
          (se falhou no process, volta ao 5 também — reimporta o corrigido e reprocessa)
```

## Fases

| Fase | Entrega | Status |
|------|---------|--------|
| **P0** | Cliente SIMCAR + health + Buscar | ✅ feito (rodada Hermes 16/07) |
| **P1** | Import ZIP no CAR-teste + PDF | ✅ API pronta |
| **P1.5** | **Correções de bugs** achadas na revisão de 16/07 (whitelist `simcar_oraculo_jobs`, status `completed` fixo, timeline que não acumula, etc. — lista em `02`) | ⏳ **fazer primeiro** |
| **P2** | Município (Propriedade) + abrangência (Caracterização) com os endpoints REAIS de `11-endpoints-sema-descobertos.md` | ⏳ |
| **P3** | ProcessarGeo + artefatos | ✅ API pronta (falta encadear no pipeline) |
| **P3.5** | **Pipeline único** upload→prepare→import→process + SSE/timeline + parse do PDF SEMA → `errosResumo` | ⏳ |
| **P4** | Front: remover validação local, timeline oráculo, downloads SEMA, botão Corrigir | ⏳ |
| **P5** | Autofix de import (mecânico + DeepSeek planner) + loop 3 rodadas | ⏳ |
| **P6** | Autofix de process (clip úmida etc.) no mesmo loop | ⏳ |
| **P7** | Remoção do código local morto + deploy PC servidor + validação E2E (`09`) | ⏳ |

## Fora de escopo

- Tocar em qualquer CAR que não seja o `SIMCAR_TEST_CAR_ID` (guard `assertTestCarId` permanece).
- Aba "Erros de Geometria" (vertices-proximas etc.): **continua como está** — a remoção do motor local é só do fluxo Processar Projeto.
- Auto-fix silencioso de casos que exigem julgamento cartográfico (duplicata ARL/AVN, BARRAMENTO/SITUACAO, buraco de composição da AIR): IA explica, usuário decide no GIS. v2 futura pode propor com confirmação.
- Credenciais em Vite/Firebase/git.

## Índice

| # | Arquivo | Conteúdo |
|---|---------|----------|
| 00 | este | visão, decisões, fases |
| 01 | `01-arquitetura.md` | arquitetura ORACULO-only, fluxo do job |
| 02 | `02-modulo-simcar-oraculo.md` | módulo backend + P1.5 bugs |
| 03 | `03-api-contratos-e-eventos.md` | rotas, SSE, contratos |
| 04 | `04-municipio-e-abrangencia.md` | P2 com endpoints reais |
| 05 | `05-frontend-ux.md` | UI ORACULO-only |
| 06 | `06-autofix-roadmap.md` | autofix + DeepSeek V4 Pro |
| 07 | `07-tarefas-implementacao.md` | tasks bite-sized |
| 08 | `08-seguranca-ops.md` | segredos, deploy, ops |
| 09 | `09-validacao-santa-clara.md` | validação E2E |
| 10 | `10-aprendizados-oraculo-reuso.md` | calibrações + aprendizados |
| 11 | `11-endpoints-sema-descobertos.md` | **contrato SEMA canônico** |
| 12 | `12-checklist-mestre.md` | checklist mestre de aceite |
