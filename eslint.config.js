import nextConfig from "eslint-config-next";

/**
 * Flat config (ESLint 9+). `eslint-config-next` 16.x ships its own flat config array natively —
 * no `FlatCompat` shim needed, unlike older Next major versions.
 */
export default [
  ...nextConfig,
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      "public/catalog/**",
      "public/models/**",
      "public/draco/**",
      "public/renders/**",
      "db/migrations/**",
      "next-env.d.ts",
      "*.config.js",
      "*.config.mjs",
      "*.config.ts",
    ],
  },
];
