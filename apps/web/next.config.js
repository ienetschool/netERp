const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // There is an unrelated package-lock.json above the repo (/Users/<user>), which makes
  // Next infer the wrong workspace root and trace the standalone bundle from there.
  // Pin it to this monorepo so `output: 'standalone'` ships the right files.
  outputFileTracingRoot: path.join(__dirname, '..', '..'),
  async rewrites() {
    // Proxy API calls in development so the browser talks to a single origin.
    const api = process.env.API_URL ?? 'http://localhost:4000';
    // The API's admin controller has no `admin` prefix (serves /api/v1/users,
    // /api/v1/companies, ...) while web pages call /admin/* — strip it here.
    // The specific rule must come first or the generic rule swallows the path.
    return [
      { source: '/api/v1/admin/:path*', destination: `${api}/api/v1/:path*` },
      { source: '/api/v1/:path*', destination: `${api}/api/v1/:path*` },
    ];
  },
};

module.exports = nextConfig;
