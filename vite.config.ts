import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig(({ command }) => ({
  // GitHub Pages needs the repository prefix, while vinext dev serves from the origin root.
  base: command === "build" ? "/toyota-showroom/" : "/",
  plugins: [
    vinext(),
    ...(command === "build"
      ? [cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } })]
      : []),
  ],
  build: {
    rolldownOptions: {
      // `instrumentation.ts` dynamically imports "cloudflare:workers" to bind the D1 repository
      // when running in the real Worker, with a try/catch fallback for every other target (Node
      // dev, tests). Rolldown doesn't auto-externalize `cloudflare:`-prefixed specifiers the way it
      // does `node:`-prefixed ones, so without this it refuses to build at all rather than leaving
      // the import for the actual runtime to resolve (or, correctly, fail and be caught).
      external: [/^cloudflare:/],
    },
  },
}));
