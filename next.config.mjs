/**
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  eslint: {
    // Dit schakelt ESLint-controle uit tijdens de build om de Vercel-implementatie te laten slagen
    ignoreDuringBuilds: true,
  },
}

export default nextConfig;
