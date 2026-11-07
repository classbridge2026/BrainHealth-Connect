import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";
import { nextVisitReminder } from "@/lib/doctor/visit-reminder";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  const cookieStore = await cookies();
  const session = await readApiSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (session.offline) return NextResponse.json({ visit: null }, { headers: noStore });
  const user = session.user;
  if (!user || user.status !== "ACTIVE") return NextResponse.json({ message: "Sign in to continue." }, { status: 401, headers: noStore });
  if (!DOCTOR_PORTAL_ROLES.some((code) => user.roleCodes.includes(code))) {
    return NextResponse.json({ visit: null }, { headers: noStore });
  }
  try {
    const visit = await nextVisitReminder(prisma, user.id);
    return NextResponse.json({ visit }, { headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ visit: null }, { headers: noStore });
    throw error;
  }
}
