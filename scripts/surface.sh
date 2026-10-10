#!/usr/bin/env bash
set -euo pipefail
[ -n "${LINKS:-}" ] || exit 0
api="${GITHUB_API_URL:-https://api.github.com}/repos/$GH_REPO"
auth=(-H "Authorization: Bearer $GITHUB_TOKEN" -H "Accept: application/vnd.github+json")
marker="<!-- $SLUG-builds -->"

curl -fsS "${auth[@]}" -o /dev/null "$api/check-runs" -d "$(jq -n \
  --arg sha "$HEAD_SHA" --arg url "$DETAILS_URL" --arg conclusion "${CONCLUSION:-success}" \
  '{name: "Build", head_sha: $sha, status: "completed", conclusion: $conclusion, details_url: $url,
    output: {title: "Build artifacts", summary: "Downloads: \($url)"}}')"

[ -n "${PR_NUMBER:-}" ] || exit 0
body=$(
  printf '%s\n**Builds for `%s`**\n\n' "$marker" "$HEAD_SHA"
  while IFS=$'\t' read -r label url; do
    [ -z "$label" ] || printf -- '- [%s](%s)\n' "$label" "$url"
  done <<<"$LINKS"
)
cid=$(curl -fsS "${auth[@]}" "$api/issues/$PR_NUMBER/comments?per_page=100" | jq -r --arg m "$marker" \
  'map(select(.user.login == "github-actions[bot]" and (.body | contains($m))))[0].id // empty')
if [ -n "$cid" ]; then
  method=PATCH url="$api/issues/comments/$cid"
else
  method=POST url="$api/issues/$PR_NUMBER/comments"
fi
curl -fsS "${auth[@]}" -o /dev/null -X "$method" "$url" -d "$(jq -n --arg body "$body" '{$body}')"
