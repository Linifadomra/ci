#!/usr/bin/env bash
set -euo pipefail
name=$1 channel=$2 base=$3 ipa=$4 scope=$5 sha=$6
here=$(dirname "$0")
[ -f "$ipa" ] || {
  echo "::error::no IPA at $ipa" >&2
  exit 1
}

stage=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ci.XXXXXX")
manifest=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ci.XXXXXX")
curl -fsS "${REPO_BASE:-https://repo.linifadomra.org}/$channel/apps.json" -o "$stage/apps.json"
python3 "$here/altstore_publish.py" --name "$name" --repo-dir "$stage" --base "$base" "$ipa" "$scope" "$sha"
mv "$stage/apps.json" "$manifest/"

bash "$here/upload.sh" altstore "$sha" "$stage" "" "$channel"
bash "$here/upload.sh" altstore "$sha" "$manifest" "" "$channel"
