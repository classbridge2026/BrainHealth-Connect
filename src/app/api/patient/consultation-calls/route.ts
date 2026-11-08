import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { readSessionUser } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { accessStatus } from "@/lib/consultations/access";
import { listIncomingCalls } from "@/lib/consultations/incoming";
import { prisma } from "@/lib/db/prisma";
import { isRecordsOffline } from "@/lib/db/offline";
import { rememberFor } from "@/lib/db/remember";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

export async function GET() {
  try {
    const cookieStore = await cookies();
    const user = await readSessionUser(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
    if (!user) return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
    const result = await rememberFor(`incoming-calls:${user.id}`, 8_000, () => listIncomingCalls(prisma, {
      actorUserId: user.id,
      actorStatus: user.status,
      roleCodes: user.roleCodes,
    }));
    if (!result.ok) {
      const error = result.code === "RATE_LIMITED" ? "Please wait a moment and try again." : "That consultation could not be found.";
      return NextResponse.json({ error }, { status: accessStatus(result.code), headers: noStore });
    }
    return NextResponse.json({ calls: result.calls }, { status: 200, headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ calls: [] }, { status: 503, headers: noStore });
    throw error;
  }
}
