#!/usr/bin/env bash

cc_cmdline="${SPRINT_CMDLINE:-/proc/cmdline}"
cc_port=8411
cc_max_files=2000

cc_log() {
  echo "cache: $*" >&2
}

cc_gateway() {
  tr ' ' '\n' <"$cc_cmdline" | sed -n 's/^sprint\.gw=//p'
}

cc_enabled() {
  grep -qw 'sprint.state_verified=1' "$cc_cmdline" 2>/dev/null || return 1
  local gw
  gw="$(cc_gateway)"
  [ -n "$gw" ] || return 1
  cc_url="http://$gw:$cc_port"
  local code
  code="$(curl -s -o /dev/null -m 3 -w '%{http_code}' "$cc_url/deps/" || true)"
  [ "$code" != 000 ]
}

cc_head() {
  curl -fsI -m 10 -o /dev/null "$cc_url/deps/$1.sha256"
}

cc_get() {
  curl -fsS -m 900 -o "$2" "$cc_url/deps/$1" 2>/dev/null
}

cc_upload() {
  local code
  code="$(curl -s -o /dev/null -m 1800 -w '%{http_code}' -T "$2" "$cc_url/deps/$1" || true)"
  case "$code" in
    2??) return 0 ;;
    403) cc_log "$1: write not allowed for this job" ;;
    *) cc_log "$1: upload failed ($code)" ;;
  esac
  return 1
}

cc_put() {
  local sum
  sum="$(mktemp)"
  sha256sum "$2" | cut -c1-64 >"$sum"
  cc_upload "$1" "$2" && cc_upload "$1.sha256" "$sum"
  local ok=$?
  rm -f "$sum"
  return "$ok"
}

cc_fetch() {
  local name=$1 out=$2 want got
  want="$(curl -fsS -m 30 "$cc_url/deps/$name.sha256" 2>/dev/null | tr -d '[:space:]')" || return 1
  [[ $want =~ ^[0-9a-f]{64}$ ]] || return 1
  cc_get "$name" "$out" || return 1
  got="$(sha256sum "$out" | cut -c1-64)"
  if [ "$got" != "$want" ]; then
    cc_log "$name checksum mismatch, discarded"
    : >"$out"
    return 1
  fi
}

cc_hash() {
  local root=$1
  shift
  local f
  for f in "$@"; do
    printf '%s\0%s\0' "$f" "$(sha256sum "$root/$f" | cut -c1-64)"
  done | sha256sum | cut -c1-64
}

cc_list() {
  local dir=$1 count
  shift
  git -C "$dir" ls-files --recurse-submodules -- "$@" | LC_ALL=C sort >"$cc_listing"
  count="$(wc -l <"$cc_listing")"
  if [ "$count" -gt "$cc_max_files" ]; then
    cc_log "$dir lists $count files, over the $cc_max_files cap; not caching"
    return 1
  fi
}

cpm_key() {
  local root=$1 files=() f
  cc_listing="$(mktemp)"
  if ! cc_list "$root" 'CMakeLists.txt' '*/CMakeLists.txt' '*.cmake'; then
    rm -f "$cc_listing"
    return 1
  fi
  while IFS= read -r f; do
    grep -qE 'CPMAddPackage|FetchContent' "$root/$f" 2>/dev/null && files+=("$f")
  done <"$cc_listing"
  rm -f "$cc_listing"
  [ ${#files[@]} -gt 0 ] || return 1
  cc_hash "$root" "${files[@]}"
}

image_key() {
  local context=$1 dockerfile=$2 args=${3:-} files=() f
  cc_listing="$(mktemp)"
  if ! cc_list "$context" .; then
    rm -f "$cc_listing"
    return 1
  fi
  while IFS= read -r f; do files+=("$f"); done <"$cc_listing"
  rm -f "$cc_listing"
  {
    printf 'context\0%s\0' "$(cc_hash "$context" "${files[@]}")"
    [ -f "$context/.dockerignore" ] && printf 'dockerignore\0%s\0' "$(sha256sum "$context/.dockerignore" | cut -c1-64)"
    printf 'dockerfile\0%s\0' "$(sha256sum "$dockerfile" | cut -c1-64)"
    printf 'from\0%s\0' "$(grep -iE '^[[:space:]]*FROM[[:space:]]' "$dockerfile" | tr -s '[:space:]' ' ')"
    printf 'args\0%s\0' "$args"
  } | sha256sum | cut -c1-64
}

cc_image() {
  jq -r --arg s "$2" '.services[$s].image // (.name + "-" + $s)' "$1"
}

cc_cpm_mount() {
  jq -r --arg s "$2" '
    .services[$s].volumes // [] | map(select(.target | test("cpm"))) | first // empty |
    if .type == "volume" then "volume \(.source)" elif .type == "bind" then "bind \(.source)" else empty end
  ' "$1"
}

cc_override() {
  local cfg=$1 svc=$2 gw=$3 image=$4
  jq -n --arg s "$svc" --arg gw "$gw" --arg port "$cc_port" --arg image "$image" \
    --argjson net "$(jq --arg s "$svc" '.services[$s].network_mode // ""' "$cfg")" \
    --argjson build "$(jq --arg s "$svc" '.services[$s] | has("build")' "$cfg")" '
    {services: {($s): (
      (if $net == "none" then {} else {
        environment: {CCACHE_SECONDARY_STORAGE: "http://\($gw):\($port)/cc|layout=subdirs"}
      } end)
      + (if $build then {build: {cache_from: [$image], args: {BUILDKIT_INLINE_CACHE: "1"}}} else {} end)
    )}}'
}

cc_compose_files() {
  if [ -n "${COMPOSE_FILE:-}" ]; then
    tr ':' '\n' <<<"$COMPOSE_FILE"
    return
  fi
  local f
  for f in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    [ -f "$f" ] && echo "$f" && break
  done
  for f in compose.override.yaml compose.override.yml docker-compose.override.yaml docker-compose.override.yml; do
    [ -f "$f" ] && echo "$f" && break
  done
}

cc_volume_dir() {
  local name=$1
  docker volume inspect "$name" >/dev/null 2>&1 || docker volume create "$name" >/dev/null || return 1
  docker volume inspect -f '{{.Mountpoint}}' "$name"
}

cc_restore_dir() {
  local name=$1 dir=$2 t0=$SECONDS
  if ! cc_head "$name"; then
    cc_log "$name miss"
    return 1
  fi
  if [ -n "$(ls -A "$dir" 2>/dev/null)" ]; then
    cc_log "$name present locally"
    return 0
  fi
  local tmp
  tmp="$(mktemp)"
  if cc_fetch "$name" "$tmp" && mkdir -p "$dir" && zstd -dcq "$tmp" | tar -x -C "$dir"; then
    cc_log "$name hit $((SECONDS - t0))s"
  else
    cc_log "$name restore failed"
  fi
  rm -f "$tmp"
  return 0
}

cc_save_dir() {
  local name=$1 dir=$2 t0=$SECONDS tmp
  [ -n "$(ls -A "$dir" 2>/dev/null)" ] || return 0
  tmp="$(mktemp)"
  if tar -C "$dir" -c . | zstd -q -T0 -o "$tmp" -f && cc_put "$name" "$tmp"; then
    cc_log "$name saved $((SECONDS - t0))s"
  fi
  rm -f "$tmp"
}

cc_restore_image() {
  local name=$1 image=$2 t0=$SECONDS tmp
  if docker image inspect "$image" >/dev/null 2>&1; then
    cc_head "$name" && return 0
    return 1
  fi
  if ! cc_head "$name"; then
    cc_log "$name miss"
    return 1
  fi
  tmp="$(mktemp)"
  if cc_fetch "$name" "$tmp" && cc_load "$tmp" "$image"; then
    cc_log "$name hit $((SECONDS - t0))s"
  else
    cc_log "$name restore failed"
  fi
  rm -f "$tmp"
  return 0
}

cc_load() {
  local archive=$1 want=$2 out loaded
  [[ $want == *:* ]] || want="$want:latest"
  out="$(zstd -dcq "$archive" | docker load 2>&1)" || true
  if [ "$out" = "Loaded image: $want" ] && docker image inspect "$want" >/dev/null 2>&1; then
    return 0
  fi
  while IFS= read -r loaded; do
    [ -n "$loaded" ] && docker rmi -f "$loaded" >/dev/null 2>&1
  done < <(sed -n 's/^Loaded image\( ID\)\{0,1\}: //p' <<<"$out")
  cc_log "image archive held something other than $want; discarded"
  return 1
}

cc_save_image() {
  local name=$1 image=$2 t0=$SECONDS tmp
  tmp="$(mktemp)"
  if docker save "$image" | zstd -q -T0 -o "$tmp" -f && cc_put "$name" "$tmp"; then
    cc_log "$name saved $((SECONDS - t0))s"
  fi
  rm -f "$tmp"
}
