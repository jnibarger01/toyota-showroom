import { defineConfig } from "vitest/config";

/**
 * Standalone config: the app's `vite.config.ts` loads the vinext and Cloudflare plugins, which
 * expect a worker environment the unit tests neither have nor need. Tests run in plain Node
 * against the library modules, which is why none of them import React or a renderer.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
