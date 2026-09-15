import { once } from "node:events";
import type { AddressInfo } from "node:net";

import type { Express } from "express";

/**
 * Runs `fn` against the real app on an ephemeral port, then closes every connection.
 * Tests call it with global `fetch`; nothing listens on a fixed port.
 */
export async function withServer(app: Express, fn: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
