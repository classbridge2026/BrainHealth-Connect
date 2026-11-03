import type { Metadata } from "next";
import { privateRobots } from "@/lib/brand/seo";
import { LoginLayout } from "@/app/login/login-layout";
import { getSystemName } from "@/lib/brand/system-name";
import { prisma } from "@/lib/db/prisma";
import { formatWhen } from "@/lib/doctors/invitation-email";
import { inspectDoctorInvitation } from "@/lib/doctors/invitations";
import { AcceptInvitationForm } from "./accept-form";

export const metadata: Metadata = { title: "Doctor invitation", robots: privateRobots };
export const dynamic = "force-dynamic";

export default async function DoctorInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? "";
  let inspection: Awaited<ReturnType<typeof inspectDoctorInvitation>> = {
    ok: false,
    message: "Open the invitation link from your email.",
  };
  if (token) {
    try {
      inspection = await inspectDoctorInvitation(prisma, token, new Date());
    } catch {
      inspection = {
        ok: false,
        message: "Invitations are not available until the doctor onboarding migration has been applied.",
      };
    }
  }

  const systemName = await getSystemName();
  return (
    <LoginLayout systemName={systemName}>
      {inspection.ok ? (
        <div className="flex flex-col gap-5">
          <p className="text-sm leading-6 text-brand-muted">
            {inspection.doctorName}, this invitation expires at {formatWhen(inspection.expiresAt)}. You will not be able to see patients until verification is complete.
          </p>
          <AcceptInvitationForm token={token} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <h1 className="text-[1.75rem] font-semibold tracking-tight text-brand-navy">Invitation unavailable</h1>
          <p role="alert" className="text-base leading-6 text-brand-ink">
            {inspection.message}
          </p>
        </div>
      )}
    </LoginLayout>
  );
}
