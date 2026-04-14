#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/media/server/HD Backup/Servidores_NAO_MEXA/GeoForest-IA"

cd "$REPO_DIR"
exec node dist/index.js
