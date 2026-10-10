#!/usr/bin/env bash
set -euo pipefail
nproc_pat='$(nproc)'
cpus="$(getconf _NPROCESSORS_ONLN)"
while IFS= read -r -d '' key && IFS= read -r -d '' raw; do
  export "$key=${raw//"$nproc_pat"/$cpus}"
done < <(jq -j 'objects | to_entries[] | .key, "\u0000", (.value | tostring), "\u0000"' <<<"${TARGET_ENV:-null}")

if [ -n "${COMMAND:-}" ]; then
  bash -c "$COMMAND"
else
  cd docker && docker compose build "$SERVICE" && docker compose run --rm "$SERVICE"
fi
