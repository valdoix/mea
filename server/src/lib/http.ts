import type { Context } from "hono";
import { z } from "zod";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = "Not found") => new HttpError(404, what);
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, details);

/** Parses and validates a JSON body (ARCH-05). */
export async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  const result = schema.safeParse(raw);
  if (!result.success) throw badRequest("Invalid request", z.treeifyError(result.error));
  return result.data;
}

export function must<T>(value: T | undefined | null, what = "Not found"): T {
  if (value == null) throw notFound(what);
  return value;
}
