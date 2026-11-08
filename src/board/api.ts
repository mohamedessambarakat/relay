export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

export const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === "AbortError";

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

async function request<T>(method: string, url: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const init: RequestInit = { method, signal };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { "Content-Type": "application/json" };
  }
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (isAbort(e)) throw e;
    throw new ApiError("Can't reach Relay. Is the server running?", 0, "network");
  }
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code = "http";
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } };
      if (data.error?.message) message = data.error.message;
      if (data.error?.code) code = data.error.code;
    } catch {
      // Non-JSON error body: keep the status message.
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T,>(url: string, signal?: AbortSignal) => request<T>("GET", url, undefined, signal),
  post: <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {}),
  postForm: <T,>(url: string, form: FormData) => request<T>("POST", url, form),
  patch: <T,>(url: string, body: unknown) => request<T>("PATCH", url, body),
  put: <T,>(url: string, body: unknown) => request<T>("PUT", url, body),
};
