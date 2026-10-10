#!/usr/bin/env bash
set -euo pipefail
kind=$1 sha=$2 dir=$3 under=${4-} channel=${5-}
here=$(dirname "$0")

files=$(
  python3 - "$dir" "$under" <<'PY'
import json, os, sys
root, under = sys.argv[1:]
paths = [os.path.join(d, n) for d, _, names in os.walk(root) for n in names]
print(json.dumps([{"path": os.path.join(under, os.path.relpath(p, root)), "size": os.path.getsize(p)} for p in paths]))
PY
)
[ "$(jq length <<<"$files")" -gt 0 ] || {
  echo "::error::nothing to upload in $dir" >&2
  exit 1
}
resp=$(jq -c --arg kind "$kind" --arg sha "$sha" --arg channel "$channel" '{$kind, $sha, $channel, files: .}' <<<"$files" |
  bash "$here/ci_call.sh" upload)

put() {
  local type=application/octet-stream
  case $1 in
    *.html) type="text/html; charset=utf-8" ;;
    *.json) type=application/json ;;
    *.png) type=image/png ;;
  esac
  curl -fsS --globoff --retry 3 -X PUT -H "Content-Type: $type" --upload-file "$1" -o /dev/null "$2"
}
export -f put

jq -j '.urls[] | .path, "\u0000", .url, "\u0000"' <<<"$resp" |
  while IFS= read -r -d '' path && IFS= read -r -d '' url; do printf '%s\0%s\0' "${path#"$under"/}" "$url"; done |
  (cd "$dir" && xargs -0 -n 2 -P 8 bash -c 'put "$0" "$1"')
