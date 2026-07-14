import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep native/node packages unbundled — pdfkit needs its AFM fonts from node_modules.
  serverExternalPackages: ['playwright', 'pdfkit', 'fontkit'],
  // Playwright + screencast can push the default Next.js memory budget.
  experimental: {
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
