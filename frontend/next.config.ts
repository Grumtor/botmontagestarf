import type { NextConfig } from "next";

// Local-only setup: backend runs on localhost:8000 in another terminal.
// Override with env BACKEND_URL=... if you ever proxy through a tunnel.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
