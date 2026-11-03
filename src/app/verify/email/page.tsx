import type { Metadata } from "next";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { privateRobots } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { VerifyEmailForm } from "./verify-email-form";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Verify email",
    description: `Confirm the email address on a ${systemName} account.`,
    robots: privateRobots,
  };
}

export default async function VerifyEmailPage() {
  const systemName = await getSystemName();
  return (
    <AuthShell systemName={systemName}>
      <AuthCard>
        <VerifyEmailForm systemName={systemName} />
      </AuthCard>
    </AuthShell>
  );
}
