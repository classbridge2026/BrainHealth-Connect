import type { ConsultationMode, PrismaClient } from "@prisma/client";
import { DOCTOR_ROLE_CODE } from "@/lib/auth/constants";
import { canManageCatalog, parseRequiredMode, parseUuid } from "./rules";

type Actor = { userId: string; roleCodes: string[] };

const CLINICIAN_NAME = /^[\p{L}][\p{L}' .-]{1,119}$/u;

export type SelfDoctorOption = {
  profileId: string | null;
  fullName: string;
  eligible: boolean;
  blocked: string | null;
};

const idleSelf: SelfDoctorOption = { profileId: null, fullName: "", eligible: false, blocked: null };

export function parseClinicianName(value: string): string | null {
  const name = value.trim().replace(/\s+/g, " ");
  if (!CLINICIAN_NAME.test(name)) return null;
  return name;
}

export async function loadSelfDoctorOption(db: PrismaClient, userId: string): Promise<SelfDoctorOption> {
  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        status: true,
        deletedAt: true,
        doctorProfile: {
          select: {
            id: true,
            fullName: true,
            verificationStatus: true,
            specialties: {
              where: { claimStatus: "VERIFIED", specialty: { isActive: true } },
              select: { specialtyId: true },
            },
          },
        },
      },
    });
    if (!user || user.deletedAt || user.status !== "ACTIVE") {
      return { ...idleSelf, blocked: "This account has to be active before patients can book it." };
    }
    const profile = user.doctorProfile;
    if (!profile) return idleSelf;
    if (profile.verificationStatus === "SUSPENDED" || profile.verificationStatus === "REJECTED") {
      return {
        profileId: profile.id,
        fullName: profile.fullName,
        eligible: false,
        blocked: "This profile is suspended or rejected, so patients cannot book it until that decision is changed.",
      };
    }
    return {
      profileId: profile.id,
      fullName: profile.fullName,
      eligible: profile.verificationStatus === "APPROVED" && profile.specialties.length > 0,
      blocked: null,
    };
  } catch {
    return { ...idleSelf, blocked: "Your account could not be loaded for this assignment." };
  }
}

export async function prepareSelfDoctor(
  input: { fullName: string; specialtyId: string; mode: string },
  deps: { db: PrismaClient; actor: Actor; now: Date },
): Promise<{ ok: true; doctorProfileId: string } | { ok: false; message: string }> {
  if (!canManageCatalog(deps.actor.roleCodes)) {
    return { ok: false, message: "Only an administrator can assign a service to their own account." };
  }
  const specialtyId = parseUuid(input.specialtyId);
  if (!specialtyId) return { ok: false, message: "Choose a specialty." };
  const mode = parseRequiredMode(input.mode);
  if (!mode) return { ok: false, message: "Choose online or in person." };

  try {
    const doctorProfileId = await deps.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: deps.actor.userId },
        select: {
          status: true,
          deletedAt: true,
          doctorProfile: {
            select: {
              id: true,
              fullName: true,
              verificationStatus: true,
              consultationModes: true,
              specialties: { select: { id: true, specialtyId: true, claimStatus: true, isPrimary: true } },
            },
          },
        },
      });
      if (!user || user.deletedAt || user.status !== "ACTIVE") {
        throw new Error("INACTIVE");
      }
      const existing = user.doctorProfile;
      if (existing && (existing.verificationStatus === "SUSPENDED" || existing.verificationStatus === "REJECTED")) {
        throw new Error("BLOCKED");
      }
      const specialty = await tx.specialty.findUnique({ where: { id: specialtyId }, select: { isActive: true } });
      if (!specialty?.isActive) throw new Error("SPECIALTY");
      const role = await tx.role.findUnique({ where: { code: DOCTOR_ROLE_CODE }, select: { id: true } });
      if (!role) throw new Error("ROLE");
      const held = await tx.userRole.findFirst({ where: { userId: deps.actor.userId, roleId: role.id }, select: { id: true } });
      if (!held) {
        await tx.userRole.create({ data: { userId: deps.actor.userId, roleId: role.id, grantedBy: deps.actor.userId } });
      }

      const name = existing ? existing.fullName : parseClinicianName(input.fullName);
      if (!name) throw new Error("NAME");
      const modes = withMode(existing?.consultationModes ?? [], mode);
      let profileId = existing?.id ?? "";
      let fromStatus = existing?.verificationStatus ?? null;
      if (!existing) {
        const created = await tx.doctorProfile.create({
          data: {
            userId: deps.actor.userId,
            fullName: name,
            displayName: name,
            verificationStatus: "APPROVED",
            verifiedAt: deps.now,
            consultationModes: modes,
          },
          select: { id: true },
        });
        profileId = created.id;
        fromStatus = null;
      } else if (existing.verificationStatus !== "APPROVED" || existing.consultationModes.join() !== modes.join()) {
        await tx.doctorProfile.update({
          where: { id: existing.id },
          data: {
            verificationStatus: "APPROVED",
            verifiedAt: existing.verificationStatus === "APPROVED" ? undefined : deps.now,
            consultationModes: modes,
          },
        });
      }

      const claim = existing?.specialties.find((item) => item.specialtyId === specialtyId);
      const hasPrimary = existing?.specialties.some((item) => item.isPrimary) ?? false;
      if (!claim) {
        await tx.doctorSpecialty.create({
          data: {
            doctorProfileId: profileId,
            specialtyId,
            isPrimary: !hasPrimary,
            claimStatus: "VERIFIED",
            verifiedAt: deps.now,
            verifiedByUserId: deps.actor.userId,
          },
        });
      } else if (claim.claimStatus !== "VERIFIED") {
        await tx.doctorSpecialty.update({
          where: { id: claim.id },
          data: { claimStatus: "VERIFIED", verifiedAt: deps.now, verifiedByUserId: deps.actor.userId },
        });
      }

      if (!existing || existing.verificationStatus !== "APPROVED") {
        await tx.doctorVerificationEvent.create({
          data: {
            doctorProfileId: profileId,
            actorUserId: deps.actor.userId,
            action: "self_opened",
            fromStatus,
            toStatus: "APPROVED",
          },
        });
      }
      await tx.auditLog.create({
        data: {
          actorUserId: deps.actor.userId,
          action: "doctor.self_opened",
          entityType: "DoctorProfile",
          entityId: profileId,
          metadata: { specialtyId, mode },
        },
      });
      return profileId;
    });
    return { ok: true, doctorProfileId };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "INACTIVE") return { ok: false, message: "This account has to be active before patients can book it." };
    if (message === "BLOCKED") {
      return { ok: false, message: "This profile is suspended or rejected, so patients cannot book it until that decision is changed." };
    }
    if (message === "SPECIALTY") return { ok: false, message: "Choose an active specialty." };
    if (message === "ROLE") return { ok: false, message: "The doctor role is not available." };
    if (message === "NAME") return { ok: false, message: "Enter the name patients should see, using letters." };
    return { ok: false, message: "The service could not be assigned to your account. Try again." };
  }
}

function withMode(current: ConsultationMode[], mode: ConsultationMode): ConsultationMode[] {
  return current.includes(mode) ? current : [...current, mode];
}
