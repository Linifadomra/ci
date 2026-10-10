#!/usr/bin/env bash
set -euo pipefail
name=$1 sha=$2
here=$(dirname "$0")
listing=$(jq -nc --arg sha "$sha" '{$sha}' | bash "$here/ci_call.sh" list)
path=$(jq -r '.prefix | ltrimstr("builds/") | split("/") | map(@uri) | join("/")' <<<"$listing")
base="${BUILDS_API:-https://builds.linifadomra.org}/$path"

stage=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ci.XXXXXX")
jq .keys <<<"$listing" | python3 "$here/index.py" "$name" >"$stage/index.html"
bash "$here/upload.sh" builds "$sha" "$stage"

links=$(jq -r --arg base "$base" '.keys[] | select(test("^[^/]+/[^/]+$") and (endswith(".dll") | not))
  | [., $base + (split("/") | map(@uri) | join("/"))] | @tsv' <<<"$listing")
HEAD_SHA=$sha DETAILS_URL=$base LINKS=$links bash "$here/surface.sh"
