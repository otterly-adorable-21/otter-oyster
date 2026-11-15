/** @type {import('next').NextConfig} */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const nextConfig = {
  webpack(config) {
    config.resolve.alias['@'] = path.join(here, 'src');
    return config;
  },
  output: 'standalone',
  serverExternalPackages: ['sharp'],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: '40mb' } },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ],
    }];
  },
};
export default nextConfig;
