#!/usr/bin/env bash
set -euo pipefail

env_file="${ENV_OUTPUT_FILE:-.env}"
tmp_file="${env_file}.ci"

printf '%s\n' "${ENV_FILE_CONTENT:-}" > "$env_file"

override_keys=()
if [[ -n "${DATABASE_URL_OVERRIDE:-}" ]]; then
  override_keys+=("DATABASE_URL")
fi
if [[ -n "${REDIS_URL_OVERRIDE:-}" ]]; then
  override_keys+=("REDIS_URL")
fi

if ((${#override_keys[@]} == 0)); then
  exit 0
fi

filter_pattern="^($(IFS="|"; echo "${override_keys[*]}"))="
grep -vE "$filter_pattern" "$env_file" > "$tmp_file" || test $? -eq 1
mv "$tmp_file" "$env_file"

{
  if [[ -n "${DATABASE_URL_OVERRIDE:-}" ]]; then
    printf 'DATABASE_URL=%s\n' "$DATABASE_URL_OVERRIDE"
  fi
  if [[ -n "${REDIS_URL_OVERRIDE:-}" ]]; then
    printf 'REDIS_URL=%s\n' "$REDIS_URL_OVERRIDE"
  fi
} >> "$env_file"
