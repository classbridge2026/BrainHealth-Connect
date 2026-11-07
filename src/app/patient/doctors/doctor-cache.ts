import type { DoctorProfileData } from "./[id]/doctor-view";

const profiles = new Map<string, DoctorProfileData>();

export function stashDoctors(doctors: DoctorProfileData[]) {
  for (const doctor of doctors) profiles.set(doctor.id, doctor);
}

export function takeDoctor(id: string) {
  return profiles.get(id) ?? null;
}
