import type { NextConfig } from "next";
import { portalNoStoreHeaders, securityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  images: {
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
      bodySizeLimit: "12mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders.map((header) => ({ ...header })) },
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
