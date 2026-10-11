import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Unit tests cover the lib code only; screens are checked in the browser.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts"], environment: "node" },
});
