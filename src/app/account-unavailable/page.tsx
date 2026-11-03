import type { Metadata } from "next";
import Link from "next/link";
import { privateRobots } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Account unavailable",
    description: `This ${systemName} account cannot open the patient dashboard.`,
    robots: privateRobots,
  };
}

export default async function AccountUnavailablePage() {
  const systemName = await getSystemName();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 bg-care-paper px-4 py-10 sm:px-8">
      <h1 className="text-3xl font-semibold tracking-tight text-care-ink">Account unavailable</h1>
      <p className="text-lg leading-8 text-care-muted">
        This account is suspended, disabled, or not allowed to open the patient dashboard. Direct links do not bypass that check.
      </p>
      <Link href="/" className="text-sm font-medium text-care-teal underline">
        Back to {systemName}
      </Link>
    </main>
  );
}
