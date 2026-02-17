# Termos de Referência, Instruções Normativas e Pontos de Indeferimento

tags: `IN 1/2007` `Portaria 99/2007` `termos de referência` `indeferimento` `documentação` `ART`

## Resumo

A IN SEMA 1/2007 disciplina procedimentos de licenciamento rural. A Portaria 99/2007 lista documentos obrigatórios por tipo de projeto. O não atendimento a essas normas é a principal causa de indeferimento de processos na SEMA-MT.

## IN SEMA-MT nº 1/2007

### Escopo
Disciplina os procedimentos técnicos e administrativos de licenciamento ambiental para propriedades rurais em Mato Grosso.

### Conteúdo Principal
- Informações mínimas nos requerimentos de licenciamento
- Formato padrão de mapas (SIRGAS 2000, shapefile, escala adequada)
- Formato de relatórios técnicos e memoriais descritivos
- Critérios para vistorias de campo e condicionantes
- Prazos para manifestações técnicas e complementações
- Condições para renovação de licenças vencidas

### Termos de Referência Definidos
A IN estabelece TdRs (Termos de Referência) para:
- Manejo Florestal Sustentável (PMFS)
- Supressão de Vegetação (ASV)
- Regularização de Reserva Legal
- Plano de Recuperação de Áreas Degradadas (PRAD)

## Portaria SEMA-MT nº 99/2007

### Documentação Exigida por Tipo de Projeto

| Tipo de Projeto | Documentos Básicos | Documentos Técnicos |
|-----------------|-------------------|---------------------|
| **Licenciamento Ambiental Único (LAU)** | CPF/CNPJ, matrícula do imóvel, CAR | RCA/PCA simplificado, mapa de uso do solo |
| **Plano de Exploração Florestal** | CPF/CNPJ, matrícula, CAR, ART | Inventário, mapa de exploração, memorial |
| **PMFS** | CPF/CNPJ, matrícula, CAR, ART | Inventário (censo), mapa UMF/UPA, plano EIR |
| **ASV (Supressão)** | CPF/CNPJ, matrícula, CAR, ART | Inventário, mapa da área, memorial descritivo |
| **Averbação/Registro de RL** | CPF/CNPJ, matrícula, CAR | Mapa georreferenciado da RL proposta |
| **PRAD** | CPF/CNPJ, matrícula, CAR, ART | Diagnóstico, projeto de recuperação, cronograma |

### Documentos Comuns a Todos os Processos
- Requerimento assinado pelo proprietário/possuidor
- CPF ou CNPJ do requerente
- Documento de titularidade (matrícula, escritura, CCU)
- Comprovante de inscrição no CAR (SIMCAR)
- Procuração (se representante legal)
- ART (Anotação de Responsabilidade Técnica) do profissional habilitado

## Outras Normas Relevantes

| Norma | Assunto |
|-------|---------|
| **Portaria Conjunta SEMA/INCRA/INTERMAT nº 1/2008** | CAR em assentamentos rurais |
| **IN SEMA nº 8/2019** | Procedimentos para PMFS simplificado |
| **DN CONSEMA** (diversas) | Classificação de porte e potencial poluidor por atividade |
| **Decreto Estadual 1.031/2017** | Regulamenta a LC 592/2017 (SIMCAR/PRA) |

> As normativas são atualizadas periodicamente. Sempre consultar o portal da SEMA-MT para verificar a vigência antes de protocolar processos.

## Causas Recorrentes de Indeferimento

### Documentação
| Causa | Frequência | Solução |
|-------|-----------|---------|
| CAR incompleto, suspenso ou cancelado | Muito alta | Retificar CAR antes de protocolar |
| Falta de ART ou ART vencida | Alta | Emitir ART válida no CREA |
| Falta de comprovante de posse/propriedade | Alta | Providenciar matrícula atualizada |
| Procuração sem firma reconhecida | Média | Reconhecer firma em cartório |

### Cartografia / SIG
| Causa | Frequência | Solução |
|-------|-----------|---------|
| Shapefile em DATUM errado (SAD 69, Córrego Alegre) | Alta | Converter para SIRGAS 2000 (EPSG:4674) |
| Erros topológicos (sobreposição, gaps, autointerseção) | Alta | Usar ferramentas de validação (Sketcher, QGIS) |
| Área declarada diverge da área do shapefile | Média | Recalcular área em projeção UTM |
| Memorial descritivo incompatível com shapefile | Média | Regenerar memorial a partir do shapefile corrigido |

### Técnicas
| Causa | Frequência | Solução |
|-------|-----------|---------|
| RL abaixo do percentual mínimo sem PRA | Alta | Aderir ao PRA ou recompor RL |
| Área de supressão sobrepõe APP | Alta | Redesenhar polígono excluindo APP |
| Inventário florestal inconsistente com fitofisionomia | Média | Amostrar corretamente, identificar espécies |
| Ausência de outorga de água quando há captação | Média | Solicitar outorga ao CEHIDRO/SEMA |
| Sobreposição com UC, TI ou área embargada | Média | Verificar bases oficiais antes de protocolar |
