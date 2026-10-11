import type { NextConfig } from 'next';

const config: NextConfig = {
  // pg uses native Node APIs; keep it out of the server bundle.
  serverExternalPackages: ['pg'],
  poweredByHeader: false,
  // The evaluation page reads the question set at request time.
  outputFileTracingIncludes: { '/evaluation': ['./evaluation/evaluation.csv'] },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};

export default config;
