#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
BACKEND_SERVICE="geoforest-backend.service"
LOG_DIR="$PROJECT_DIR/.run-logs"
LOG_FILE="$LOG_DIR/deploy-firebase-restart-backend-$(date +%Y%m%d-%H%M%S).log"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code=$?
  echo
  echo "Falha no deploy/restart. Codigo: $exit_code"
  echo "Log: $LOG_FILE"
  echo
  read -r -p "Pressione Enter para fechar..." _
  exit "$exit_code"
}
trap on_error ERR

echo "GeoForest IA - deploy Firebase + restart backend"
echo "Projeto: $PROJECT_DIR"
echo "Log: $LOG_FILE"
echo

cd "$PROJECT_DIR"

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || true
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm nao encontrado no PATH."
  exit 1
fi

if ! command -v firebase >/dev/null 2>&1; then
  echo "Firebase CLI nao encontrado. Instale com: npm install -g firebase-tools"
  exit 1
fi

echo "[1/4] Validando TypeScript..."
npm run check

echo
echo "[2/4] Gerando build do frontend e backend..."
npm run build

echo
echo "[3/4] Publicando frontend no Firebase Hosting..."
firebase deploy --only hosting

echo
echo "[4/4] Reiniciando backend local..."
systemctl --user restart "$BACKEND_SERVICE"
systemctl --user --no-pager --full status "$BACKEND_SERVICE"

echo
echo "Concluido com sucesso."
echo "Frontend publicado no Firebase Hosting e backend reiniciado."
echo "Log: $LOG_FILE"
echo
read -r -p "Pressione Enter para fechar..." _
