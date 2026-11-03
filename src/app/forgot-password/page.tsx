import type { Metadata } from "next";
import { LoginLayout } from "@/app/login/login-layout";
import { privateRobots } from "@/lib/brand/seo";
import { getSystemName } from "@/lib/brand/system-name";
import { ForgotPasswordForm } from "./forgot-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Reset your password",
    description: `Request a ${systemName} password reset.`,
    robots: privateRobots,
  };
}

export default async function ForgotPasswordPage() {
  const systemName = await getSystemName();
  return (
    <LoginLayout systemName={systemName}>
      <ForgotPasswordForm />
    </LoginLayout>
  );
}
