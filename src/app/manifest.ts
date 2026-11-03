import type { MetadataRoute } from "next";
import { getSystemName } from "@/lib/brand/system-name";
import { installShortName } from "@/lib/install/prompt";

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = await getSystemName();
  return {
    name,
    short_name: installShortName(name),
    description: `${name} is a healthcare platform for appointments and online consultations in Sierra Leone.`,
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0C2B45",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
