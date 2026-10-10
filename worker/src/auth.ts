import { HttpError } from "./http";
import { cookie, readCookie, seal, sign, unsign } from "./session";
import type { Env, Fetch } from "./types";

const BASE = "https://builds.linifadomra.org";
const CALLBACK = `${BASE}/_auth/callback`;
const SESSION_MS = 12 * 3600 * 1000;

export function safeNext(next: string | null): string {
  if (!next?.startsWith("/")) return "/";
  const url = new URL(next, BASE);
  if (url.origin !== BASE || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search;
}

export async function login(req: Request, env: Env): Promise<Response> {
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const nonce = crypto.randomUUID();
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.GH_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", CALLBACK);
  authorize.searchParams.set("state", nonce);
  authorize.searchParams.set("allow_signup", "false");
  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      "Set-Cookie": cookie(
        "linif_state",
        await sign(env, "state", JSON.stringify({ nonce, next })),
        600,
      ),
    },
  });
}

export async function callback(
  req: Request,
  env: Env,
  f: Fetch = fetch,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(req.url);
  const raw = await unsign(env, "state", readCookie(req, "linif_state"));
  const state = raw
    ? (JSON.parse(raw) as { nonce: string; next: string })
    : null;
  if (!state || state.nonce !== url.searchParams.get("state")) {
    throw new HttpError(
      400,
      "sign-in expired or was started elsewhere, open the build link again",
    );
  }
  const tokenRes = await f("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: env.GH_CLIENT_ID,
      client_secret: env.GH_CLIENT_SECRET,
      code: url.searchParams.get("code"),
      redirect_uri: CALLBACK,
    }),
  });
  const { access_token } = await tokenRes.json<{ access_token?: string }>();
  if (!access_token) throw new HttpError(502, "GitHub did not return a token");
  const userRes = await f("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${access_token}`,
      "User-Agent": "linif-builds",
    },
  });
  if (!userRes.ok) {
    throw new HttpError(502, `GitHub user lookup failed: ${userRes.status}`);
  }
  const { login: name } = await userRes.json<{ login: string }>();
  const headers = new Headers({ Location: safeNext(state.next) });
  const session = await seal(env, {
    login: name,
    exp: now + SESSION_MS,
    allow: {},
  });
  headers.append("Set-Cookie", cookie("linif_s", session, SESSION_MS / 1000));
  headers.append("Set-Cookie", cookie("linif_state", "", 0));
  return new Response(null, { status: 302, headers });
}
