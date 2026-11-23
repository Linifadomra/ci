#!/usr/bin/env bash
set -euo pipefail
nproc_pat='$(nproc)'
cpus="$(getconf _NPROCESSORS_ONLN)"
while IFS= read -r -d '' key && IFS= read -r -d '' raw; do
  export "$key=${raw//"$nproc_pat"/$cpus}"
done < <(jq -j 'objects | to_entries[] | .key, "\u0000", (.value | tostring), "\u0000"' <<<"${TARGET_ENV:-null}")

if [ -n "${COMMAND:-}" ]; then
  exec bash -c "$COMMAND"
fi

. "$(dirname "${BASH_SOURCE[0]}")/content_cache.sh"
cd docker

if ! cc_enabled; then
  docker compose build "$SERVICE" && docker compose run --rm "$SERVICE"
  exit
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cfg="$work/config.json"
override="$work/override.json"
docker compose config --format json >"$cfg"

image="$(cc_image "$cfg" "$SERVICE")"
image_name=""
if [ "$(jq --arg s "$SERVICE" '.services[$s] | has("build")' "$cfg")" = true ]; then
  context="$(jq -r --arg s "$SERVICE" '.services[$s].build.context' "$cfg")"
  dockerfile="$context/$(jq -r --arg s "$SERVICE" '.services[$s].build.dockerfile // "Dockerfile"' "$cfg")"
  build_args="$(jq -c --arg s "$SERVICE" '.services[$s].build.args // {}' "$cfg")"
  key="$(image_key "$context" "$dockerfile" "$build_args" || true)"
  [ -n "$key" ] && image_name="image-$SERVICE-$key.tar.zst"
fi
image_saved=1
if [ -n "$image_name" ]; then
  cc_restore_image "$image_name" "$image" || image_saved=0
fi

cpm_dir="" cpm_name="" cpm_saved=1
read -r kind source < <(cc_cpm_mount "$cfg" "$SERVICE" || true) || true
case "${kind:-}" in
  volume) cpm_dir="$(cc_volume_dir "$(jq -r --arg v "$source" '.volumes[$v].name // $v' "$cfg")" || true)" ;;
  bind) cpm_dir="$source" ;;
esac
if [ -n "$cpm_dir" ] && key="$(cpm_key "$(git rev-parse --show-toplevel)")"; then
  cpm_name="cpm-$key.tar.zst"
  cc_restore_dir "$cpm_name" "$cpm_dir" || cpm_saved=0
fi

cc_override "$cfg" "$SERVICE" "$(cc_gateway)" "$image" >"$override"
files=()
while IFS= read -r f; do files+=(-f "$f"); done < <(cc_compose_files)
files+=(-f "$override")

DOCKER_BUILDKIT=1 docker compose "${files[@]}" build "$SERVICE"
docker compose "${files[@]}" run --rm "$SERVICE"

if [ "$image_saved" = 0 ]; then cc_save_image "$image_name" "$image" || true; fi
if [ "$cpm_saved" = 0 ] && [ -n "$cpm_name" ]; then cc_save_dir "$cpm_name" "$cpm_dir" || true; fi
