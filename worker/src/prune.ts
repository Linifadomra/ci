import { listAll, removeKeys, type Obj } from "./bucket";
import { pullRequest } from "./github";
import { projects } from "./projects";
import type { Env, Fetch } from "./types";

const KEEP = 15;
const CLOSED_KEEP_MS = 90 * 86400_000;

interface Manifest {
  apps: { versions: { downloadURL: string }[] }[];
}

export function prNumbers(objs: Obj[]): number[] {
  const numbers = new Set<number>();
  for (const o of objs) {
    const n = prNumber(o.key.split("/")[2] ?? "");
    if (n !== null) numbers.add(n);
  }
  return [...numbers];
}

function prNumber(scope: string): number | null {
  const m = /^pr-(\d+)$/.exec(scope);
  return m ? Number(m[1]) : null;
}

export function pruneDirs(
  objs: Obj[],
  now: number,
  closedAt: Map<number, number | null>,
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
    const pr = prNumber(scope);
    if (pr === null) {
      const newest = dirs.sort((a, b) => b[1] - a[1]);
      doomed.push(...newest.slice(KEEP).map(([d]) => d));
      continue;
    }
    const closed = closedAt.get(pr);
    if (closed != null && closed < now - CLOSED_KEEP_MS) {
      doomed.push(...dirs.map(([d]) => d));
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

async function closedTimes(
  env: Env,
  repo: string,
  objs: Obj[],
  f: Fetch,
): Promise<Map<number, number | null>> {
  const times = new Map<number, number | null>();
  for (const n of prNumbers(objs)) {
    try {
      const pr = await pullRequest(env, repo, n, f);
      if (pr === null) continue;
      times.set(n, pr.closed_at === null ? null : Date.parse(pr.closed_at));
    } catch (e) {
      console.log(`prune: kept pr-${n} of ${repo}: ${String(e)}`);
    }
  }
  return times;
}

export async function runPrune(
  env: Env,
  now: number,
  f: Fetch = fetch,
): Promise<number> {
  let removed = 0;
  for (const p of projects(env)) {
    const objs = await listAll(env, `builds/${p.slug}/`);
    const dirs = pruneDirs(objs, now, await closedTimes(env, p.repo, objs, f));
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
