#!/usr/bin/env bash
# CBERS/WMS preflight ("doctor") — verifica, no PC servidor do WMS, que tudo de que o
# pipeline CBERS precisa esta no lugar: ferramentas GDAL, GeoServer no ar, acervo gravavel.
# Rode depois de "git pull" no servidor para confirmar que a geracao + publicacao WMS vai
# funcionar. Uso:
#   scripts/cbers-doctor.sh [caminho/para/backend.env]
# Se um env file for passado (ou existir ~/.config/geoforest/backend.env), ele e carregado
# para refletir exatamente a configuracao do backend.
set -uo pipefail

# Carrega KEY=VALUE como o systemd EnvironmentFile (NAO como shell), para tolerar valores
# com espacos sem aspas, ex.: caminhos em "/media/server/HD Backup/...".
load_env_file() {
  local file="$1" line key val
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|'#'*) continue ;; esac
    printf '%s' "$line" | grep -qE '^[A-Za-z_][A-Za-z0-9_]*=' || continue
    key="${line%%=*}"
    val="${line#*=}"
    case "$val" in
      \"*\") val="${val#\"}"; val="${val%\"}" ;;
      \'*\') val="${val#\'}"; val="${val%\'}" ;;
    esac
    export "$key=$val"
  done < "$file"
}

ENV_FILE="${1:-$HOME/.config/geoforest/backend.env}"
if [ -f "$ENV_FILE" ]; then
  load_env_file "$ENV_FILE"
  echo "env carregado: $ENV_FILE"
else
  echo "env file nao encontrado ($ENV_FILE); usando defaults do codigo."
fi

# Defaults espelham backend/cbers-archive.ts e backend/cbers-wpm.ts.
CBERS_ARCHIVE_ROOT="${CBERS_ARCHIVE_ROOT:-/media/server/HD Backup/RASTER/CBERS_4A}"
GEOSERVER_BASE_URL="${GEOSERVER_BASE_URL:-http://127.0.0.1:8081/geoserver}"
GEOSERVER_USER="${GEOSERVER_USER:-admin}"
GEOSERVER_PASSWORD="${GEOSERVER_PASSWORD:-geoserver}"
GEOSERVER_WORKSPACE="${GEOSERVER_WORKSPACE:-cbers}"
GEOSERVER_DATA_DIR="${GEOSERVER_DATA_DIR:-/home/server/geoserver_data}"
GEOSERVER_EXTERNAL_CBRS_ROOT="${GEOSERVER_EXTERNAL_CBRS_ROOT:-/home/server/.local/geoserver-work/data_dir/external/cbers}"
GEOSERVER_PUBLIC_WMS_BASE="${GEOSERVER_PUBLIC_WMS_BASE:-https://wms.cursar.space/geoserver/cbers/wms}"

FAIL=0
WARN=0
ok()   { printf "  \033[32mOK\033[0m   %s\n" "$1"; }
bad()  { printf "  \033[31mFAIL\033[0m %s\n" "$1"; FAIL=$((FAIL+1)); }
warn() { printf "  \033[33mWARN\033[0m %s\n" "$1"; WARN=$((WARN+1)); }

echo
echo "== Ferramentas GDAL / runtime =="
# gdal_pansharpen.py e gdal_edit.py sao os nomes EXATOS chamados pelo backend.
for tool in gdalinfo gdal_translate gdalwarp gdaladdo gdalbuildvrt gdal_pansharpen.py gdal_edit.py python3 node; do
  if command -v "$tool" >/dev/null 2>&1; then
    ok "$tool -> $(command -v "$tool")"
  else
    bad "$tool ausente no PATH (necessario para o pipeline CBERS)"
  fi
done
if command -v gdalinfo >/dev/null 2>&1; then
  ok "$(gdalinfo --version)"
fi
if command -v node >/dev/null 2>&1; then
  ok "node $(node -v)"
fi

echo
echo "== Acervo permanente (HD 2 TB) =="
if [ -d "$CBERS_ARCHIVE_ROOT" ]; then
  ok "acervo existe: $CBERS_ARCHIVE_ROOT"
  TESTFILE="$CBERS_ARCHIVE_ROOT/.cbers_doctor_write_test.$$"
  if (umask 022; : > "$TESTFILE") 2>/dev/null; then
    ok "acervo gravavel"
    rm -f "$TESTFILE" 2>/dev/null || true
  else
    bad "acervo NAO gravavel: $CBERS_ARCHIVE_ROOT (HD desmontado? permissoes?)"
  fi
  AVAIL=$(df -h "$CBERS_ARCHIVE_ROOT" 2>/dev/null | awk 'NR==2{print $4" livres de "$2" ("$5" usado)"}')
  [ -n "$AVAIL" ] && ok "espaco em disco: $AVAIL"
else
  bad "acervo inexistente: $CBERS_ARCHIVE_ROOT (o HD de 2 TB esta montado em /media/server?)"
fi

echo
echo "== GeoServer REST ($GEOSERVER_BASE_URL) =="
VERSION_JSON=$(curl -fsS -u "$GEOSERVER_USER:$GEOSERVER_PASSWORD" \
  "$GEOSERVER_BASE_URL/rest/about/version.json" 2>/dev/null)
if [ -n "$VERSION_JSON" ]; then
  GS_VER=$(printf '%s' "$VERSION_JSON" | python3 -c 'import sys,json;d=json.load(sys.stdin);r=d.get("about",{}).get("resource",[]);print(next((x.get("Version") for x in (r if isinstance(r,list) else [r]) if x.get("@name","").lower().startswith("geoserver")),"?"))' 2>/dev/null)
  ok "GeoServer respondendo (versao ${GS_VER:-?})"
  WS_STATUS=$(curl -fsS -o /dev/null -w '%{http_code}' -u "$GEOSERVER_USER:$GEOSERVER_PASSWORD" \
    "$GEOSERVER_BASE_URL/rest/workspaces/$GEOSERVER_WORKSPACE.json" 2>/dev/null)
  if [ "$WS_STATUS" = "200" ]; then
    ok "workspace '$GEOSERVER_WORKSPACE' existe"
  else
    bad "workspace '$GEOSERVER_WORKSPACE' nao encontrado (HTTP $WS_STATUS) — crie-o no GeoServer"
  fi
else
  CODE=$(curl -s -o /dev/null -w '%{http_code}' -u "$GEOSERVER_USER:$GEOSERVER_PASSWORD" "$GEOSERVER_BASE_URL/rest/about/version.json" 2>/dev/null)
  if [ "$CODE" = "401" ] || [ "$CODE" = "403" ]; then
    warn "GeoServer no ar mas credenciais recusadas (HTTP $CODE) — confira GEOSERVER_USER/PASSWORD"
  else
    bad "GeoServer inacessivel em $GEOSERVER_BASE_URL (servico geoserver-wms.service rodando?)"
  fi
fi

echo
echo "== Diretorios GeoServer =="
if [ -d "$GEOSERVER_DATA_DIR/workspaces/$GEOSERVER_WORKSPACE" ]; then
  N=$(find "$GEOSERVER_DATA_DIR/workspaces/$GEOSERVER_WORKSPACE" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | wc -l)
  ok "data dir do workspace presente ($N stores): $GEOSERVER_DATA_DIR/workspaces/$GEOSERVER_WORKSPACE"
else
  warn "data dir do workspace ausente: $GEOSERVER_DATA_DIR/workspaces/$GEOSERVER_WORKSPACE"
fi
if mkdir -p "$GEOSERVER_EXTERNAL_CBRS_ROOT" 2>/dev/null && [ -w "$GEOSERVER_EXTERNAL_CBRS_ROOT" ]; then
  ok "raiz de symlinks externos gravavel: $GEOSERVER_EXTERNAL_CBRS_ROOT"
else
  bad "raiz de symlinks externos NAO gravavel: $GEOSERVER_EXTERNAL_CBRS_ROOT"
fi

echo
echo "== WMS publico (opcional) =="
PUB_CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
  "${GEOSERVER_PUBLIC_WMS_BASE}?service=WMS&version=1.3.0&request=GetCapabilities" 2>/dev/null)
if [ "$PUB_CODE" = "200" ]; then
  ok "GetCapabilities publico responde 200: $GEOSERVER_PUBLIC_WMS_BASE"
else
  warn "WMS publico respondeu HTTP $PUB_CODE (tunnel cloudflare? rede?) — nao bloqueia geracao local"
fi

echo
echo "== Resumo =="
if [ "$FAIL" -eq 0 ]; then
  printf "  \033[32mTudo pronto para gerar e publicar CBERS.\033[0m"
  [ "$WARN" -gt 0 ] && printf " (%d aviso(s))" "$WARN"
  echo
  exit 0
else
  printf "  \033[31m%d verificacao(oes) critica(s) falharam\033[0m (%d aviso(s)). Corrija antes de gerar imagens.\n" "$FAIL" "$WARN"
  exit 1
fi
