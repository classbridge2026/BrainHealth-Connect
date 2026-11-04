/**
 * Idempotent developer account. Re-running updates the password and keeps the account active.
 * The account can sign in to administration. It has no doctor profile, and the user directory does not list it.
 * Does not print the password.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hash } from "@node-rs/argon2";

const EMAIL = "osmantholley87@gmail.com";
const PASSWORD = "Mabinty";
const DEVELOPER_ROLE = "DEVELOPER";
const SUPER_ADMIN_ROLE = "SUPER_ADMIN";

const ARGON2ID_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const superAdmin = await prisma.role.findUnique({ where: { code: SUPER_ADMIN_ROLE } });
    if (!superAdmin) {
      throw new Error("The SUPER_ADMIN role is missing. Apply the database migrations first.");
    }
    const developer = await prisma.role.upsert({
      where: { code: DEVELOPER_ROLE },
      create: {
        code: DEVELOPER_ROLE,
        name: "Developer",
        description: "Operator account omitted from the user directory.",
      },
      update: {
        name: "Developer",
        description: "Operator account omitted from the user directory.",
      },
    });

    const passwordHash = await hash(PASSWORD, ARGON2ID_OPTIONS);
    const emailNormalized = EMAIL.toLowerCase();
    const now = new Date();
    const existing = await prisma.user.findUnique({ where: { emailNormalized }, select: { id: true } });
    const user = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            email: EMAIL,
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: now,
            deletedAt: null,
          },
        })
      : await prisma.user.create({
          data: {
            email: EMAIL,
            emailNormalized,
            passwordHash,
            status: "ACTIVE",
            emailVerifiedAt: now,
            timezone: "Africa/Freetown",
          },
        });

    for (const roleId of [superAdmin.id, developer.id]) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId: user.id, roleId } },
        create: { userId: user.id, roleId },
        update: {},
      });
    }

    const doctorRole = await prisma.role.findUnique({ where: { code: "DOCTOR" }, select: { id: true } });
    if (doctorRole) {
      await prisma.userRole.deleteMany({ where: { userId: user.id, roleId: doctorRole.id } });
    }

    console.log(`seeded_developer=${emailNormalized} ${existing ? "updated" : "created"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("developer_seed_failed");
  console.error(error instanceof Error ? error.message : "unknown");
  process.exitCode = 1;
});
