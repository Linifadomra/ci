import type { Env } from "./types";

const DELETE_BATCH = 1000;

export interface Obj {
  key: string;
  uploaded: number;
}

export async function listAll(env: Env, prefix: string): Promise<Obj[]> {
  const objs: Obj[] = [];
  const options: R2ListOptions = { prefix };
  for (;;) {
    const page = await env.BUCKET.list(options);
    objs.push(
      ...page.objects.map((o) => ({
        key: o.key,
        uploaded: o.uploaded.getTime(),
      })),
    );
    if (!page.truncated) return objs;
    options.cursor = page.cursor;
  }
}

export async function removeKeys(env: Env, keys: string[]): Promise<number> {
  for (let i = 0; i < keys.length; i += DELETE_BATCH)
    await env.BUCKET.delete(keys.slice(i, i + DELETE_BATCH));
  return keys.length;
}
