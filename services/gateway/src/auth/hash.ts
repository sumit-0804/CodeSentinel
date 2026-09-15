import { createHash } from "node:crypto";

/** Hex SHA-256, used for `sessions.token_hash` and `api_keys.key_hash`. Credentials are stored only as hashes. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
