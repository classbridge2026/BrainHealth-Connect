import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { unreadCareChats } from "@/lib/care-chat/service";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const side = new URL(request.url).searchParams.get("side");
  if (side !== "patient" && side !== "doctor") {
    return NextResponse.json({ message: "That conversation is not available." }, { status: 400, headers: noStore });
  }
  const cookieStore = await cookies();
  const session = await readApiSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (session.offline) return NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore });
  const user = session.user;
  if (!user || user.status !== "ACTIVE") return NextResponse.json({ message: "Sign in to continue." }, { status: 401, headers: noStore });
  const allowed = side === "patient" ? user.roleCodes.includes(PATIENT_ROLE_CODE) : DOCTOR_PORTAL_ROLES.some((code) => user.roleCodes.includes(code));
  if (!allowed) return NextResponse.json({ message: "Sign in to continue." }, { status: 403, headers: noStore });
  try {
    const unread = await unreadCareChats(prisma, user.id, side);
    return NextResponse.json(unread, { headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore });
    throw error;
  }
}
