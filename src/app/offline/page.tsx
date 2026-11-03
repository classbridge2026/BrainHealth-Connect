import type { Metadata } from "next";
import { privateRobots } from "@/lib/brand/seo";
import { RECORDS_OFFLINE_MESSAGE } from "@/lib/db/offline";
import { safeReturnPath } from "@/lib/db/return-path";
import { TryAgain } from "@/components/return-path";

export const metadata: Metadata = { title: "Records unavailable", robots: privateRobots };
export const dynamic = "force-dynamic";

export default async function OfflinePage({ searchParams }: { searchParams: Promise<{ from?: string }> }) {
  const query = await searchParams;
  const back = safeReturnPath(query.from);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-4 px-6 py-16">
      <p className="text-sm font-semibold tracking-wide text-[#0F766E] uppercase">Care records</p>
      <h1 className="text-3xl font-semibold tracking-tight text-[#0C2B45]">We can&apos;t load records right now</h1>
      <p role="alert" className="text-base leading-7 text-[#3a4a60]">
        {RECORDS_OFFLINE_MESSAGE}
      </p>
      <TryAgain href={back} />
    </main>
  );
}
