/** Runs a dependency check for `/healthz`: "ok" if `probe` resolves within `timeoutMs`, else "unavailable". */
export async function checkDependency(probe: () => Promise<unknown>, timeoutMs = 2000): Promise<"ok" | "unavailable"> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`health check timed out after ${timeoutMs} ms`)), timeoutMs);
  });
  try {
    await Promise.race([probe(), timeout]);
    return "ok";
  } catch {
    return "unavailable";
  } finally {
    clearTimeout(timer);
  }
}
