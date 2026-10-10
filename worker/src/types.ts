export interface Env {
  BUCKET: R2Bucket;
  STATE: KVNamespace;
  OWNER: string;
  OWNER_ID: string;
  WORKFLOW_REF: string;
  AUDIENCE: string;
  WORKFLOW_PREFIX: string;
  ACCOUNT_ID: string;
  BUCKET_NAME: string;
  CAP_USD: string;
  PROJECTS: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  CF_ANALYTICS_TOKEN: string;
  GH_METADATA_TOKEN: string;
  GH_DEPS_TOKEN: string;
  GH_CLIENT_ID: string;
  GH_CLIENT_SECRET: string;
  SESSION_KEY: string;
}

export type Fetch = typeof fetch;
