#!/usr/bin/env bash
# Exemplo: token público + usuário de serviço
set -euo pipefail

ORG="597953b9-ee78-4113-80f9-803dbbaa60a0"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

TOKEN=$(curl -sS -A "$UA" \
  -H "Accept: application/json" \
  -H "Origin: https://alertas.sccon.com.br" \
  -H "Referer: https://alertas.sccon.com.br/matogrosso/" \
  "https://plataforma.sccon.com.br/gama-api/auth/token-public-layer?organizationUUID=${ORG}" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

echo "TOKEN_LEN=${#TOKEN}"

curl -sS -A "$UA" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Accept: application/json" \
  "https://plataforma-alertas.sccon.com.br/gama-api/users/user" \
  | python3 -m json.tool | head -40
