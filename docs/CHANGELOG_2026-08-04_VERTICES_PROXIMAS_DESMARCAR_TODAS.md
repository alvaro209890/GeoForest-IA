# Vértices Próximas — botão "Desmarcar todas" (2026-08-04)

## Pedido

Na aba **Erros → Vértices Próximas**, quando o ZIP importado traz várias
camadas (shapefiles diferentes), todas entram marcadas por padrão
(`analyze: !ignored` no upload). Com um ZIP de muitas camadas, desmarcar uma
por uma pra analisar só algumas era manual demais — pedido do Álvaro: um
botão pra desmarcar todas de uma vez.

## O que mudou

`client/src/pages/Dashboard.tsx`:

- Novo callback `deselectAllVerticesLayers` — zera `analyze` de todas as
  camadas do estado `verticesLayers` (não mexe nas demais propriedades:
  pontos, tolerância, CRS override continuam como estavam).
- Botão **"Desmarcar todas"** na seção "2. Conferência das camadas" (aba
  Vértices Próximas), ao lado dos indicadores Camadas/Analisáveis/
  Selecionadas. Só aparece com mais de uma camada no ZIP (`verticesLayers.length > 1`)
  e fica desabilitado quando não há nada marcado.

Escopo do pedido era só a aba Vértices Próximas — as abas irmãs (Áreas Não
Contidas, Erros de Geometria) não têm o mesmo botão; ficam pra um pedido
futuro se fizer sentido lá também.

## Testes

Sem teste unitário novo: `Dashboard.tsx` é o componente monolítico de 12k+
linhas do projeto (documentado como "evitar refactor amplo" nos gotchas do
Segundo Cérebro) e não tem suíte própria — nem os outros toggles de camada
da mesma tabela (`updateVerticesLayer`) têm. A mudança em si é um setter de
estado puro de 2 linhas.

- `tsc --noEmit` (client + backend): limpo.
- `vite build` + `esbuild backend/index.ts`: build de produção ok.

```bash
pnpm exec tsc --noEmit -p tsconfig.json
pnpm run build
```
