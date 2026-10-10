import { AwsClient } from "aws4fetch";
import type { Env } from "./types";

export function encodeKey(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

export function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.split("/").every((s) => s !== "" && s !== "." && s !== "..")
  );
}

export function signer(env: Env, ttl = 3600): (key: string) => Promise<string> {
  const aws = new AwsClient({
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    service: "s3",
    region: "auto",
  });
  return (key) => presign(aws, env, key, ttl);
}

async function presign(
  aws: AwsClient,
  env: Env,
  key: string,
  ttl: number,
): Promise<string> {
  const url = new URL(
    `https://${env.ACCOUNT_ID}.r2.cloudflarestorage.com/${env.BUCKET_NAME}/${encodeKey(key)}`,
  );
  url.searchParams.set("X-Amz-Expires", String(ttl));
  const signed = await aws.sign(new Request(url, { method: "PUT" }), {
    aws: { signQuery: true },
  });
  return signed.url;
}
