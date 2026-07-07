import type { Context } from 'hono'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'error',
  ) {
    super(message)
  }
}

export function badRequest(message: string, code = 'bad_request'): never {
  throw new HttpError(400, message, code)
}

export function unauthorized(message = 'Unauthorized'): never {
  throw new HttpError(401, message, 'unauthorized')
}

export function forbidden(message = 'Forbidden'): never {
  throw new HttpError(403, message, 'forbidden')
}

export function notFound(message = 'Not found'): never {
  throw new HttpError(404, message, 'not_found')
}

export function conflict(message: string): never {
  throw new HttpError(409, message, 'conflict')
}

export function tooManyRequests(message: string): never {
  throw new HttpError(429, message, 'rate_limited')
}

export function notImplemented(message: string): never {
  throw new HttpError(501, message, 'not_implemented')
}

export function jsonError(c: Context<any>, error: unknown): Response {
  if (error instanceof HttpError) {
    return c.json({ ok: false, error: { code: error.code, message: error.message } }, error.status as never)
  }
  console.error(error)
  return c.json({ ok: false, error: { code: 'internal_error', message: 'Internal server error' } }, 500)
}
