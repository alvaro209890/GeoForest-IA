# CHANGELOG — Croqui de Acesso: Seleção do Município de Partida

**Data:** 2026-09-29  
**Autor:** Hermes GeoForest (`Hermes-acer/geoforest`)  
**Contexto:** Pedido do Álvaro no canal `🌲｜geoforest-acer`.

---

## 1. O Problema

No módulo de Croqui de Acesso (`/dashboard/croqui`), o ponto de partida do croqui era determinado exclusivamente pelo município onde o centróide do shapefile ATP caía (ex.: Canarana, Querência, etc.).

No entanto, no meio rural de Mato Grosso, propriedades frequentemente têm seu acesso principal partindo de um município vizinho dotado de melhor infraestrutura viária (asfalto, pontes, rodovias estaduais MT) ou de onde residem o produtor e a equipe técnica, mesmo que o imóvel pertença cartograficamente a outro município. O usuário não tinha opção de escolher outra cidade de MT para iniciar a rota e o roteiro pericial.

---

## 2. A Solução

Implementada a capacidade de seleção do **Município de Partida** na aba de Croqui, tanto na interface visual quanto na API e na geração de artefatos (PDF, DOCX, KML):

1. **Seletor de Município de Partida no Frontend (`RoutePicker.tsx` / `CroquiPanel.tsx`)**:
   - Card dedicado com tema escuro elegante, ícone `Building2` e `<select>` estilizado com todas as **142 sedes municipais de Mato Grosso** (ordenadas de A a Z).
   - Pré-seleciona automaticamente o município detectado pelo imóvel.
   - Ao trocar de município, recalcula instantaneamente os caminhos de acesso partindo da nova sede (`changeCroquiMunicipioPartida`).
   - Título dinâmico: *"Caminhos avaliados a partir de {município}"*.
   - Se o usuário refinar o ponto arrastando o pino no mapa satélite Leaflet, exibe o indicador com opção de *"Restaurar sede"* com 1 clique.
   - Exibe no painel geral: `Município do imóvel: {X}` e `• Partida do croqui: {Y}`.

2. **Base e Resolução de Sedes no Backend (`backend/croqui/landmarks.ts`)**:
   - `carregarSedesPorNome()`: indexação por nome normalizado (`normalizarNomeMunicipio`), permitindo busca por nome com ou sem acentos (ex.: `Querência`, `Canarana`, `Água Boa`).
   - `findSedeMunicipal(termoOuIbge)`: busca inteligente por código IBGE ou nome do município.
   - `listarMunicipiosMt()`: retorna a lista completa das sedes municipais de MT com coordenadas ajustadas à via.
   - `resolveLandmark(municipioNome, ibge)`: atualizado para resolver a sede por nome mesmo se o IBGE não for fornecido.
   - Correção do código IBGE de Querência (`5107065`), desvinculando-o do código IBGE de Sinop (`5107909`).

3. **Integração nas Rotas e Geração (`backend/croqui.ts`)**:
   - Endpoint `GET /api/croqui/municipios`: retorna os 142 municípios de MT ordenados.
   - `POST /api/croqui/route-options`: aceita `municipioPartida` no payload. Se informado, calcula a rota partindo da sede/landmark daquele município.
   - `POST /api/croqui/process`: persiste e utiliza `municipioPartida` na geração dos artefatos.
   - `generateCroquiArtifacts` & `buildCroquiNarrative`: a abertura do roteiro pericial sai com a cidade selecionada:
     `O presente croqui se inicia na cidade {município} no ponto {DMS} seguindo pela {via} no sentido {sentido}.`

4. **Lista no Frontend (`client/src/dashboard/croqui/municipiosMt.ts`)**:
   - Exportação de `MUNICIPIOS_MT` contendo as 142 sedes com coordenadas e IBGE, garantindo resposta instantânea da interface sem depender de roundtrips de rede.

---

## 3. Arquivos Modificados / Criados

- `backend/croqui/landmarks.ts`: indexação por nome, `findSedeMunicipal`, `listarMunicipiosMt`, ajuste do IBGE de Querência.
- `backend/croqui/landmarks.test.ts`: testes de listagem, busca e resolução de sedes municipais.
- `backend/croqui.ts`: suporte a `municipioPartida` em `resolveCroquiContext`, `buildCroquiRouteOptions`, `generateCroquiArtifacts`, `runCroquiJob`, endpoints `/api/croqui/municipios`, `/api/croqui/route-options` e `/api/croqui/process`.
- `client/src/dashboard/croqui/types.ts`: adição de `MunicipioOption` e campo `municipioPartida` em `CroquiRouteOptionsResponse` e `CroquiHistoryItem`.
- `client/src/dashboard/croqui/municipiosMt.ts`: lista de municípios de MT com busca tipada.
- `client/src/dashboard/hooks/useCroquiJobs.ts`: estado `croquiMunicipioPartida`, função `changeCroquiMunicipioPartida` e repasse nos endpoints.
- `client/src/dashboard/croqui/RoutePicker.tsx`: seletor de município estilizado, recálculo reativo e botão de restaurar sede.
- `client/src/dashboard/panels/CroquiPanel.tsx`: passagem de props e exibição diferenciada entre município do imóvel e município de partida.
- `docs/CROQUI_ACESSO.md`: documentação atualizada da funcionalidade.

---

## 4. Testes e Validação

- `backend/croqui/landmarks.test.ts`: 3/3 testes verdes (142 municípios, busca com/sem acento, resolução de landmarks).
- Suíte `backend/croqui/*.test.ts`: 72/72 testes verdes em 9 arquivos (routing, coords, basemap, render-pdf, render-kml, narrative, sede, route-options, landmarks).
- `npx tsc --noEmit`: 0 erros de tipagem TypeScript.
- `npx vite build`: build de produção concluído com sucesso (`dist/public/`).
- `npx esbuild backend/index.ts`: bundle do backend concluído sem erros (`dist/index.js`).
