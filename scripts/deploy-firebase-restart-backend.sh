#!/usr/bin/env bash
set -Eeuo pipefail

PROJECT_DIR="/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"
BACKEND_SERVICE="geoforest-backend.service"
LOG_DIR="$PROJECT_DIR/.run-logs"
LOG_FILE="$LOG_DIR/deploy-firebase-restart-backend-$(date +%Y%m%d-%H%M%S).log"
MAIN_BRANCH="main"
REMOTE_NAME="origin"

mkdir -p "$LOG_DIR"
exec > >(tee -a "$LOG_FILE") 2>&1

on_error() {
  local exit_code=$?
  echo
  echo "Falha no deploy/restart/GitHub. Codigo: $exit_code"
  echo "Log: $LOG_FILE"
  echo
  read -r -p "Pressione Enter para fechar..." _
  exit "$exit_code"
}
trap on_error ERR

echo "GeoForest IA - deploy Firebase + restart backend + GitHub"
echo "Projeto: $PROJECT_DIR"
echo "Log: $LOG_FILE"
echo

cd "$PROJECT_DIR"

require_command() {
  local command_name="$1"
  local install_hint="${2:-}"

  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "$command_name nao encontrado no PATH."
    if [ -n "$install_hint" ]; then
      echo "$install_hint"
    fi
    exit 1
  fi
}

if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null || true
fi

require_command npm
require_command firebase "Instale com: npm install -g firebase-tools"
require_command git
require_command systemctl

echo "[1/6] Garantindo branch principal '$MAIN_BRANCH'..."
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Este diretorio nao e um repositorio Git."
  exit 1
fi

CURRENT_BRANCH="$(git branch --show-current)"
if [ "$CURRENT_BRANCH" != "$MAIN_BRANCH" ]; then
  echo "Branch atual: ${CURRENT_BRANCH:-detached}. Alternando para '$MAIN_BRANCH'..."
  git switch "$MAIN_BRANCH"
fi

if git remote get-url "$REMOTE_NAME" >/dev/null 2>&1; then
  echo "Sincronizando com $REMOTE_NAME/$MAIN_BRANCH..."
  git pull --rebase --autostash "$REMOTE_NAME" "$MAIN_BRANCH"
else
  echo "Remote '$REMOTE_NAME' nao configurado."
  exit 1
fi

echo
echo "[2/6] Validando TypeScript..."
npm run check

echo
echo "[3/6] Gerando build do app publico, admin e backend..."
npm run build

echo
echo "[4/6] Publicando app publico e admin no Firebase Hosting..."
firebase deploy --only hosting

echo
echo "[5/6] Reiniciando backend local..."
systemctl --user restart "$BACKEND_SERVICE"
systemctl --user --no-pager --full status "$BACKEND_SERVICE"

echo
echo "[6/6] Commit automatico e push para $REMOTE_NAME/$MAIN_BRANCH..."
git add -A

# Nunca envie credenciais locais no commit automatico.
git reset -- .env.production backend/firebase-service-account.json >/dev/null 2>&1 || true

if git diff --cached --quiet; then
  echo "Nenhuma alteracao para commitar."
else
  COMMIT_MESSAGE="Atualizacao automatica GeoForest $(date +%Y-%m-%d\ %H:%M:%S)"
  git commit -m "$COMMIT_MESSAGE"
fi

git push "$REMOTE_NAME" "$MAIN_BRANCH"

echo
echo "Concluido com sucesso."
echo "App publico e admin publicados no Firebase Hosting."
echo "Projeto enviado para $REMOTE_NAME/$MAIN_BRANCH."
echo "Backend reiniciado."
echo "Log: $LOG_FILE"
echo
read -r -p "Pressione Enter para fechar..." _
