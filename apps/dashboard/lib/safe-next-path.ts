export const DEFAULT_NEXT_PATH = "/overview";

/** Accepts only same-origin paths like `/repositories?x=1`, so `next` can't become an open redirect. */
export function safeNextPath(value: unknown, fallback = DEFAULT_NEXT_PATH): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048) return fallback;
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  // Browsers drop tabs and newlines inside URLs, which would turn "/\t/evil.example" into "//evil.example".
  if (value.includes("\\") || [...value].some((ch) => ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f)) {
    return fallback;
  }
  try {
    const url = new URL(value, "http://n");
    if (url.origin !== "http://n") return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
