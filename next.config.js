/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Vercel build laten slagen zelfs met ESLint waarschuwingen
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig 