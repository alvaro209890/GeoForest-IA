# 10 — Aprendizados do oráculo (calibrações + descobertas de 16/07)

Fontes: sessões 16–17/07/2026, `docs/CHANGELOG_2026-07-16_ORACULO_SEMA_SANTA_CLARA.md`,
`backend/geometry-errors.ts`, bundle `tecnico.app` + sondas live (ver `11`).

## Regras REAIS do importador SEMA (calibradas por bissecção)

| Mensagem SEMA | Regra real | Fix mecânico |
|---------------|-----------|--------------|
| Borda do polígono se cruza | anel COLAPSADO: área ≤0,01 m² OU largura ≤0,02 m; **encoste pontual passa** | limpar anéis degenerados / unkink |
| A geometria contém pontos repetidos | vértices consecutivos ≤ **0,1 m** | strip dups |
| Duas ou mais bordas ou buracos… se sobrepõem | buraco com borda compartilhada ≥ **1 m** com o anel exterior | remover buraco colado |
| Polígono complexo | multipart no registro | split em registros simples |
| (process) contida por AVN∪AUAS∪CONSOLIDADA | contenção cartográfica da AREA_UMIDA | clip ao cover + limpeza |

Calibração v23: SEMA conta **11 = feições** (não vértices) — agregar por feição nos resumos.
Diagnóstico dos 41: úmida sobre hidrografia (buraco no AVN) — **clipar AVN por hidro PIORA**.

## Constantes já no código (não re-sintonizar no escuro)

```
SIMCAR_RING_SHARED_EDGE_M = 1.0
SIMCAR_RING_SHARED_EDGE_TOL_M = 0.02
SIMCAR_UMIDA_FORA_TOL_M2 = 0.3
SIMCAR_UMIDA_EDGE_SAMPLE_M = 20
dup vertices import = 0.1 m
colapso: área ≤ 0.01 m² / largura ≤ 0.02 m
fragmento mínimo pós-clip ≈ 100 m²
```

## Descobertas novas (sessão 16/07 noite — bundle + live)

1. **Abrangência mora no `Buscar`**: `Menor/Maior{Latitude,Longitude}Gdec` no próprio
   requerimento; salvar = `SalvarAreaAbrangencia {Id, 4 coords}` (retângulo).
2. **`LimparAreaAbrangencia` é DESTRUTIVO** — modal oficial: "Todas as geometrias do seu
   projeto serão descartadas". Usar só no CAR-teste, registrando na timeline.
3. **Abrangência dispara BaseRef** — o app oficial trava a tela até `BaseRefStatus`
   concluir; nosso pipeline precisa pollear antes de importar.
4. **`Municipio.Id` (Chave) ≠ código IBGE** (`Municipio.Codigo`). `ListarMatoGrosso`/
   `ListarMunicipios/11` → `{Chave, Texto}` (142); `BuscarMunicipioGeo/{IBGE}` → polígono
   oficial do município (ótimo p/ confirmar divisas antes de mudar).
5. **Formulários salvam o objeto inteiro**: `SalvarGrupoPropriedade`/`SalvarGrupoCaracterizacao`
   recebem o estado do requerimento (padrão `POST /Requerimento/{acao}` do dispatcher por aba).
   Estratégia segura: Buscar → mutar 1 campo → POST de volta.
6. **`ListarRasc` (aba Listar)** exige filtro do componente genérico (`{Filtros:{…},paginação}`);
   corpos genéricos dão 400. Desnecessário: endereçamos o CAR-teste por ID.
7. **Sessão única**: login do robô derruba a sessão do navegador do técnico (confirmado no
   gotcha do acompanhamento). Fila + cache 25 min + copy no front.
8. Enums de status: `[AGUARDANDO] [EXECUTANDO] [ERRO] [CONCLUIDO]` / resultados
   `[FINALIZADO] [COM_PENDENCIA] [EM_ABERTO]`.

## Regras de engenharia do autofix (provadas nos v8→v24)

- NUNCA `turf.buffer` (arcos reprovam borda-se-cruza). Difference/intersect iterativos.
- Filtrar fragmentos <100 m² pós-clip; IDs novos p/ partes de MultiPolygon (nunca duplicar dbf).
- Encoste pontual é válido — não "corrigir".
- Preservar bytes das camadas não tocadas (copiar .shp/.dbf/.prj/.cpg originais); regravar só
  a camada alterada; `shapefile-writer` não escreve .prj; dbf latin1 trunca strings.
- Fixes encadeiam (v22→v23→v24): cada rodada parte do ZIP anterior.
- Correções que exigem decisão (duplicata ARL/AVN, BARRAMENTO/SITUACAO, buraco de composição
  AIR, fundir×recortar úmida) → nunca automáticas; IA explica, usuário decide no GIS.

## DeepSeek V4 Pro (padrão do acompanhamento — replicar)

- id `deepseek-v4-pro`, base `api.deepseek.com/v1`; `max_tokens` inclui raciocínio (folga +
  retry se content vazio); `temperature` ignorado; sem visão (mandar TEXTO extraído do PDF).
- Chave: `~/.hermes/.env` → env do backend. A do Atlas está inválida (401).

## O que o modo ORACULO substitui (D2)

| Antes (LOCAL) | Agora |
|---------------|-------|
| `runImportPhase` como veredito | PDF/resultado REAIS do importador SEMA |
| `runProcessPhase` como veredito | ProcessarGeo real |
| Detector local na aba | permanece SÓ na aba Erros de Geometria; primitivas viram motor do autofix |
| PDF "estilo SEMA" do GeoForest | PDF oficial da SEMA |
