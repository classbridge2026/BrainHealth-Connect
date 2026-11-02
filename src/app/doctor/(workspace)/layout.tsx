import { isPortalAdministrator } from "@/lib/admin/rules";
import { loadDoctorChrome } from "@/lib/doctor/session";
import { DoctorShell } from "@/components/doctor/shell";
import { getSystemName } from "@/lib/brand/system-name";

export const dynamic = "force-dynamic";

export default async function DoctorWorkspaceLayout({ children }: { children: React.ReactNode }) {
  const [chrome, systemName] = await Promise.all([loadDoctorChrome(), getSystemName()]);
  return (
    <DoctorShell userId={chrome.user.id} name={chrome.name} systemName={systemName} specialty={chrome.specialty} imageVersion={chrome.imageVersion} unread={chrome.unread} notices={chrome.notices} administration={isPortalAdministrator(chrome.user.roleCodes)}>
      {children}
    </DoctorShell>
  );
}
