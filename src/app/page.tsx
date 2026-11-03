import type { Metadata } from "next";
import { LandingView } from "@/components/landing/landing-view";
import { getSystemName } from "@/lib/brand/system-name";
import { prisma } from "@/lib/db/prisma";
import { loadPublicLanding } from "@/lib/public/landing";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  const title = `${systemName} | Healthcare That Puts You First`;
  const description = `Connect with healthcare professionals on ${systemName}. The platform is launching with mental health in Sierra Leone and is built to add further specialties.`;
  return {
    title: { absolute: title },
    description,
    openGraph: {
      title,
      description,
      type: "website",
      siteName: systemName,
      locale: "en",
      images: [
        {
          url: "/hero-consultation.jpg",
          alt: "A physician listens to a patient during a clinic consultation.",
        },
      ],
    },
  };
}

export const revalidate = 300;

export default async function HomePage() {
  const [content, systemName] = await Promise.all([loadPublicLanding(prisma), getSystemName()]);
  return <LandingView content={content} year={new Date().getFullYear()} systemName={systemName} />;
}
