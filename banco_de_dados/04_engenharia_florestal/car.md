# CAR — Cadastro Ambiental Rural

tags: `CAR` `SIMCAR` `georreferenciamento` `imóvel rural` `regularização` `SICAR`

## Definição

Registro eletrônico obrigatório de todos os imóveis rurais, integrando dados georreferenciados sobre APP, Reserva Legal, remanescentes de vegetação nativa e áreas de uso restrito. Em MT é operacionalizado pelo SIMCAR.

## Base Legal

- **Federal**: Art. 29 da Lei 12.651/2012 — obrigatoriedade do CAR
- **Estadual**: LC 592/2017 — institui o SIMCAR e disciplina o CAR em MT
- **Regulamentação**: Decreto Federal 7.830/2012 — dispõe sobre o SICAR nacional
- **IN MMA nº 2/2014** — procedimentos para integração e execução do CAR

## Obrigatoriedade

- Todo imóvel rural deve ser inscrito no CAR
- Condição para: autorização de supressão, acesso ao PRA, obtenção de crédito rural, emissão de CRA
- Prazo original: 31/12/2017 (prorrogado diversas vezes)
- Em MT: inscrição via SIMCAR, com dados integrados ao SICAR nacional

## Dados Exigidos na Inscrição

### Dados do proprietário/posseiro
- CPF ou CNPJ, nome completo, endereço
- Documento de titularidade (matrícula, escritura, contrato de posse, CCU em assentamentos)

### Dados do imóvel
- Planta georreferenciada (DATUM SIRGAS 2000, formato shapefile)
- Perímetro do imóvel com coordenadas dos vértices
- Delimitação obrigatória de:
  - Área total do imóvel
  - Áreas de APP
  - Reserva Legal (proposta ou existente)
  - Remanescentes de vegetação nativa
  - Áreas consolidadas (uso anterior a 22/07/2008)
  - Áreas de uso restrito (pantanais, veredas)
  - Hidrografia interna

### Requisitos técnicos do shapefile
- Projeção: SIRGAS 2000 (EPSG:4674)
- Formato: shapefile (.shp, .shx, .dbf, .prj)
- Sem autointerseção, gaps ou sobreposições entre polígonos internos
- Precisão posicional compatível com a escala (receptores GNSS ou imagens de alta resolução)

## Status do CAR em MT

| Status | Significado | Consequência |
|--------|-------------|--------------|
| **Ativo** | Validado pela SEMA | Pode licenciar, acessar crédito |
| **Pendente** | Em análise | Licenciamento condicionado |
| **Suspenso** | Pendências identificadas | Licenciamento bloqueado até regularização |
| **Cancelado** | Invalidado (sobreposição, fraude, duplicidade) | Necessário novo cadastro |

## Procedimento Completo em MT

1. **Cadastro no SIGA** — Registro de dados do proprietário e do técnico responsável
2. **Inscrição no SIMCAR** — Upload do shapefile georreferenciado com todas as camadas obrigatórias
3. **Análise automatizada** — O sistema verifica sobreposições com outros imóveis, UCs, TIs e áreas embargadas
4. **Análise técnica** — Verificação de consistência entre shapefile, documentação e imagens de satélite
5. **Notificação de pendências** — Se houver inconsistências, proprietário é notificado para retificação
6. **Retificação** — Correção de shapefile ou documentação (prazo definido em notificação)
7. **Validação** — CAR passa a status "Ativo"
8. **Identificação de passivos** — Se houver déficit de RL ou APP, encaminha para adesão ao PRA

## Especificidades em MT

### Assentamentos rurais
- Portaria Conjunta SEMA/INCRA/INTERMAT nº 1/2008
- CAR pode ser feito individualmente (por lote) ou coletivamente (perímetro do assentamento)
- INCRA fornece perímetro georreferenciado do assentamento
- Cada assentado faz CAR individual vinculado ao perímetro

### Imóveis em área de transição Amazônia-Cerrado
- O enquadramento do bioma determina o percentual de RL exigido
- SEMA utiliza mapa oficial de biomas (IBGE) para definição
- Imóveis que abrangem dois biomas: cada porção segue a regra do respectivo bioma

### Integração com outros sistemas
- **SICAR** — Sistema nacional, recebe dados do SIMCAR
- **SLAPR** — Licenciamento florestal consulta dados do CAR automaticamente
- **INCRA/SIGEF** — Cruzamento com certificação de imóveis rurais
- **IBAMA/SINAFLOR** — Controle de produtos florestais vinculado ao CAR

## Problemas Comuns na Inscrição

- Shapefile em DATUM errado (SAD69, Córrego Alegre em vez de SIRGAS 2000)
- Sobreposição com imóveis vizinhos já cadastrados
- Área declarada diverge da área do shapefile
- Hidrografia não compatível com base oficial (ANA)
- RL proposta sobre APP (não pode ser contabilizada em duplicidade, salvo exceções legais)
- Falta de documento comprobatório de posse ou propriedade
