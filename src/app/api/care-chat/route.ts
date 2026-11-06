import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { PATIENT_ROLE_CODE } from "@/lib/auth/constants";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { parseUuid } from "@/lib/catalog/rules";
import { clearCareChat, deleteCareMessage, readChatSince, sendCareFile, sendCareMessage } from "@/lib/care-chat/service";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { DOCTOR_PORTAL_ROLES } from "@/lib/doctor/session";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };

function sideOf(value: unknown) {
  return value === "patient" || value === "doctor" ? value : null;
}

async function actor(side: "patient" | "doctor") {
  const cookieStore = await cookies();
  const session = await readApiSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (session.offline) return { error: NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore }) };
  const user = session.user;
  if (!user || user.status !== "ACTIVE") return { error: NextResponse.json({ message: "Sign in to continue." }, { status: 401, headers: noStore }) };
  const allowed = side === "patient" ? user.roleCodes.includes(PATIENT_ROLE_CODE) : DOCTOR_PORTAL_ROLES.some((code) => user.roleCodes.includes(code));
  if (!allowed) return { error: NextResponse.json({ message: "Sign in to continue." }, { status: 403, headers: noStore }) };
  return { userId: user.id };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const side = sideOf(url.searchParams.get("side"));
  const partner = parseUuid(url.searchParams.get("partner") ?? "");
  if (!side || !partner) return NextResponse.json({ message: "That conversation is not available." }, { status: 400, headers: noStore });
  const who = await actor(side);
  if ("error" in who) return who.error;
  try {
    const result = await readChatSince(prisma, { actorUserId: who.userId, side, partnerProfileId: partner, after: url.searchParams.get("after") });
    if (!result.ok) return NextResponse.json({ message: "That conversation is not available." }, { status: 403, headers: noStore });
    return NextResponse.json(result, { headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore });
    throw error;
  }
}

export async function DELETE(request: Request) {
  const url = new URL(request.url);
  const side = sideOf(url.searchParams.get("side"));
  const partner = parseUuid(url.searchParams.get("partner") ?? "");
  if (!side || !partner) return NextResponse.json({ message: "That conversation is not available." }, { status: 400, headers: noStore });
  const who = await actor(side);
  if ("error" in who) return who.error;
  const message = url.searchParams.get("message");
  try {
    if (message) {
      const messageId = parseUuid(message);
      if (!messageId) return NextResponse.json({ message: "That message could not be deleted." }, { status: 400, headers: noStore });
      const result = await deleteCareMessage(prisma, { actorUserId: who.userId, side, partnerProfileId: partner, messageId });
      if (!result.ok) return NextResponse.json({ message: result.message }, { status: 403, headers: noStore });
      return NextResponse.json({ ok: true }, { headers: noStore });
    }
    const result = await clearCareChat(prisma, { actorUserId: who.userId, side, partnerProfileId: partner });
    if (!result.ok) return NextResponse.json({ message: result.message }, { status: 403, headers: noStore });
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore });
    throw error;
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ message: "That file could not be read." }, { status: 400, headers: noStore });
    }
    const sideValue = form.get("side");
    const partnerValue = form.get("partner");
    const bodyValue = form.get("body");
    const side = sideOf(sideValue);
    const partner = parseUuid(typeof partnerValue === "string" ? partnerValue : "");
    const body = typeof bodyValue === "string" ? bodyValue : "";
    const file = form.get("file");
    if (!side || !partner || !(file instanceof File)) {
      return NextResponse.json({ message: "That conversation is not available." }, { status: 400, headers: noStore });
    }
    const who = await actor(side);
    if ("error" in who) return who.error;
    try {
      const result = await sendCareFile(prisma, {
        actorUserId: who.userId,
        side,
        partnerProfileId: partner,
        body,
        file: { name: file.name, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) },
      });
      if (!result.ok) return NextResponse.json({ message: result.message }, { status: 400, headers: noStore });
      return NextResponse.json({ conversationId: result.conversationId, line: result.message }, { headers: noStore });
    } catch (error) {
      if (isRecordsOffline(error)) return NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore });
      throw error;
    }
  }
  let payload: { side?: unknown; partner?: unknown; body?: unknown };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ message: "That message could not be read." }, { status: 400, headers: noStore });
  }
  const side = sideOf(payload.side);
  const partner = parseUuid(typeof payload.partner === "string" ? payload.partner : "");
  if (!side || !partner || typeof payload.body !== "string") {
    return NextResponse.json({ message: "That conversation is not available." }, { status: 400, headers: noStore });
  }
  const who = await actor(side);
  if ("error" in who) return who.error;
  try {
    const result = await sendCareMessage(prisma, { actorUserId: who.userId, side, partnerProfileId: partner, body: payload.body });
    if (!result.ok) return NextResponse.json({ message: result.message }, { status: 403, headers: noStore });
    return NextResponse.json({ conversationId: result.conversationId, line: result.message }, { headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ message: "Records are offline." }, { status: 503, headers: noStore });
    throw error;
  }
}
