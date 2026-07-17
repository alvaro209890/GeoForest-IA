# SIMCAR parity — calibração da aba Processar projeto

Ferramentas para comparar o motor local do GeoForest com o comportamento
observável da API do SIMCAR (`tecnico.api`).

## Aviso

- Credenciais e tokens **não** entram no git.
- Processar na SEMA grava arquivo e jobs no **requerimento real** — use só
  rascunhos de teste.
- O script de compare é **opcional** e **fora do CI**.

## Variáveis (local)

Copie `.env.example` para `.env` (gitignored se preferir) ou exporte:

```bash
export SIMCAR_LOGIN='<cpf-só-dígitos>'   # nunca commitar o CPF real (repo público)
export SIMCAR_SENHA='***'
export SIMCAR_REQUERIMENTO_ID=   # id numérico de um rascunho de teste
```

## Scripts

- `compare-simcar.mjs` — autentica, opcionalmente lista status; não processa em
  massa por padrão. Use para validar login e endpoints.

```bash
# na raiz do repo
node tools/simcar-parity/compare-simcar.mjs
```

## Fluxo manual de calibração

1. Monte um ZIP sintético ou real.
2. Rode **Processar projeto** no GeoForest → baixe o ZIP de saída.
3. No SIMCAR técnico, no mesmo ZIP (requerimento de teste): Importar + Processar.
4. Diff: tipos de erro, quantidade, polígonos de overlap/gap.
5. Ajuste limiares/regras no GeoForest e repita.

## Backend GeoForest

Após `git pull` no PC que hospeda o backend (Cloudflare Tunnel), reinicie o
serviço Node para carregar as rotas `/api/processar-projeto/*`.
