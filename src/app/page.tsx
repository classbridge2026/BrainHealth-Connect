import type { Metadata } from "next";
import { LandingView } from "@/components/landing/landing-view";
import { homeTitle, publicDescription } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { prisma } from "@/lib/db/prisma";
import { loadPublicLanding } from "@/lib/public/landing";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  const title = homeTitle(systemName);
  const description = publicDescription(systemName);
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description,
      url: "/",
      type: "website",
      siteName: systemName,
      locale: "en_SL",
    },
  };
}

export const revalidate = 300;

export default async function HomePage() {
  const [content, systemName] = await Promise.all([loadPublicLanding(prisma), getSystemName()]);
  return <LandingView content={content} year={new Date().getFullYear()} systemName={systemName} />;
}
