import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Coolify runs the traced server from the Docker image, not a full node_modules tree.
  output: "standalone",
  // Workers are started by path at runtime, so trace both storage-version implementations.
  outputFileTracingIncludes: {
    "/api/creation-jobs/*": ["./src/lib/creation-worker*.cjs"],
  },
  // Every page depends on the session and SQLite, so there is no static shell to prerender.
  cacheComponents: false,
  serverExternalPackages: ["better-sqlite3"],
  experimental: {
    serverActions: {
      bodySizeLimit: "200mb",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
