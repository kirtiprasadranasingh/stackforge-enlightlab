import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Set at Docker build time when served under a shared LB path, e.g. /stackforge
  basePath: process.env.NEXT_BASE_PATH || "",
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
