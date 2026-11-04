import type { PrismaClient, UserStatus } from "@prisma/client";
import { isRecordsOffline, RecordsOfflineError } from "@/lib/db/offline";
import { redirectOffline } from "@/lib/db/offline-redirect";
import { forgetRemembered, rememberFor } from "@/lib/db/remember";
import { patientAccessDecision, ownPatientScope } from "./access";
import { hashSessionToken } from "./tokens";

export type CurrentUser = {
  id: string;
  status: UserStatus;
  roleCodes: string[];
  decision: ReturnType<typeof patientAccessDecision>;
};

const SESSION_TTL_MS = 30_000;

/** Drops cached sign-ins so a revoked session is noticed on the next request. */
export function forgetRememberedSessions() {
  forgetRemembered("session:");
}

export async function readSessionUser(
  db: PrismaClient,
  rawToken: string | undefined,
  now: Date,
): Promise<CurrentUser | null> {
  if (!rawToken) {
    return null;
  }
  if (process.env.NODE_ENV === "test") return readSessionRecord(db, rawToken, now);
  return rememberFor(
    `session:${hashSessionToken(rawToken)}`,
    SESSION_TTL_MS,
    () => readSessionRecord(db, rawToken, now),
    (user) => user !== null,
  );
}

async function readSessionRecord(
  db: PrismaClient,
  rawToken: string,
  now: Date,
): Promise<CurrentUser | null> {
  let session;
  try {
    session = await db.session.findUnique({
      where: { tokenHash: hashSessionToken(rawToken) },
      select: {
        revokedAt: true,
        expiresAt: true,
        user: {
          select: {
            id: true,
            status: true,
            deletedAt: true,
            roles: { select: { role: { select: { code: true } } } },
          },
        },
      },
    });
  } catch (error) {
    if (isRecordsOffline(error)) throw new RecordsOfflineError();
    throw error;
  }
  if (!session || session.revokedAt || session.expiresAt <= now || session.user.deletedAt) {
    return null;
  }
  const roleCodes = session.user.roles.map((entry) => entry.role.code);
  return {
    id: session.user.id,
    status: session.user.status,
    roleCodes,
    decision: patientAccessDecision({
      status: session.user.status,
      deletedAt: session.user.deletedAt,
      roleCodes,
    }),
  };
}

/** Page session read. A down database opens a plain explanation instead of a technical error. */
export async function readPageSession(db: PrismaClient, rawToken: string | undefined, now: Date) {
  try {
    return await readSessionUser(db, rawToken, now);
  } catch (error) {
    if (isRecordsOffline(error)) await redirectOffline();
    throw error;
  }
}

export async function readApiSession(db: PrismaClient, rawToken: string | undefined, now: Date) {
  try {
    return { offline: false as const, user: await readSessionUser(db, rawToken, now) };
  } catch (error) {
    if (isRecordsOffline(error)) return { offline: true as const, user: null };
    throw error;
  }
}

export async function readOwnPatientProfile(
  db: PrismaClient,
  actorUserId: string,
  requestedUserId?: string | null,
) {
  const scope = ownPatientScope(actorUserId, requestedUserId);
  if (!scope.allowed) {
    return { ok: false as const, code: "FORBIDDEN" as const };
  }
  try {
    const profile = await db.patientProfile.findUnique({
      where: { userId: scope.userId },
      select: {
        id: true,
        userId: true,
        fullName: true,
      },
    });
    return { ok: true as const, profile };
  } catch {
    return { ok: false as const, code: "UNAVAILABLE" as const };
  }
}
