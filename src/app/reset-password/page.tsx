import type { Metadata } from "next";
import { LoginLayout } from "@/app/login/login-layout";
import { privateRobots } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Choose a new password",
    description: `Set a new ${systemName} password.`,
    robots: privateRobots,
  };
}

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>;
}) {
  const params = await searchParams;
  const token = typeof params.token === "string" ? params.token : "";
  const systemName = await getSystemName();
  return (
    <LoginLayout systemName={systemName}>
      <ResetPasswordForm token={token} />
    </LoginLayout>
  );
}
