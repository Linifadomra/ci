import { HttpError } from "./http";
import type { Env, Fetch } from "./types";

const STALE_MS = 6 * 3600 * 1000;

interface CapState {
  paused: boolean;
  cost: number;
  checkedAt: number;
}

export async function assertOpen(env: Env, now: number): Promise<void> {
  const state = await env.STATE.get<CapState>("cap", "json");
  if (!state || now - state.checkedAt > STALE_MS) {
    throw new HttpError(
      503,
      "R2 spend check is stale; uploads paused until it succeeds",
    );
  }
  if (state.paused) {
    throw new HttpError(
      503,
      `R2 spend cap reached ($${state.cost.toFixed(2)} this month); uploads paused`,
    );
  }
}

const CLASS_B = new Set([
  "HeadBucket",
  "HeadObject",
  "GetObject",
  "UsageSummary",
  "GetBucketEncryption",
  "GetBucketLocation",
  "GetBucketCors",
  "GetBucketLifecycleConfiguration",
]);
const FREE = new Set(["DeleteObject", "DeleteBucket", "AbortMultipartUpload"]);

interface Usage {
  storageGB: number;
  classA: number;
  classB: number;
}

interface StorageRow {
  max: { payloadSize: number; metadataSize: number };
  dimensions: { date: string; bucketName: string };
}

interface OpsRow {
  sum: { requests: number };
  dimensions: { actionType: string };
}

export function cost(u: Usage): number {
  const storage = Math.max(0, u.storageGB - 10) * 0.015;
  const classA = (Math.max(0, u.classA - 1_000_000) / 1_000_000) * 4.5;
  const classB = (Math.max(0, u.classB - 10_000_000) / 1_000_000) * 0.36;
  return storage + classA + classB;
}

export function summarize(storage: StorageRow[], ops: OpsRow[]): Usage {
  const daily = new Map<string, number>();
  for (const row of storage) {
    const bytes = row.max.payloadSize + row.max.metadataSize;
    daily.set(
      row.dimensions.date,
      (daily.get(row.dimensions.date) ?? 0) + bytes,
    );
  }
  const days = [...daily.values()];
  const storageGB = days.length
    ? days.reduce((a, b) => a + b, 0) / days.length / 1e9
    : 0;
  let classA = 0;
  let classB = 0;
  for (const row of ops) {
    const type = row.dimensions.actionType;
    if (FREE.has(type)) continue;
    if (CLASS_B.has(type)) classB += row.sum.requests;
    else classA += row.sum.requests;
  }
  return { storageGB, classA, classB };
}

const QUERY = `query ($acct: string!, $start: Date!, $end: Date!) {
  viewer { accounts(filter: { accountTag: $acct }) {
    storage: r2StorageAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
      max { payloadSize metadataSize } dimensions { date bucketName } }
    ops: r2OperationsAdaptiveGroups(limit: 10000, filter: { date_geq: $start, date_leq: $end }) {
      sum { requests } dimensions { actionType } } } } }`;

interface AnalyticsBody {
  errors?: unknown[];
  data?: { viewer: { accounts: { storage: StorageRow[]; ops: OpsRow[] }[] } };
}

async function fetchUsage(
  env: Env,
  now: number,
  f: Fetch = fetch,
): Promise<Usage> {
  const today = new Date(now).toISOString().slice(0, 10);
  const res = await f("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.CF_ANALYTICS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: QUERY,
      variables: {
        acct: env.ACCOUNT_ID,
        start: `${today.slice(0, 8)}01`,
        end: today,
      },
    }),
  });
  if (!res.ok) throw new Error(`analytics query failed: ${res.status}`);
  const body = await res.json<AnalyticsBody>();
  const account = body.data?.viewer.accounts[0];
  if (body.errors?.length || !account) {
    throw new Error(`analytics query failed: ${JSON.stringify(body.errors)}`);
  }
  return summarize(account.storage, account.ops);
}

export async function checkCap(
  env: Env,
  now: number,
  f: Fetch = fetch,
): Promise<CapState> {
  const spent = cost(await fetchUsage(env, now, f));
  const state = {
    paused: spent >= Number(env.CAP_USD),
    cost: spent,
    checkedAt: now,
  };
  await env.STATE.put("cap", JSON.stringify(state));
  return state;
}
