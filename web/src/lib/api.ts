export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let onUnpaired: (() => void) | null = null;
export function setUnpairedHandler(fn: () => void) {
  onUnpaired = fn;
}

async function parse(res: Response) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

export async function api<T = any>(method: string, path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      ...init,
      headers: body !== undefined && !(body instanceof FormData) ? { "Content-Type": "application/json", ...init.headers } : init.headers,
      body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Can't reach Mea. Is the server running?", 0, "offline");
  }
  const data = await parse(res);
  if (!res.ok) {
    if (res.status === 401 && data?.code === "unpaired") onUnpaired?.();
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code, data?.details);
  }
  return data as T;
}

export const get = <T = any>(path: string) => api<T>("GET", path);
export const post = <T = any>(path: string, body?: unknown) => api<T>("POST", path, body ?? {});
export const put = <T = any>(path: string, body?: unknown) => api<T>("PUT", path, body ?? {});
export const patch = <T = any>(path: string, body?: unknown) => api<T>("PATCH", path, body ?? {});
export const del = <T = any>(path: string, body?: unknown) => api<T>("DELETE", path, body);

/** Reads an SSE response from a POST (used for impersonate / expand drafts). */
export async function* postStream<T>(path: string, body: unknown, signal?: AbortSignal): AsyncGenerator<T> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || !res.body) {
    const data = await parse(res);
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      for (const line of block.split("\n")) if (line.startsWith("data:")) yield JSON.parse(line.slice(5).trim()) as T;
    }
  }
}

export function download(path: string) {
  const a = document.createElement("a");
  a.href = path;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** PERF-08: an image at a size: "s" (128 px), "m" (320 px, `true`), "l" (768 px), or the original. */
export const imageUrl = (id: string | null | undefined, size: boolean | "s" | "m" | "l" = false) => {
  if (!id) return "";
  const s = size === true ? "m" : size || null;
  return `/api/images/${id}${s ? `?size=${s}` : ""}`;
};
