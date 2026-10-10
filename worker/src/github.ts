import { HttpError } from "./http";
import type { Env, Fetch } from "./types";

function api(env: Env, path: string, f: Fetch): Promise<Response> {
  return f(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${env.GH_METADATA_TOKEN}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "linif-builds",
    },
  });
}

export async function permission(
  env: Env,
  repo: string,
  login: string,
  f: Fetch = fetch,
): Promise<boolean> {
  const res = await api(
    env,
    `/repos/${env.OWNER}/${repo}/collaborators/${encodeURIComponent(login)}/permission`,
    f,
  );
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new HttpError(502, `github permission lookup failed: ${res.status}`);
  }
  const { permission } = await res.json<{ permission: string }>();
  return permission !== "none";
}

export async function defaultBranch(
  env: Env,
  repo: string,
  f: Fetch = fetch,
): Promise<string> {
  const res = await api(env, `/repos/${env.OWNER}/${repo}`, f);
  if (!res.ok) {
    throw new HttpError(502, `github repo lookup failed: ${res.status}`);
  }
  return (await res.json<{ default_branch: string }>()).default_branch;
}
