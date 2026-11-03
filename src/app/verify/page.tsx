import type { Metadata } from "next";
import Link from "next/link";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { privateRobots } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { ResendForm } from "./resend-form";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Verify your account",
    description: `Verify a ${systemName} patient account.`,
    robots: privateRobots,
  };
}

export default async function VerifyPage() {
  const systemName = await getSystemName();
  return (
    <AuthShell systemName={systemName}>
      <AuthCard>
        <div className="flex flex-col gap-5">
          <div>
            <h1 className="text-[1.75rem] font-semibold leading-tight tracking-tight text-care-ink sm:text-3xl">
              Verification still needed
            </h1>
            <p className="mt-2 text-base leading-6 text-care-muted">
              Use the email sent to the address on the account. Signing in stays closed until that email is verified.
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/verify/email" className="inline-flex h-12 items-center justify-center rounded-lg bg-care-teal px-4 text-sm font-semibold text-white">
              Email code
            </Link>
          </div>
          <ResendForm />
        </div>
      </AuthCard>
    </AuthShell>
  );
}
