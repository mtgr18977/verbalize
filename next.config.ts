import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // These files are used at run time but never imported, so the build would not see them:
  // Vale and its styles, and the Node stand-in for `asciidoctor` that Vale runs for AsciiDoc.
  outputFileTracingIncludes: {
    '/api/lint': ['./vale', './styles/**/*', './scripts/bin/**/*', './node_modules/@asciidoctor/core/**/*'],
  },
};

export default nextConfig;
