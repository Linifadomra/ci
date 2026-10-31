import { permission } from "./github";
import { byChannel, bySlug } from "./projects";
import { cookie, openSession, readCookie, seal } from "./session";
import type { Env, Fetch } from "./types";

const RECHECK_MS = 5 * 60_000;
const SANDBOX =
  "sandbox allow-downloads; default-src 'none'; style-src 'unsafe-inline'";

interface ServeDeps {
  fetcher?: Fetch;
  origin?: Fetch;
  now?: number;
}

function notFound(): Response {
  return new Response("not found\n", { status: 404 });
}

function segments(pathname: string): string[] | null {
  try {
    return pathname.slice(1).split("/").map(decodeURIComponent);
  } catch {
    return null;
  }
}

async function object(
  req: Request,
  env: Env,
  key: string,
  gated: boolean,
  setCookie?: string,
): Promise<Response> {
  const obj = await env.BUCKET.get(key);
  if (!obj) return notFound();
  const headers = new Headers({ ETag: obj.httpEtag });
  obj.writeHttpMetadata(headers);
  headers.set(
    "Cache-Control",
    gated ? "private, max-age=300" : "public, max-age=60",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  if (gated) headers.set("Content-Security-Policy", SANDBOX);
  else headers.set("Access-Control-Allow-Origin", "*");
  if (setCookie) headers.append("Set-Cookie", setCookie);
  return new Response(req.method === "HEAD" ? null : obj.body, { headers });
}

export async function serve(
  req: Request,
  env: Env,
  deps: ServeDeps = {},
): Promise<Response> {
  const url = new URL(req.url);
  const parts = segments(url.pathname);
  if (!parts) return notFound();
  const [slug = "", ...rest] = parts;
  const origin = deps.origin ?? fetch;

  if (url.hostname === "repo.linifadomra.org") {
    if (!byChannel(env, slug)) return origin(req);
    return object(req, env, `altstore/${slug}/${rest.join("/")}`, false);
  }

  const project = bySlug(env, slug);
  if (!project) return origin(req);
  if (req.method !== "GET" && req.method !== "HEAD") {
    return new Response("method not allowed\n", { status: 405 });
  }
  let key = rest.join("/");
  if (key === "" || key.endsWith("/")) key += "index.html";
  const now = deps.now ?? Date.now();
  let session = await openSession(env, readCookie(req, "linif_s"), now);
  if (!session) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `/_auth/login?next=${encodeURIComponent(url.pathname)}`,
      },
    });
  }
  let setCookie: string | undefined;
  if (now - (session.allow[project.repo] ?? 0) > RECHECK_MS) {
    if (!(await permission(env, project.repo, session.login, deps.fetcher))) {
      return notFound();
    }
    session = { ...session, allow: { ...session.allow, [project.repo]: now } };
    setCookie = cookie(
      "linif_s",
      await seal(env, session),
      Math.floor((session.exp - now) / 1000),
    );
  }
  return object(req, env, `builds/${slug}/${key}`, true, setCookie);
}
