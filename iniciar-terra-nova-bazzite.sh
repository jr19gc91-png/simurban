#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Terra Nova / SIMURB NewCore"
APP_VERSION="v2.4.20 - TMPE Connectors Phases Priority 5m/u"
HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8123}"
MAX_PORT_TRIES="${MAX_PORT_TRIES:-30}"
PYTHON_BIN="${PYTHON_BIN:-}"
CACHE_BUST="v2419-$(date +%s)"
LOG_FILE="${TMPDIR:-/tmp}/terranova-newcore-server-${PORT}.log"

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

fail() {
  echo "[ERRO] $*" >&2
  echo
  echo "Pressione ENTER para sair..."
  read -r _ || true
  exit 1
}

find_python() {
  if [[ -n "${PYTHON_BIN}" ]]; then
    command -v "${PYTHON_BIN}" >/dev/null 2>&1 || fail "PYTHON_BIN='${PYTHON_BIN}' não encontrado."
    "${PYTHON_BIN}" - <<'PY' >/dev/null 2>&1 || fail "PYTHON_BIN não consegue importar http.server."
import http.server
PY
    echo "${PYTHON_BIN}"
    return 0
  fi
  for candidate in python3 python; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      if "${candidate}" - <<'PY' >/dev/null 2>&1; then
import http.server
PY
        echo "${candidate}"
        return 0
      fi
    fi
  done
  fail "Python não encontrado. Instale python3 ou rode com PYTHON_BIN=/caminho/python3 ./iniciar-terra-nova-bazzite.sh"
}

port_in_use() {
  local p="$1"
  if command -v ss >/dev/null 2>&1; then
    ss -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)${p}$"
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"${p}" -sTCP:LISTEN >/dev/null 2>&1
  elif command -v nc >/dev/null 2>&1; then
    nc -z "${HOST}" "${p}" >/dev/null 2>&1
  else
    return 1
  fi
}

open_browser() {
  local url="$1"
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "${url}" >/dev/null 2>&1 && return 0; fi
  if command -v gio >/dev/null 2>&1; then gio open "${url}" >/dev/null 2>&1 && return 0; fi
  for browser in google-chrome-stable google-chrome chromium chromium-browser firefox; do
    if command -v "${browser}" >/dev/null 2>&1; then "${browser}" "${url}" >/dev/null 2>&1 & return 0; fi
  done
  return 1
}

[[ -f "index.html" ]] || fail "index.html não encontrado. Extraia o ZIP e execute este .sh dentro da pasta raiz do jogo."
[[ -d "src" ]] || fail "Pasta src/ não encontrada. O ZIP pode estar incompleto."
[[ -d "vendor" ]] || fail "Pasta vendor/ não encontrada. O ZIP pode estar incompleto."
[[ -f "tools/serve_no_cache.py" ]] || fail "tools/serve_no_cache.py não encontrado. O ZIP pode estar incompleto."

PY="$(find_python)"
START_PORT="${PORT}"
TRIES=0
while port_in_use "${PORT}"; do
  echo "[AVISO] Porta ${PORT} já está ocupada, provavelmente por uma versão antiga aberta. Tentando próxima porta..."
  TRIES=$((TRIES + 1))
  if (( TRIES >= MAX_PORT_TRIES )); then
    fail "Portas ${START_PORT}..$((START_PORT + MAX_PORT_TRIES - 1)) ocupadas. Feche servidores antigos ou rode com PORT=8130 ./iniciar-terra-nova-bazzite.sh"
  fi
  PORT=$((PORT + 1))
done

URL="http://${HOST}:${PORT}/?cache=${CACHE_BUST}"
: > "${LOG_FILE}"

echo "============================================================"
echo "${APP_NAME} ${APP_VERSION}"
echo "Inicializador Bazzite/Linux SEM CACHE"
echo "Pasta: $(pwd)"
echo "Servidor: ${URL}"
echo "Python: $(${PY} --version 2>&1)"
echo "Log: ${LOG_FILE}"
echo "Se outra aba em 8123 mostrar versão antiga, feche essa aba/servidor. Use a URL acima."
echo "Para fechar o jogo: CTRL+C neste terminal."
echo "============================================================"

"${PY}" tools/serve_no_cache.py --host "${HOST}" --port "${PORT}" --root "$(pwd)" >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

cleanup() { if kill -0 "${SERVER_PID}" >/dev/null 2>&1; then kill "${SERVER_PID}" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT INT TERM

sleep 1
if ! kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
  echo "[ERRO] O servidor local não subiu. Log:" >&2
  cat "${LOG_FILE}" >&2 || true
  fail "Servidor local falhou."
fi

if ! open_browser "${URL}"; then
  echo "Não consegui abrir o navegador automaticamente. Abra manualmente: ${URL}"
fi

wait "${SERVER_PID}"
