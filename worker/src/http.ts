export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function errorResponse(e: unknown): Response {
  if (e instanceof HttpError) {
    return new Response(`${e.message}\n`, { status: e.status });
  }
  throw e;
}
