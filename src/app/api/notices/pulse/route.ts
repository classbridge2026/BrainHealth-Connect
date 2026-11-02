import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, PATIENT_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { loadNoticePulse } from "@/lib/notifications/delivery";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

const audiences = ["patient", "doctor", "admin"] as const;

type Audience = (typeof audiences)[number];

function allowed(audience: Audience, roleCodes: string[]) {
  if (audience === "doctor") {
    return roleCodes.includes(DOCTOR_ROLE_CODE) || roleCodes.includes(ADMIN_ROLE_CODE) || roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
  }
  if (audience === "patient") return roleCodes.includes(PATIENT_ROLE_CODE);
  return roleCodes.includes(ADMIN_ROLE_CODE) || roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
}

export async function GET(request: Request) {
  const audience = new URL(request.url).searchParams.get("audience");
  if (audience !== "patient" && audience !== "doctor" && audience !== "admin") {
    return NextResponse.json({ error: "That notice check is not available." }, { status: 400, headers: noStore });
  }
  const cookieStore = await cookies();
  const session = await readApiSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (session.offline) return NextResponse.json({ error: "Records are offline." }, { status: 503, headers: noStore });
  if (!session.user || session.user.status !== "ACTIVE") {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  }
  if (!allowed(audience, session.user.roleCodes)) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 403, headers: noStore });
  }
  try {
    const pulse = await loadNoticePulse(prisma, session.user.id, audience);
    return NextResponse.json(pulse, { status: 200, headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ error: "Records are offline." }, { status: 503, headers: noStore });
    throw error;
  }
}
