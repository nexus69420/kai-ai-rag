import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["postgres", "@qdrant/js-client-rest", "unpdf"],
};

export default nextConfig;
