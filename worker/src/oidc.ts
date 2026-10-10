import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { HttpError } from "./http";
import type { Env } from "./types";

const ISSUER = "https://token.actions.githubusercontent.com";
const FORK_TRUSTING_EVENTS = new Set(["pull_request_target", "workflow_run"]);
const jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));

export interface CiClaims {
  repository: string;
  repository_owner: string;
  repository_owner_id: string;
  ref: string;
  event_name: string;
  job_workflow_ref: string;
}

export async function verifyCi(
  token: string,
  env: Env,
  getKey: JWTVerifyGetKey = jwks,
): Promise<CiClaims> {
  let claims: CiClaims;
  try {
    ({ payload: claims } = await jwtVerify<CiClaims>(token, getKey, {
      issuer: ISSUER,
      audience: env.AUDIENCE,
    }));
  } catch (e) {
    throw new HttpError(401, `invalid OIDC token: ${String(e)}`);
  }
  if (
    claims.repository_owner !== env.OWNER ||
    claims.repository_owner_id !== env.OWNER_ID
  ) {
    throw new HttpError(403, `${claims.repository} is not in ${env.OWNER}`);
  }
  if (FORK_TRUSTING_EVENTS.has(claims.event_name)) {
    throw new HttpError(
      403,
      `${claims.event_name} runs a trusted ref on behalf of other code; not accepted`,
    );
  }
  const workflow = claims.job_workflow_ref ?? "";
  const [file = "", ref, extra] = workflow
    .slice(env.WORKFLOW_PREFIX.length)
    .split("@");
  const ours =
    workflow.startsWith(env.WORKFLOW_PREFIX) && /^[\w.-]+\.ya?ml$/.test(file);
  if (!ours || ref !== env.WORKFLOW_REF || extra !== undefined) {
    throw new HttpError(
      403,
      `uploads must come from a Linifadomra/ci workflow on ${env.WORKFLOW_REF}`,
    );
  }
  return claims;
}

export function scopeName(branch: string): string {
  return branch.replaceAll("/", "~");
}

export function scopeOf(ref: string): string {
  const pr = ref.match(/^refs\/pull\/(\d+)\/merge$/);
  if (pr) return `pr-${pr[1]}`;
  if (ref.startsWith("refs/heads/")) {
    const branch = ref.slice("refs/heads/".length);
    if (/^pr-\d+$/.test(branch)) {
      throw new HttpError(
        403,
        `branch ${branch} would collide with a PR scope`,
      );
    }
    return scopeName(branch);
  }
  throw new HttpError(403, `unsupported ref ${ref}`);
}
