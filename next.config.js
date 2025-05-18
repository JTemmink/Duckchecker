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
  experimental: {
    forceSwcTransforms: false
  }
}

module.exports = nextConfig 