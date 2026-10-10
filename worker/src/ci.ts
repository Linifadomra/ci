import type { JWTVerifyGetKey } from "jose";
import { listAll, removeKeys } from "./bucket";
import { assertOpen } from "./cap";
import { archive, submodules } from "./deps";
import { defaultBranch } from "./github";
import { errorResponse, HttpError } from "./http";
import { scopeOf, verifyCi, type CiClaims } from "./oidc";
import { safePath, signer } from "./presign";
import { byRepo, type Project } from "./projects";
import type { Env, Fetch } from "./types";

const SHA = /^[0-9a-f]{40}$/;
const MAX_BYTES = 5 * 1024 ** 3;
const MAX_FILES = 1000;

interface CiDeps {
  getKey?: JWTVerifyGetKey;
  fetcher?: Fetch;
  now?: number;
}

interface CiBody {
  kind?: "builds" | "altstore";
  sha?: string;
  channel?: string;
  url?: string;
  files?: { path: string; size: number }[];
}

function bearer(req: Request): string {
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    throw new HttpError(401, "missing bearer token");
  }
  return auth.slice("Bearer ".length);
}

function buildsPrefix(
  project: Project,
  claims: CiClaims,
  sha: string | undefined,
): string {
  if (!sha || !SHA.test(sha)) {
    throw new HttpError(400, "sha must be 40 hex characters");
  }
  return `builds/${project.slug}/${scopeOf(claims.ref)}/${sha}/`;
}

async function altstorePrefix(
  env: Env,
  project: Project,
  claims: CiClaims,
  channel: string | undefined,
  f?: Fetch,
) {
  if (!channel || !project.altstore.includes(channel)) {
    throw new HttpError(
      403,
      `${channel} is not an AltStore channel of ${project.repo}`,
    );
  }
  if (
    claims.ref !== `refs/heads/${await defaultBranch(env, project.repo, f)}`
  ) {
    throw new HttpError(403, "AltStore publishes only from the default branch");
  }
  return `altstore/${channel}/`;
}

async function upload(
  env: Env,
  project: Project,
  claims: CiClaims,
  body: CiBody,
  deps: CiDeps,
) {
  await assertOpen(env, deps.now ?? Date.now());
  const prefix =
    body.kind === "altstore"
      ? await altstorePrefix(env, project, claims, body.channel, deps.fetcher)
      : buildsPrefix(project, claims, body.sha);
  const files = body.files ?? [];
  if (files.length === 0) throw new HttpError(400, "no files to upload");
  if (files.length > MAX_FILES) {
    throw new HttpError(
      400,
      `${files.length} files in one upload; the limit is ${MAX_FILES}`,
    );
  }
  for (const file of files) {
    if (!safePath(file.path)) throw new HttpError(400, `bad path ${file.path}`);
    if (file.size > MAX_BYTES) {
      throw new HttpError(413, `${file.path} is over 5 GiB`);
    }
  }
  const sign = signer(env);
  const urls = await Promise.all(
    files.map(async (file) => ({
      path: file.path,
      url: await sign(prefix + file.path),
    })),
  );
  return Response.json({ prefix, urls });
}

async function deleteScope(env: Env, project: Project, claims: CiClaims) {
  const scope = scopeOf(claims.ref);
  if (!scope.startsWith("pr-")) {
    throw new HttpError(403, "only PR scopes can be deleted");
  }
  const keys = (await listAll(env, `builds/${project.slug}/${scope}/`)).map(
    (o) => o.key,
  );
  return Response.json({ deleted: await removeKeys(env, keys) });
}

async function route(req: Request, env: Env, deps: CiDeps): Promise<Response> {
  const claims = await verifyCi(bearer(req), env, deps.getKey);
  const project = byRepo(env, claims.repository.slice(env.OWNER.length + 1));
  if (!project) {
    throw new HttpError(403, `${claims.repository} has no builds slug`);
  }
  const body = await req.json<CiBody>();
  switch (new URL(req.url).pathname) {
    case "/_ci/upload":
      return upload(env, project, claims, body, deps);
    case "/_ci/list": {
      const prefix = buildsPrefix(project, claims, body.sha);
      const keys = (await listAll(env, prefix)).map((o) =>
        o.key.slice(prefix.length),
      );
      return Response.json({ prefix, keys });
    }
    case "/_ci/delete-scope":
      return deleteScope(env, project, claims);
    case "/_ci/archive":
      return archive(env, project, body, deps.fetcher);
    case "/_ci/deps":
      return submodules(env, project, body, deps.fetcher);
  }
  throw new HttpError(404, "not found");
}

export async function handleCi(
  req: Request,
  env: Env,
  deps: CiDeps = {},
): Promise<Response> {
  try {
    return await route(req, env, deps);
  } catch (e) {
    return errorResponse(e);
  }
}
