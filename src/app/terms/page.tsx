import type { Metadata } from "next";
import Link from "next/link";
import { CareCircleMark } from "@/components/brand";
import { TERMS_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { getSystemName } from "@/lib/brand/system-name";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Terms of Service",
    description: `Terms for a ${systemName} account.`,
    alternates: { canonical: "/terms" },
  };
}

export default async function TermsPage() {
  const systemName = await getSystemName();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 bg-care-paper px-4 py-10 text-care-ink sm:px-8">
      <Link href="/" className="flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-care-teal">
        <CareCircleMark className="h-9 w-9" />
        <span className="text-sm font-medium tracking-[0.16em] text-care-teal uppercase">{systemName}</span>
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Terms of Service</h1>
      <p className="text-sm text-care-muted">Version {TERMS_DOCUMENT_VERSION}</p>
      <p className="leading-7">
        These terms cover creating and using a {systemName} account. Accepting them does not authorize medical treatment, and it does not opt you in to marketing.
      </p>
      <p className="leading-7">
        You must provide accurate account details and keep your password private. {systemName} can suspend or disable an account that is misused. Clinical services are not available from this registration step.
      </p>
      <Link href="/register" className="text-sm font-medium text-care-teal underline">
        Back to registration
      </Link>
    </main>
  );
}
