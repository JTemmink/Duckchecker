import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    // Vercel build laten slagen zelfs met ESLint waarschuwingen
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
