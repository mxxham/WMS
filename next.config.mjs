import { fileURLToPath } from "node:url";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Stray lockfiles outside the project (e.g. ~/package-lock.json) made
  // Next.js infer the wrong workspace root. Pin it to this directory.
  outputFileTracingRoot: fileURLToPath(new URL(".", import.meta.url)),
  // bwip-js ships a native-style Node entry; keep it out of the server bundle.
  serverExternalPackages: ["bwip-js"],
};
export default nextConfig;
