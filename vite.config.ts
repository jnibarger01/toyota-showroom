import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  // Pages is mounted under the repository prefix; the Worker is served at the origin root.
  // The deployment workflow sets VITE_BASE=/ for the Worker build.
  base: process.env.VITE_BASE ?? "/toyota-showroom/",
  plugins: [
    vinext(),
    cloudflare({
      viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
    }),
  ],
});
