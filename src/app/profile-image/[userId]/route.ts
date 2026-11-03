import { NextResponse } from "next/server";
import { readApiSession } from "@/lib/auth/current-user";
import { SESSION_COOKIE } from "@/lib/auth/constants";
import { isRecordsOffline } from "@/lib/db/offline";
import { prisma } from "@/lib/db/prisma";
import { openProfileImage } from "@/lib/profile/image";

const missing = new NextResponse(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

const remembered = new Map<string, { until: number; body: Uint8Array; mimeType: string; shared: boolean }>();

function rememberedImage(key: string) {
  const hit = remembered.get(key);
  if (!hit) return null;
  if (hit.until <= Date.now()) {
    remembered.delete(key);
    return null;
  }
  return hit;
}

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

export async function GET(request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;
  try {
    const token = sessionToken(request.headers.get("cookie"));
    const session = token ? await readApiSession(prisma, token, new Date()) : { offline: false as const, user: null };
    if (session.offline) return missing;
    const viewer = session.user ? { id: session.user.id, roleCodes: session.user.roleCodes } : null;
    const cacheKey = `${viewer?.id ?? "public"}:${userId}`;
    const stored = rememberedImage(cacheKey);
    const result = stored
      ? { ok: true as const, body: stored.body, mimeType: stored.mimeType, shared: stored.shared }
      : await openProfileImage(userId, viewer, { db: prisma });
    if (!result.ok) return missing;
    if (!stored) {
      if (remembered.size > 40) remembered.clear();
      remembered.set(cacheKey, { until: Date.now() + 5 * 60 * 1000, body: result.body, mimeType: result.mimeType, shared: result.shared });
    }
    return new NextResponse(Buffer.from(result.body), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Content-Length": String(result.body.byteLength),
        // The photo address includes the save time, so the browser can keep this copy.
        "Cache-Control": result.shared ? "public, max-age=86400, immutable" : "private, max-age=86400",
        ...(result.shared ? { "CDN-Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } : {}),
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (isRecordsOffline(error)) return missing;
    throw error;
  }
}
