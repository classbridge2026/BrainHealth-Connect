import type { NextConfig } from "next";
import { portalNoStoreHeaders, securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  // GitHub Actions already runs `npm run typecheck`. On Vercel this pass took 38s
  // of a 2-core build, so the deploy does not typecheck a second time.
  typescript: {
    ignoreBuildErrors: process.env.VERCEL === "1",
  },
  // The Prisma CLI and its engine downloads are build tools. The running app
  // uses the generated client under node_modules/.prisma/client.
  outputFileTracingExcludes: {
    "*": [
      "node_modules/.prisma/client/query_engine-*.tmp*",
      "node_modules/@prisma/engines/**/*",
      "node_modules/prisma/query_engine-*",
      "node_modules/prisma/schema-engine-*",
      "node_modules/prisma/libquery_engine-*",
      "node_modules/typescript/**/*",
      "node_modules/eslint/**/*",
      "node_modules/eslint-config-next/**/*",
      "node_modules/vitest/**/*",
      "node_modules/happy-dom/**/*",
      "node_modules/@testing-library/**/*",
    ],
  },
  images: {
    qualities: [55, 60, 75],
    minimumCacheTTL: 60 * 60 * 24,
    localPatterns: [
      { pathname: "/hero-consultation.jpg" },
      { pathname: "/carecircle-logo.png" },
      { pathname: "/profile-image/**" },
    ],
  },
  serverExternalPackages: ["nodemailer", "livekit-server-sdk"],
  experimental: {
    serverActions: {
      bodySizeLimit: "16mb",
    },
    proxyClientMaxBodySize: "16mb",
    // A page the user already opened is shown again immediately. Dynamic
    // routes otherwise refetch on every click and sit on the loading spinner.
    staleTimes: {
      dynamic: 30,
      static: 300,
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders.map((header) => ({ ...header })) },
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }] },
      { source: "/carecircle-logo.png", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/hero-consultation.jpg", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/icons/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=86400" }] },
      { source: "/patient/:path*", headers: portalNoStoreHeaders.map((header) => ({ ...header })) },
      { source: "/doctor/:path*", headers: portalNoStoreHeaders.map((header) => ({ ...header })) },
      { source: "/admin/:path*", headers: portalNoStoreHeaders.map((header) => ({ ...header })) },
      {
        source: "/patient/summaries/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/doctor/appointments/:path*/record",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
      {
        source: "/api/clinical-files/:path*",
        headers: [{ key: "Cache-Control", value: "private, no-store" }],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
