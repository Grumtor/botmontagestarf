import type { NextConfig } from "next";

// Local-only setup: backend runs on localhost:8000 in another terminal.
// Override with env BACKEND_URL=... if you ever proxy through a tunnel.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:8000";

const nextConfig: NextConfig = {
  experimental: {
    // Default proxy body limit is 10MB; user uploads (iPhone .MP4 / .MOV)
    // routinely exceed that. Aligned with backend UPLOAD_MAX_BYTES (500MB).
    // Engaged via middleware.ts which matches /api/* — see Next.js docs:
    // https://nextjs.org/docs/15/app/api-reference/config/next-config-js/middlewareClientMaxBodySize
    middlewareClientMaxBodySize: "500mb",
  },
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
