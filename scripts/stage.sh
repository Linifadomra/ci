#!/usr/bin/env bash
set -euo pipefail
dir=$1 zip=$2
[ -d "$dir" ] || {
  echo "::error::no build output at $dir" >&2
  exit 1
}

stage=$(mktemp -d "${RUNNER_TEMP:-/tmp}/ci.XXXXXX")
find "$dir" -maxdepth 1 -type f -exec cp {} "$stage" \;
if [ -n "$(find "$dir" -type f ! -name '*.AppImage' | head -1)" ]; then
  (cd "$dir" && env -u ZIP -u ZIPOPT zip -qr "$stage/$zip" . -x '*.AppImage')
fi
echo "$stage"
