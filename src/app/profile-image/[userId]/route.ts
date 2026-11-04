import { NextResponse } from "next/server";
import { ADMIN_ROLE_CODE, SESSION_COOKIE, SUPER_ADMIN_ROLE_CODE } from "@/lib/auth/constants";
import { readApiSession } from "@/lib/auth/current-user";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { readCachedProfileImage, writeCachedProfileImage } from "@/lib/profile/image-cache";
import { profileImageDb } from "@/lib/profile/image-db";
import { openProfileImage } from "@/lib/profile/image";

const missing = new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

function sessionToken(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const split = trimmed.indexOf("=");
    if (split <= 0) continue;
    if (trimmed.slice(0, split) !== SESSION_COOKIE) continue;
    const value = trimmed.slice(split + 1);
    return value ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

function imageResponse(body: Uint8Array | Buffer, mimeType: string, shared: boolean) {
  return new NextResponse(Buffer.from(body), {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Length": String(body.byteLength),
      "Cache-Control": shared ? "public, max-age=86400, immutable" : "private, max-age=86400",
      ...(shared ? { "CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } : {}),
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function canUseCached(shared: boolean, viewer: { id: string; roleCodes: string[] } | null, userId: string) {
  if (shared) return true;
  if (!viewer) return false;
  if (viewer.id === userId) return true;
  return viewer.roleCodes.includes(ADMIN_ROLE_CODE) || viewer.roleCodes.includes(SUPER_ADMIN_ROLE_CODE);
}

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  const version = new URL(request.url).searchParams.get("v");
  try {
    const cached = await readCachedProfileImage(userId, version);
    if (cached?.shared) return imageResponse(cached.body, cached.mimeType, true);

    const token = sessionToken(request.headers.get("cookie"));
    const session = token ? await readApiSession(prisma, token, new Date()) : { offline: false as const, user: null };
    if (session.offline) return missing;
    const viewer = session.user && session.user.status === "ACTIVE" ? { id: session.user.id, roleCodes: session.user.roleCodes } : null;
    if (cached && canUseCached(cached.shared, viewer, userId)) {
      return imageResponse(cached.body, cached.mimeType, cached.shared);
    }

    const result = await openProfileImage(userId, viewer, { db: profileImageDb });
    if (!result.ok) return missing;
    if (version) {
      await writeCachedProfileImage(userId, {
        body: Buffer.from(result.body),
        mimeType: result.mimeType,
        shared: result.shared,
        version,
      }).catch(() => undefined);
    }
    return imageResponse(result.body, result.mimeType, result.shared);
  } catch (error) {
    if (isRecordsOffline(error)) return missing;
    throw error;
  }
}
