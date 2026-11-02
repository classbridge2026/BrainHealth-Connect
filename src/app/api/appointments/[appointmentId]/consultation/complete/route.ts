import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { ADMIN_ROLE_CODE, DOCTOR_ROLE_CODE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { sharedRateLimiter } from "@/lib/auth/rate-limit";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { advanceDoctorAppointment } from "@/lib/appointments/booking";
import { parseUuid } from "@/lib/catalog/rules";
import { requestOriginAllowed } from "@/lib/consultations/eligibility";
import { applyConsultationSideEffects } from "@/lib/consultations/lifecycle";
import { notifyConsultationEvent } from "@/lib/consultations/notices";
import { blockIfUnapproved } from "@/lib/doctor/session";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store" };
const transitionLimit = sharedRateLimiter("consultation-transition", { limit: 20, windowMs: 60_000 });

export async function POST(request: Request, context: { params: Promise<{ appointmentId: string }> }) {
  if (!requestOriginAllowed(request.url, request.headers.get("origin"))) {
    return NextResponse.json({ error: "This request was not accepted." }, { status: 403, headers: noStore });
  }
  const cookieStore = await cookies();
  const session = await readApiSession(prisma, cookieStore.get(SESSION_COOKIE)?.value, new Date());
  if (session.offline) return NextResponse.json({ error: "Records are offline." }, { status: 503, headers: noStore });
  const user = session.user;
  const clinic =
    !!user &&
    (user.roleCodes.includes(DOCTOR_ROLE_CODE) || user.roleCodes.includes(ADMIN_ROLE_CODE) || user.roleCodes.includes(SUPER_ADMIN_ROLE_CODE));
  if (!user || user.status !== "ACTIVE" || !clinic) {
    return NextResponse.json({ error: "Sign in to continue." }, { status: 401, headers: noStore });
  }
  if (!transitionLimit.check(user.id).allowed) {
    return NextResponse.json({ error: "Please wait a moment and try again." }, { status: 429, headers: noStore });
  }
  const blocked = await blockIfUnapproved(user.id, user.roleCodes);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 403, headers: noStore });
  const { appointmentId } = await context.params;
  if (!parseUuid(appointmentId)) {
    return NextResponse.json({ error: "That consultation could not be found." }, { status: 404, headers: noStore });
  }
  try {
    const current = await prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: { status: true, doctor: { select: { userId: true } } },
    });
    const assigned = current?.doctor.userId === user.id;
    const administrator = user.roleCodes.includes(ADMIN_ROLE_CODE) || user.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
    if (!current || (!assigned && !administrator)) {
      return NextResponse.json({ error: "That consultation could not be found." }, { status: 404, headers: noStore });
    }
    if (current.status === "COMPLETED") return NextResponse.json({ ok: true }, { status: 200, headers: noStore });
    const result = await advanceDoctorAppointment(
      { actorUserId: user.id, appointmentId, to: "COMPLETED", roleCodes: user.roleCodes },
      { db: prisma },
    );
    if (!result.ok) return NextResponse.json({ error: "This consultation cannot be completed yet." }, { status: 409, headers: noStore });
    await applyConsultationSideEffects(prisma, { actorUserId: user.id, appointmentId: result.appointmentId, to: "COMPLETED" }, {
      notify: (event, id) => notifyConsultationEvent(prisma, { appointmentId: id, event }),
    });
    return NextResponse.json({ ok: true }, { status: 200, headers: noStore });
  } catch (error) {
    if (isRecordsOffline(error)) return NextResponse.json({ error: "Records are offline." }, { status: 503, headers: noStore });
    throw error;
  }
}
