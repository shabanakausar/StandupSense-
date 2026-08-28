const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silence the "multiple lockfiles" workspace-root warning.
  // Pins the tracing root to this project directory so Next.js doesn't
  // walk up to C:\Users\DELL looking for a monorepo root.
  outputFileTracingRoot: path.join(__dirname),
};
module.exports = nextConfig;
