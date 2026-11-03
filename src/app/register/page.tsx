import type { Metadata } from "next";
import { getSystemName } from "@/lib/brand/system-name";
import { RegisterForm } from "./register-form";
import { RegisterLayout } from "./register-layout";

export async function generateMetadata(): Promise<Metadata> {
  const systemName = await getSystemName();
  return {
    title: "Create your account",
    description: `Create a ${systemName} patient account.`,
    alternates: { canonical: "/register" },
  };
}

export default async function RegisterPage() {
  const systemName = await getSystemName();
  return (
    <RegisterLayout systemName={systemName}>
      <RegisterForm systemName={systemName} />
    </RegisterLayout>
  );
}
