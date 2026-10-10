import { listAll, removeKeys, type Obj } from "./bucket";
import { defaultBranch } from "./github";
import { scopeName } from "./oidc";
import { projects } from "./projects";
import type { Env, Fetch } from "./types";

const KEEP = 15;
const STALE_MS = 14 * 86400_000;

interface Manifest {
  apps: { versions: { downloadURL: string }[] }[];
}

export function pruneDirs(
  objs: Obj[],
  defaultScope: string,
  now: number,
): string[] {
  const newest = new Map<string, { scope: string; time: number }>();
  for (const o of objs) {
    const parts = o.key.split("/");
    const scope = parts[2];
    if (scope === undefined || parts.length < 5) continue;
    const dir = parts.slice(0, 4).join("/") + "/";
    newest.set(dir, {
      scope,
      time: Math.max(newest.get(dir)?.time ?? 0, o.uploaded),
    });
  }
  const byScope = new Map<string, [string, number][]>();
  for (const [dir, { scope, time }] of newest) {
    byScope.set(scope, [...(byScope.get(scope) ?? []), [dir, time]]);
  }
  const doomed: string[] = [];
  for (const [scope, dirs] of byScope) {
    if (scope === defaultScope) {
      const newest = dirs.sort((a, b) => b[1] - a[1]);
      doomed.push(...newest.slice(KEEP).map(([d]) => d));
    } else {
      doomed.push(
        ...dirs.filter(([, t]) => t < now - STALE_MS).map(([d]) => d),
      );
    }
  }
  return doomed;
}

export function orphanIpas(
  objs: Obj[],
  manifest: Manifest,
  channel: string,
): string[] {
  const listed = new Set(
    manifest.apps.flatMap((a) =>
      a.versions.map((v) => v.downloadURL.split("/").pop()),
    ),
  );
  return objs
    .filter(
      (o) =>
        o.key.startsWith(`altstore/${channel}/ci/`) &&
        !listed.has(o.key.split("/").pop()),
    )
    .map((o) => o.key);
}

export async function runPrune(
  env: Env,
  now: number,
  f: Fetch = fetch,
): Promise<number> {
  let removed = 0;
  for (const p of projects(env)) {
    const objs = await listAll(env, `builds/${p.slug}/`);
    const dirs = pruneDirs(
      objs,
      scopeName(await defaultBranch(env, p.repo, f)),
      now,
    );
    const stale = objs
      .filter((o) => dirs.some((d) => o.key.startsWith(d)))
      .map((o) => o.key);
    removed += await removeKeys(env, stale);
    for (const channel of p.altstore) {
      const manifest = await env.BUCKET.get(`altstore/${channel}/apps.json`);
      if (!manifest) continue;
      const ipas = await listAll(env, `altstore/${channel}/ci/`);
      removed += await removeKeys(
        env,
        orphanIpas(ipas, await manifest.json<Manifest>(), channel),
      );
    }
  }
  return removed;
}
