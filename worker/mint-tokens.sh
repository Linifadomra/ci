#!/usr/bin/env bash
set -euo pipefail
out="${1:?output file required}"
: "${CF_API_TOKEN:?CF_API_TOKEN required}"
acct=52305f45b83875b07894fed89e2aae93
base="https://api.cloudflare.com/client/v4/accounts/$acct"
api() { curl -fsS -H "Authorization: Bearer $CF_API_TOKEN" -H 'Content-Type: application/json' "$@"; }
groups="$(api "$base/tokens/permission_groups")"
gid() { jq -er --arg n "$1" '.result[] | select(.name == $n) | .id' <<<"$groups"; }
policy() {
  jq -n --arg name "$1" --arg g "$(gid "$2")" --arg r "$3" \
    '{name: $name, policies: [{effect: "allow", permission_groups: [{id: $g}], resources: {($r): "*"}}]}'
}
r2="$(api -X POST "$base/tokens" -d "$(policy "linif-builds r2" "Workers R2 Storage Bucket Item Write" "com.cloudflare.edge.r2.bucket.${acct}_default_linif-builds")")"
analytics="$(api -X POST "$base/tokens" -d "$(policy "linif-builds analytics" "Account Analytics Read" "com.cloudflare.api.account.$acct")")"
umask 077
{
  printf 'LINIF_R2_BUILDS_ACCESS_KEY_ID=%s\n' "$(jq -r .result.id <<<"$r2")"
  printf 'LINIF_R2_BUILDS_SECRET_ACCESS_KEY=%s\n' "$(jq -j .result.value <<<"$r2" | shasum -a 256 | cut -d' ' -f1)"
  printf 'LINIF_CF_ANALYTICS_TOKEN=%s\n' "$(jq -r .result.value <<<"$analytics")"
} >"$out"
echo "minted into $out"
