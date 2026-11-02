import { PrismaClient } from "@prisma/client";
import { poolTag, withPoolSettings } from "./pool";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient; prismaPool?: string };

const databaseUrl = process.env.DATABASE_URL ? withPoolSettings(process.env.DATABASE_URL) : undefined;
const POOL_TAG = databaseUrl ? `${poolTag(databaseUrl)}/omit-photo-support/tx30` : "unconfigured";

if (process.env.NODE_ENV !== "production" && globalForPrisma.prisma && globalForPrisma.prismaPool !== POOL_TAG) {
  void globalForPrisma.prisma.$disconnect().catch(() => undefined);
  globalForPrisma.prisma = undefined;
}

function createPrismaClient(): PrismaClient {
  return new PrismaClient({
    datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined,
    // Photos live on the user row. Leave them out of every read unless a query selects them.
    omit: { user: { profileImageBytes: true }, supportRequest: { attachmentBytes: true }, payment: { receiptBytes: true } },
    // Neon round trips often exceed Prisma's 5 second interactive-transaction default.
    transactionOptions: { maxWait: 20_000, timeout: 30_000 },
  }) as unknown as PrismaClient;
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaPool = POOL_TAG;
}
