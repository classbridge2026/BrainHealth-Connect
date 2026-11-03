import type { Metadata } from "next";
import { getSystemName } from "@/lib/brand/system-name";
import { LoginForm } from "./login-form";
import { LoginLayout } from "./login-layout";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Login",
    description: `Sign in to ${systemName}.`,
    alternates: { canonical: "/login" },
  };
}

export default async function LoginPage() {
  const systemName = await getSystemName();
  return (
    <LoginLayout systemName={systemName}>
      <LoginForm />
    </LoginLayout>
  );
}
