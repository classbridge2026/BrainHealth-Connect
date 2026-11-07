"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { stashDoctors } from "@/app/patient/doctors/doctor-cache";
import type { DoctorProfileData } from "@/app/patient/doctors/[id]/doctor-view";

export function WarmProfiles({ doctors }: { doctors: DoctorProfileData[] }) {
  stashDoctors(doctors);
  const router = useRouter();
  const key = doctors.map((doctor) => doctor.id).join("\n");

  useEffect(() => {
    const prefetch = router.prefetch as (href: string, options?: { kind?: "auto" | "full" }) => void;
    for (const id of key.split("\n")) {
      if (id) prefetch(`/patient/doctors/${id}`, { kind: "full" });
    }
  }, [router, key]);

  return null;
}
