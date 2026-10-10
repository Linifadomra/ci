import type { Env } from "./types";

interface Session {
  login: string;
  exp: number;
  allow: Record<string, number>;
}

const enc = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function fromB64url(text: string): Uint8Array {
  const b64 = text.replaceAll("-", "+").replaceAll("_", "/");
  return Uint8Array.from(
    atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)),
    (c) => c.charCodeAt(0),
  );
}

function hexBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (h) => parseInt(h, 16));
}

function hmacKey(env: Env): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    hexBytes(env.SESSION_KEY),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function sign(
  env: Env,
  purpose: string,
  text: string,
): Promise<string> {
  const body = toB64url(enc.encode(text));
  const sig = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(env),
    enc.encode(`${purpose}.${body}`),
  );
  return `${body}.${toB64url(new Uint8Array(sig))}`;
}

export async function unsign(
  env: Env,
  purpose: string,
  value: string | null,
): Promise<string | null> {
  const [body, sig, extra] = value?.split(".") ?? [];
  if (!body || !sig || extra !== undefined) return null;
  try {
    const key = await hmacKey(env);
    const ok = await crypto.subtle.verify(
      "HMAC",
      key,
      fromB64url(sig),
      enc.encode(`${purpose}.${body}`),
    );
    return ok ? new TextDecoder().decode(fromB64url(body)) : null;
  } catch {
    return null;
  }
}

export function seal(env: Env, session: Session): Promise<string> {
  return sign(env, "session", JSON.stringify(session));
}

export async function openSession(
  env: Env,
  value: string | null,
  now: number,
): Promise<Session | null> {
  const text = await unsign(env, "session", value);
  if (!text) return null;
  const session = JSON.parse(text) as Session;
  return session.exp > now ? session : null;
}

export function cookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("Cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}
