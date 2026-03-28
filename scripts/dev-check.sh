#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
WEB_DIR="$ROOT_DIR/web"

fail() {
  printf 'dev:check failed: %s\n' "$1" >&2
  exit 1
}

if [[ ! -d "$BACKEND_DIR/venv" ]]; then
  fail "missing backend virtualenv at backend/venv"
fi

if [[ ! -x "$BACKEND_DIR/venv/bin/python" ]]; then
  fail "missing Python executable at backend/venv/bin/python"
fi

if [[ ! -d "$WEB_DIR/node_modules" ]]; then
  fail "missing frontend dependencies at web/node_modules"
fi

DEV_ENV_FILE="$BACKEND_DIR/.env.dev"
ENV_FILE="$BACKEND_DIR/.env"

if [[ ! -f "$DEV_ENV_FILE" && ! -f "$ENV_FILE" ]]; then
  fail "missing backend/.env.dev and backend/.env"
fi

cred_path=""
if [[ -f "$DEV_ENV_FILE" ]]; then
  cred_path="$(awk -F= '/^LINEX_CREDENTIALS_PATH=/{sub(/^[[:space:]]+/, "", $2); print $2}' "$DEV_ENV_FILE" | tail -n 1)"
fi
if [[ -f "$ENV_FILE" ]]; then
  env_cred_path="$(awk -F= '/^LINEX_CREDENTIALS_PATH=/{sub(/^[[:space:]]+/, "", $2); print $2}' "$ENV_FILE" | tail -n 1)"
  if [[ -n "$env_cred_path" ]]; then
    cred_path="$env_cred_path"
  fi
fi
if [[ -z "$cred_path" ]]; then
  fail "LINEX_CREDENTIALS_PATH is not set in backend/.env.dev or backend/.env"
fi

if [[ ! -f "$cred_path" ]]; then
  fail "LINEX_CREDENTIALS_PATH does not exist: $cred_path"
fi

printf 'dev:check ok\n'
printf '  backend venv: %s\n' "$BACKEND_DIR/venv"
printf '  frontend deps: %s\n' "$WEB_DIR/node_modules"
if [[ -f "$ENV_FILE" ]]; then
  printf '  backend env: %s (overrides %s)\n' "${ENV_FILE#$ROOT_DIR/}" "${DEV_ENV_FILE#$ROOT_DIR/}"
else
  printf '  backend env: %s\n' "${DEV_ENV_FILE#$ROOT_DIR/}"
fi
printf '  firebase creds: %s\n' "$cred_path"
