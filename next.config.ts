import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next 16 defaults to cacheComponents: true, which changes data-fetching
  // semantics (dynamic reads must sit under Suspense or `use cache`). FINN is
  // a DB-backed, mostly dynamic prototype — keep the classic model.
  cacheComponents: false,
  reactStrictMode: true,
  // `output` is intentionally left at the default (Vercel serverless). Switch
  // to "standalone" only for self-hosted Docker deploys.
  // Native/Node-only packages must stay external to the server bundle.
  serverExternalPackages: [
    "@libsql/client",
    "libsql",
    "postgres",
    "pino",
    "unpdf",
    "web-push",
  ],
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
