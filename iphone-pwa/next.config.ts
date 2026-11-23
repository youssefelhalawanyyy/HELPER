import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: 'export',
  images: {
    unoptimized: true,
  },
  outputFileTracingRoot: path.join(__dirname, '..'),
};

export default nextConfig;
