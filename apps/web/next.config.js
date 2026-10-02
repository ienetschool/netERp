/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
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
