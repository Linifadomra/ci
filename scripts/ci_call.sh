#!/usr/bin/env bash
set -euo pipefail
api=${BUILDS_API:-https://builds.linifadomra.org}
body=$(mktemp)
trap 'rm -f "$body"' EXIT

token=$(curl -fsS -H "Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
  "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=builds.linifadomra.org" </dev/null | jq -er .value)
code=$(curl -sS -o "$body" -w '%{http_code}' --data-binary @- \
  -H "Authorization: Bearer $token" -H 'Content-Type: application/json' "$api/_ci/$1")
[ "$code" = 200 ] || {
  echo "::error::$1 refused ($code): $(cat "$body")" >&2
  exit 1
}
cat "$body"
