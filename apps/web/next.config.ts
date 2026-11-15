import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The repository root has its own lockfile (npm without workspaces), so point
  // file tracing at this app to keep builds deterministic on one machine.
  outputFileTracingRoot: __dirname,
  async rewrites() {
    // Optional same-origin API proxy. Set API_PROXY_TARGET (e.g.
    // http://127.0.0.1:4000) and NEXT_PUBLIC_API_SAME_ORIGIN=1 to serve the API
    // under /api on the web origin, which keeps the session cookie first-party
    // in every deployment topology. Unset in the default local setup.
    const target = process.env.API_PROXY_TARGET?.trim();
    if (!target) return [];
    return [{ source: "/api/:path*", destination: `${target.replace(/\/+$/, "")}/:path*` }];
  },
};

export default nextConfig;
