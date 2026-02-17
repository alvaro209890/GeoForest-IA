# Sistemas: SIMCAR, SLAPR e SIGA

tags: `SIMCAR` `CAR` `PRA` `SLAPR` `SIGA` `monitoramento por satélite` `licenciamento digital`

## Resumo

O SIMCAR é a base integrada de dados ambientais rurais do estado. O SLAPR foi pioneiro na análise digital de licenciamentos via satélite. O SIGA gerencia cadastros de pessoas e processos administrativos. Juntos, formam a espinha dorsal digital do licenciamento florestal em MT.

## SIMCAR — Sistema Mato-grossense de Cadastro Ambiental Rural

### Base Legal
- Instituído pela **LC 592/2017**
- Regulamentado por decretos e INs da SEMA

### Funcionalidades
- Inscrição e gestão do **CAR** (Cadastro Ambiental Rural)
- Upload e validação de **shapefiles** georreferenciados dos imóveis
- Identificação automática de sobreposição com outros imóveis, UCs, TIs e áreas embargadas
- Controle do **PRA** (Programa de Regularização Ambiental)
- Emissão de **certidões de regularidade ambiental**
- Monitoramento do uso e cobertura do solo via séries temporais de satélite

### Requisitos Técnicos para Acesso
- Navegador atualizado (Chrome, Firefox)
- Cadastro prévio no SIGA (proprietário e técnico)
- Certificado digital **não é obrigatório** para inscrição do CAR, mas é necessário para assinatura de termos

### Status do CAR no SIMCAR

| Status | Significado | Pode Licenciar? |
|--------|-------------|-----------------|
| **Ativo** | Registro validado pela SEMA | ✅ Sim |
| **Pendente** | Em análise ou aguardando retificação | ⚠️ Condicionado |
| **Suspenso** | Pendências graves identificadas | ❌ Bloqueado |
| **Cancelado** | Invalidado (fraude, duplicidade, sobreposição insolúvel) | ❌ Necessário novo cadastro |

### Integração com Outros Sistemas

| Sistema | Integração |
|---------|-----------|
| **SICAR** (Nacional) | SIMCAR envia dados ao SICAR federal periodicamente |
| **SLAPR** | Consulta automática do status do CAR antes do licenciamento |
| **SIGEF** (INCRA) | Cruzamento para verificar certificação fundiária |
| **SINAFLOR** (IBAMA) | Vinculação do CAR com controle de produtos florestais |

## SLAPR — Sistema de Licenciamento Ambiental em Propriedades Rurais

### Histórico
- Desenvolvido a partir da **LC 38/1995**
- Em operação desde **2000** — pioneiro no Brasil em análise digital com monitoramento por satélite
- Precursor do modelo que seria adotado nacionalmente

### Funcionalidades
- Protocolo eletrônico de pedidos de licenciamento (ASV, PMFS, AUTEX)
- Upload de documentação técnica (mapas, inventários, memoriais)
- Análise técnica e emissão de pareceres
- Emissão de licenças e autorizações
- Monitoramento pós-licenciamento via satélite (comparação multitemporal)

### Módulos

| Módulo | Função |
|--------|--------|
| **SLAPR Digital** | Manejo florestal (PMFS, POA, AUTEX) |
| **ASV** | Autorização de supressão de vegetação |
| **Monitoramento** | Comparação entre área autorizada × imagem de satélite |

### Ciclo no SLAPR
1. Submissão de dados e documentos pelo técnico habilitado
2. Análise documental pela equipe técnica da SEMA
3. Vistoria de campo (quando exigida)
4. Parecer técnico
5. Emissão da licença/autorização
6. Monitoramento via satélite (pós-execução)
7. Relatório de conformidade ou notificação de irregularidade

## SIGA — Sistema Integrado de Gestão Ambiental

### Função
Portal de cadastro e gestão de usuários do sistema ambiental de MT.

### Cadastros Obrigatórios
- **Proprietários rurais**: CPF/CNPJ, dados pessoais, documentação do imóvel
- **Representantes legais**: Procuração registrada
- **Profissionais técnicos habilitados**: Engenheiros florestais, agrônomos (com registro no CREA/CONFEA e ART ativa)

### Pré-requisito
O cadastro no SIGA é **obrigatório** antes de acessar qualquer funcionalidade do SIMCAR ou SLAPR. Sem cadastro no SIGA, não é possível inscrever imóvel no CAR nem protocolar processos.

## Outros Sistemas Relevantes

| Sistema | Órgão | Função |
|---------|-------|--------|
| **CEHIDRO** | SEMA-MT | Outorgas de recursos hídricos |
| **SINAFLOR** | IBAMA | Controle nacional de produtos florestais |
| **SIGEF** | INCRA | Certificação de georreferenciamento de imóveis |
| **DOF** | IBAMA | Documento de Origem Florestal (transporte de madeira) |

## Comparativo Rápido

| Aspecto | SIGA | SIMCAR | SLAPR |
|---------|------|--------|-------|
| **O que cadastra** | Pessoas | Imóveis rurais (CAR) | Processos de licenciamento |
| **Quem usa** | Proprietário + Técnico | Proprietário + Técnico | Técnico habilitado |
| **Pré-requisito** | Nenhum | Cadastro no SIGA | Cadastro no SIGA + CAR ativo |
| **Saída principal** | Login habilitado | CAR Ativo | Licença / Autorização |
