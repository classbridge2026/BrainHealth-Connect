import { unstable_cache } from "next/cache";
import { cache } from "react";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export const SYSTEM_NAME_SETTING_KEY = "SYSTEM_NAME";
export const DEFAULT_SYSTEM_NAME = "CareCircle MindTogether";
export const SYSTEM_NAME_MAX_LENGTH = 80;

const SYSTEM_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}&'.,\- ]*$/u;

export function parseSystemName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > SYSTEM_NAME_MAX_LENGTH) return null;
  if (!SYSTEM_NAME_PATTERN.test(name)) return null;
  return name;
}

export function readStoredSystemName(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SYSTEM_NAME;
  return parseSystemName(value) ?? DEFAULT_SYSTEM_NAME;
}

export async function loadSystemName(db: Pick<PrismaClient, "platformSetting">): Promise<string> {
  try {
    const row = await db.platformSetting.findUnique({
      where: { key: SYSTEM_NAME_SETTING_KEY },
      select: { valueJson: true },
    });
    return readStoredSystemName(row?.valueJson);
  } catch {
    return DEFAULT_SYSTEM_NAME;
  }
}

const readCachedSystemName = unstable_cache(() => loadSystemName(prisma), ["system-name"], { revalidate: 300, tags: ["system-name"] });

let heldName: { until: number; name: string } | null = null;

/** Drops the in-memory name so the next page reads the saved one. */
export function forgetHeldSystemName() {
  heldName = null;
}

/** Current name for pages and titles. Cached for a few minutes; saving the name clears it. */
export const getSystemName = cache(async () => {
  if (process.env.NODE_ENV !== "test" && heldName && heldName.until > Date.now()) return heldName.name;
  const name = await readCachedSystemName();
  if (process.env.NODE_ENV !== "test") heldName = { until: Date.now() + 300_000, name };
  return name;
});
