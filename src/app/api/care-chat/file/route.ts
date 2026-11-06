import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { parseUuid } from "@/lib/catalog/rules";
import { openChatFile } from "@/lib/care-chat/service";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { createPrivateStorage } from "@/lib/storage/private-storage";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";

export const dynamic = "force-dynamic";

function sideOf(value: string | null) {
  return value === "patient" || value === "doctor" ? value : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const side = sideOf(url.searchParams.get("side"));
  const partner = parseUuid(url.searchParams.get("partner") ?? "");
  const message = parseUuid(url.searchParams.get("message") ?? "");
  if (!side || !partner || !message) return new NextResponse(null, { status: 404 });
  const cookieStore = await cookies();
  const session = await readApiSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (session.offline) return new NextResponse(null, { status: 503 });
  const user = session.user;
  if (!user || user.status !== "ACTIVE") return new NextResponse(null, { status: 401 });
  const allowed = side === "patient" ? user.roleCodes.includes(PATIENT_ROLE_CODE) : DOCTOR_PORTAL_ROLES.some((code) => user.roleCodes.includes(code));
  if (!allowed) return new NextResponse(null, { status: 403 });
  try {
    const file = await openChatFile(prisma, { actorUserId: user.id, side, partnerProfileId: partner, messageId: message }, createPrivateStorage());
    if (!file) return new NextResponse(null, { status: 404 });
    const download = url.searchParams.get("download") === "1";
    const inline = !download && (
      file.mime.startsWith("image/")
      || file.mime.startsWith("video/")
      || file.mime.startsWith("audio/")
      || file.mime === "application/pdf"
      || file.mime === "text/plain"
      || file.mime === "application/msword"
      || file.mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    const name = file.name.replace(/["\r\n]/g, "");
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isRecordsOffline(error)) return new NextResponse(null, { status: 503 });
    throw error;
  }
}
