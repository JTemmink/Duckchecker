/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // ESLint controles overslaan tijdens het bouwen
    ignoreDuringBuilds: true,
  },
  typescript: {
    // TypeScript controles overslaan tijdens het bouwen
    ignoreBuildErrors: true,
  },
  // Vercel build optimalisaties uitschakelen voor beter resultaat
  experimental: {
    forceSwcTransforms: true,
  }
}

module.exports = nextConfig 