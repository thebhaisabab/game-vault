import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "**.steamstatic.com" },
      { protocol: "https", hostname: "steamcdn-a.akamaihd.net" },
    ],
  },
};

export default nextConfig;
