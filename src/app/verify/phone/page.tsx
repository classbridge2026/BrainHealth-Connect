import type { Metadata } from "next";
import { AuthCard, AuthShell } from "@/components/auth-shell";
import { privateRobots } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { VerifyPhoneForm } from "./verify-phone-form";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Verify phone",
    description: `Confirm the phone number on a ${systemName} account.`,
    robots: privateRobots,
  };
}

export default async function VerifyPhonePage() {
  const systemName = await getSystemName();
  return (
    <AuthShell systemName={systemName}>
      <AuthCard>
        <VerifyPhoneForm />
      </AuthCard>
    </AuthShell>
  );
}
