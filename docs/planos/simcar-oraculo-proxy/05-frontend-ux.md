# 05 — Frontend UX (timeline + desligar local)

## Arquivo principal

`client/src/components/ProcessarProjetoAnalysis.tsx`

Também: tab em `client/src/pages/Dashboard.tsx` (já existe `errorAnalysisTab === 'processar-projeto'`).

## Princípios de UX

1. **O usuário vê o que o servidor está fazendo no SIMCAR**, não um spinner genérico.
2. Cada passo da timeline tem ícone + texto humano + horário.
3. Artefatos SEMA (PDFs/ZIPs) são **cidadãos de primeira classe** — botões grandes de download.
4. Modo ORACULO: não forçar o usuário a “processar geometria local” se estiver desligado.
5. Futuro auto-fix: botão **“Tentar corrigir e reenviar”** (desabilitado até P5).

## Layout proposto da aba

```
┌─────────────────────────────────────────────────────────┐
│  Processar projeto (oráculo SIMCAR)                      │
│  Projeto-teste: CAR 270069 · Santa Clara · modo ORACULO │
├─────────────────────────────────────────────────────────┤
│  [ Arraste o ZIP do recorte SIMCAR ]                    │
│  preview: 12 camadas · município estimado: … · bbox …   │
├─────────────────────────────────────────────────────────┤
│  Timeline                                               │
│  ✓ ZIP recebido                                         │
│  ✓ Município do projeto-teste → Nova Mutum               │
│  ✓ Área de abrangência atualizada                       │
│  … Importando no SIMCAR…  (████░░ 60%)                  │
│  ✗ Importação reprovada                                 │
├─────────────────────────────────────────────────────────┤
│  Resultado import                                       │
│  Situação: Reprovado — pontos repetidos (AREA_UMIDA×11) │
│  [📄 PDF importação SEMA]  [⬇ shape enviado]            │
├─────────────────────────────────────────────────────────┤
│  (quando import OK)                                     │
│  [▶ Processar no SIMCAR]                                │
│  Resultado process + [PDF] [ZIP erros]                  │
├─────────────────────────────────────────────────────────┤
│  Ações futuras                                          │
│  [✨ Corrigir automaticamente e reenviar] (P5/P6)       │
└─────────────────────────────────────────────────────────┘
```

## Estados da UI

| Estado | UI |
|--------|-----|
| idle | dropzone |
| uploaded | preview + botão Importar no SIMCAR |
| queued | “Na fila…” |
| running | timeline viva (SSE) |
| import_fail | vermelho + PDF + lista erros |
| import_ok | verde + botão Processar |
| process_fail | lista erros process + downloads |
| process_ok | celebrar + downloads |
| error_infra | “SIMCAR indisponível / credencial / timeout” |

## Desligar validação local

Env no backend `PROCESSAR_MODE=ORACULO` → response de upload inclui `mode`.

Front:

```tsx
const isOraculo = mode === "ORACULO";
// Esconder ou colapsar seções "relatório local GeoForest"
// Renomear botões:
//   "Importar" → "Importar no SIMCAR (projeto-teste)"
//   "Processar" → "ProcessarGeo no SIMCAR"
```

Flag opcional de UI (admin):

```tsx
// Só se mode HYBRID
showLocalComparison={mode === "HYBRID"}
```

## SSE — consumo (já existe padrão)

Manter `EventSource` / fetch stream em `ProcessarProjetoAnalysis.tsx` (~linha 409).

Mapear `event.step` → item da timeline (append-only; não apagar passos).

## Downloads

Usar `downloadUrl` assinado/token como hoje (`/api/processar-projeto/download/...`).

Labels:

- “Relatório de importação (SEMA)”
- “Relatório de processamento (SEMA)”
- “Arquivo de erros de processamento”
- “ZIP enviado ao projeto-teste”

## Copy (textos)

- Explicar que o shape vai para o **projeto de teste do escritório**, não para o CAR do cliente.
- Aviso amarelo: “O projeto-teste é compartilhado; jobs entram em fila.”

## Acessibilidade / mobile

- Timeline vertical legível no WhatsApp-like mobile
- Botões de download full-width no mobile

## Testes front (mínimo)

- Story/teste de render da timeline com mock de eventos (se houver infra de teste de componente)
- Caso sem: checklist manual em `09-validacao-santa-clara.md`
