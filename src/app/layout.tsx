import type { Metadata, Viewport } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { ButtonBusy } from "@/components/button-busy";
import { InstallRegistrar } from "@/components/install-registrar";
import { RememberPath } from "@/components/return-path";
import { metadataBase } from "@/lib/brand/metadata-base";
import { publicDescription } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { installShortName } from "@/lib/install/prompt";
import "./globals.css";

export const viewport: Viewport = {
  themeColor: "#0C2B45",
};

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  const description = publicDescription(systemName);
  const google = process.env.GOOGLE_SITE_VERIFICATION?.trim();
  return {
    metadataBase: metadataBase(),
    applicationName: systemName,
    title: {
      default: systemName,
      template: `%s · ${systemName}`,
    },
    description,
    appleWebApp: {
      capable: true,
      title: installShortName(systemName),
      statusBarStyle: "default",
    },
    openGraph: {
      type: "website",
      siteName: systemName,
      title: systemName,
      description,
      locale: "en_SL",
    },
    twitter: {
      card: "summary_large_image",
    },
    verification: google ? { google } : undefined,
  };
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <ButtonBusy />
        <InstallRegistrar />
        <RememberPath />
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
