import type { Metadata } from "next";
import Link from "next/link";
import { CareCircleMark } from "@/components/brand";
import { PRIVACY_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { getSystemName } from "@/lib/brand/system-name";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Privacy Notice",
    description: `Privacy notice for a ${systemName} account.`,
    alternates: { canonical: "/privacy" },
  };
}

export default async function PrivacyPage() {
  const systemName = await getSystemName();
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 bg-care-paper px-4 py-10 text-care-ink sm:px-8">
      <Link href="/" className="flex w-fit items-center gap-2 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-care-teal">
        <CareCircleMark className="h-9 w-9" />
        <span className="text-sm font-medium tracking-[0.16em] text-care-teal uppercase">{systemName}</span>
      </Link>
      <h1 className="text-3xl font-semibold tracking-tight">Privacy Notice</h1>
      <p className="text-sm text-care-muted">Version {PRIVACY_DOCUMENT_VERSION}</p>
      <p className="leading-7">
        {systemName} uses the name, contact details, and address you submit to create a patient account, verify a contact method, and keep a record of the terms and privacy notice you accepted.
      </p>
      <p className="leading-7">
        Passwords are stored as hashes. Verification codes are stored as hashes. This notice is not consent for treatment, research, or marketing.
      </p>
      <Link href="/register" className="text-sm font-medium text-care-teal underline">
        Back to registration
      </Link>
    </main>
  );
}
