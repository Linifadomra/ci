#!/usr/bin/env bash
set -euo pipefail
here=$(dirname "$0")

pins_git() {
  local key path name
  [ -f "$1/.gitmodules" ] || return 0
  git -C "$1" config -f .gitmodules --get-regexp '^submodule\..*\.path$' | while read -r key path; do
    name="${key#submodule.}"
    name="${name%.path}"
    printf '%s\t%s\t%s\n' "$path" "$(git -C "$1" config -f .gitmodules "submodule.$name.url")" "$(git -C "$1" rev-parse "HEAD:$path")"
  done
}

request() {
  jq -n --arg url "$2" --arg sha "$3" '{url: $url, sha: $sha}' | bash "$here/ci_call.sh" "$1"
}

fill() {
  local dir="$1" pins="$2" path url sha nested
  [ -n "$pins" ] || return 0
  while IFS=$'\t' read -r path url sha; do
    case "/$path/" in
      //* | */./* | */../*)
        echo "::error::submodule outside the repository: $path" >&2
        exit 1
        ;;
    esac
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
      echo "::error::submodule $path is pinned to '$sha', not a commit" >&2
      exit 1
    }
    mkdir -p "$dir/$path"
    if [[ "$(tr '[:upper:]' '[:lower:]' <<<"$url")" == https://github.com/linifadomra/* ]]; then
      request archive "$url" "$sha" | tar -xzf - --strip-components=1 -C "$dir/$path"
      nested="$(request deps "$url" "$sha" | jq -r '.submodules[] | [.path, .url, .sha] | @tsv')"
    else
      git -C "$dir/$path" init -q
      git -C "$dir/$path" fetch -q --depth 1 -- "$url" "$sha"
      git -C "$dir/$path" checkout -q FETCH_HEAD
      nested="$(pins_git "$dir/$path")"
    fi
    fill "$dir/$path" "$nested"
  done <<<"$pins"
}

pins="$(pins_git "${1:-.}")"
fill "${1:-.}" "$pins"
