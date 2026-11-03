import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { privateRobots } from "@/lib/brand/seo";
import { PatientShell } from "@/components/patient/shell";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { getSystemName } from "@/lib/brand/system-name";
import { requireStoredRoles } from "@/lib/auth/require-role";
import { prisma } from "@/lib/db/prisma";
import { loadInAppNoticeSummary } from "@/lib/notifications/delivery";

export const metadata: Metadata = { robots: privateRobots };
export const dynamic = "force-dynamic";

async function loadPatientChrome(userId: string) {
  try {
    const [account, notices] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: { profileImageUpdatedAt: true, patientProfile: { select: { fullName: true } } },
      }),
      loadInAppNoticeSummary(prisma, userId, "patient"),
    ]);
    return {
      unread: notices.unread,
      name: account?.patientProfile?.fullName ?? "Patient",
      imageVersion: account?.profileImageUpdatedAt?.toISOString() ?? null,
      notices: notices.items,
    };
  } catch {
    return { unread: 0, name: "Patient", imageVersion: null as string | null, notices: [] as Awaited<ReturnType<typeof loadInAppNoticeSummary>>["items"] };
  }
}

const readPatientChrome = unstable_cache(loadPatientChrome, ["patient-chrome"], { revalidate: 30 });

export default async function PatientLayout({ children }: { children: React.ReactNode }) {
  const user = await requireStoredRoles([PATIENT_ROLE_CODE]);
  const [chrome, systemName] = await Promise.all([readPatientChrome(user.id), getSystemName()]);
  const { unread, name, imageVersion, notices } = chrome;
  return (
    <PatientShell userId={user.id} name={name} systemName={systemName} imageVersion={imageVersion} unread={unread} notices={notices}>
      {children}
    </PatientShell>
  );
}
