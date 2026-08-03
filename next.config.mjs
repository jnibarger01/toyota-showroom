const repo = "toyota-showroom";

/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  assetPrefix: `/${repo}`,
};

export default nextConfig;
