import { PrismaClient } from "@prisma/client";
import { withPoolSettings } from "@/lib/db/pool";

const globalForImageDb = globalThis as unknown as { profileImageDb?: PrismaClient };

function imageDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (!raw) return undefined;
  const tuned = withPoolSettings(raw);
  const split = tuned.indexOf("?");
  const base = split === -1 ? tuned : tuned.slice(0, split);
  const params = new URLSearchParams(split === -1 ? "" : tuned.slice(split + 1));
  // Photo bytes can take many seconds to arrive. Keep that wait off the pool pages use.
  params.set("connection_limit", "1");
  return `${base}?${params.toString()}`;
}

function createImageDb() {
  const url = imageDatabaseUrl();
  return new PrismaClient({
    datasources: url ? { db: { url } } : undefined,
  });
}

/** Separate one-connection client so a large photo does not block page queries. */
export const profileImageDb: PrismaClient = globalForImageDb.profileImageDb ?? createImageDb();

if (process.env.NODE_ENV !== "production") {
  globalForImageDb.profileImageDb = profileImageDb;
}
