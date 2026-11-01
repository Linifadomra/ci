import { HttpError } from "./http";
import { safePath } from "./presign";
import type { Project } from "./projects";
import type { Env, Fetch } from "./types";

const SHA = /^[0-9a-f]{40}$/;
const GITHUB_URL =
  /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i;

interface DepBody {
  url?: string;
  sha?: string;
}

function gh(
  env: Env,
  path: string,
  f: Fetch,
  accept = "application/vnd.github+json",
): Promise<Response> {
  return f(`https://api.github.com/repos/${env.OWNER}/${path}`, {
    headers: {
      Authorization: `Bearer ${env.GH_DEPS_TOKEN}`,
      Accept: accept,
      "User-Agent": "linif-builds",
    },
  });
}

export function parseGitmodules(text: string): { path: string; url: string }[] {
  const mods: { path: string; url: string }[] = [];
  for (const block of text.split(/^\s*\[submodule /m).slice(1)) {
    const path = /^\s*path\s*=\s*(.+?)\s*$/m.exec(block)?.[1];
    const url = /^\s*url\s*=\s*(.+?)\s*$/m.exec(block)?.[1];
    if (path && url) mods.push({ path, url });
  }
  return mods;
}

async function allowed(env: Env, project: Project, body: DepBody, f: Fetch) {
  const match = GITHUB_URL.exec(body.url ?? "");
  const repo = match?.[2]?.toLowerCase();
  if (
    !repo ||
    /^\.+$/.test(repo) ||
    match?.[1]?.toLowerCase() !== env.OWNER.toLowerCase()
  ) {
    throw new HttpError(400, `${body.url} is not a ${env.OWNER} repository`);
  }
  if (!body.sha || !SHA.test(body.sha)) {
    throw new HttpError(400, "sha must be 40 hex characters");
  }
  if (project.deps.some((d) => d.toLowerCase() === repo)) {
    return { repo, sha: body.sha };
  }

  const res = await gh(env, repo, f);
  if (res.ok && (await res.json<{ private?: boolean }>()).private === false) {
    return { repo, sha: body.sha };
  }
  throw new HttpError(403, `${repo} is not in ${project.repo}'s deps`);
}

export async function archive(
  env: Env,
  project: Project,
  body: DepBody,
  f: Fetch = fetch,
): Promise<Response> {
  const { repo, sha } = await allowed(env, project, body, f);
  const res = await gh(env, `${repo}/tarball/${sha}`, f);
  if (res.status === 404) {
    throw new HttpError(
      404,
      `pinned commit ${sha} of ${repo} is not on GitHub`,
    );
  }
  if (!res.ok) {
    throw new HttpError(502, `github archive of ${repo} failed: ${res.status}`);
  }
  return new Response(res.body, {
    headers: { "Content-Type": "application/gzip" },
  });
}

async function pin(
  env: Env,
  repo: string,
  sha: string,
  path: string,
  f: Fetch,
): Promise<string | null> {
  const res = await gh(
    env,
    `${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${sha}`,
    f,
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new HttpError(
      502,
      `github lookup of ${repo}/${path} failed: ${res.status}`,
    );
  }
  const entry = await res.json<{ type?: string; sha: string }>();
  return entry.type === "submodule" ? entry.sha : null;
}

export async function submodules(
  env: Env,
  project: Project,
  body: DepBody,
  f: Fetch = fetch,
): Promise<Response> {
  const { repo, sha } = await allowed(env, project, body, f);
  const res = await gh(
    env,
    `${repo}/contents/.gitmodules?ref=${sha}`,
    f,
    "application/vnd.github.raw",
  );
  if (res.status === 404) return Response.json({ submodules: [] });
  if (!res.ok) {
    throw new HttpError(
      502,
      `github .gitmodules of ${repo} failed: ${res.status}`,
    );
  }

  const mods = parseGitmodules(await res.text());
  const bad = mods.find((m) => !safePath(m.path));
  if (bad) {
    throw new HttpError(
      400,
      `${repo} has a submodule outside the repository: ${bad.path}`,
    );
  }
  const list = await Promise.all(
    mods.map(async (m) => ({
      ...m,
      sha: await pin(env, repo, sha, m.path, f),
    })),
  );
  return Response.json({ submodules: list.filter((m) => m.sha) });
}
