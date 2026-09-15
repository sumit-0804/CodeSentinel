import { parse } from "cookie";

/** Reads one cookie from a `Cookie` header. Returns `undefined` when it is absent or empty. */
export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  return parse(cookieHeader)[name] || undefined;
}
