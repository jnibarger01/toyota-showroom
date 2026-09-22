import { defineConfig } from "vitest/config";

/**
 * Standalone config: the app's `vite.config.ts` loads the vinext and Cloudflare plugins, which
 * expect a worker environment the unit tests neither have nor need. Tests run in plain Node
 * against the library modules, which is why most of them import no React or renderer.
 *
 * `.test.tsx` files are the exception — real component tests (`tests/components/*`) need a DOM.
 * Vitest projects keep those tests in jsdom while the larger plain-Node suite stays in Node.
 *
 * No `@vitejs/plugin-react` here: Vitest's own module runner transforms `.tsx` via esbuild
 * directly, ahead of any Vite plugin pipeline, so the `esbuild.jsx` option below is what actually
 * governs the JSX transform for component tests — adding the plugin on top achieved nothing at
 * runtime and only introduced a spurious `tsc` error, since its `Plugin` type resolves against
 * this repo's root `vite` (rolldown-vite 8.x) while `vitest/config`'s `PluginOption` resolves
 * against Vitest's own bundled, older, plain `vite` (7.x) — two structurally incompatible
 * `Plugin` types for the same runtime behavior.
 */
export default defineConfig({
  // Component tests failed with "React is not defined" before this was set: esbuild's default
  // JSX transform is classic (`React.createElement`, no auto-import) unless told otherwise.
  esbuild: { jsx: "automatic", jsxImportSource: "react" },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          environmentOptions: {
            jsdom: {
              url: "http://localhost/",
            },
          },
          setupFiles: ["tests/components/setup.ts"],
          include: ["tests/components/**/*.test.tsx"],
        },
      },
    ],
  },
});
