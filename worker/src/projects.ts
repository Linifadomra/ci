import type { Env } from "./types";

export interface Project {
  slug: string;
  repo: string;
  altstore: string[];
  deps: string[];
}

export function projects(env: Env): Project[] {
  return JSON.parse(env.PROJECTS) as Project[];
}

export function bySlug(env: Env, slug: string): Project | undefined {
  return projects(env).find((p) => p.slug === slug);
}

export function byRepo(env: Env, repo: string): Project | undefined {
  return projects(env).find((p) => p.repo === repo);
}

export function byChannel(env: Env, channel: string): Project | undefined {
  return projects(env).find((p) => p.altstore.includes(channel));
}
