export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string } }

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (init?.body && !headers.has("content-type") && !(init.body instanceof FormData)) {
    headers.set("content-type", "application/json")
  }
  const response = await fetch(path, { ...init, headers })
  const contentType = response.headers.get("content-type") || ""
  if (!contentType.includes("application/json")) {
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
    return undefined as T
  }
  const payload = (await response.json()) as ApiResult<T>
  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? `${response.status} ${response.statusText}` : payload.error.message)
  }
  return payload.data
}
