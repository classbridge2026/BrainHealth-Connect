"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import Swal from "sweetalert2";
import { primeRingtone, startRingtone } from "@/components/consultation/ringtone";
import { showVisitReminder } from "@/lib/ui/sweet-alert";

type DueVisit = {
  id: string;
  patientName: string;
  when: string;
  href: string;
};

function remembered(id: string) {
  try {
    return window.sessionStorage.getItem(`doctor-visit-ready:${id}`) === "1";
  } catch {
    return false;
  }
}

function remember(id: string) {
  try {
    window.sessionStorage.setItem(`doctor-visit-ready:${id}`, "1");
  } catch {
    // The reminder can show again in this tab if storage is blocked.
  }
}

function inRoom(pathname: string, id: string) {
  return pathname === `/doctor/appointments/${id}/consultation` || pathname === `/doctor/appointments/${id}/consultation/`;
}

export function DoctorVisitReminder() {
  const pathname = usePathname();
  const router = useRouter();
  const path = useRef(pathname);
  const showing = useRef(false);
  const ring = useRef<(() => void) | null>(null);
  path.current = pathname;

  useEffect(() => {
    primeRingtone();
  }, []);

  useEffect(() => {
    let stop = false;
    let timer = 0;

    async function look() {
      if (stop || showing.current || document.visibilityState === "hidden") return;
      let visit: DueVisit | null = null;
      try {
        const response = await fetch("/api/doctor/visit-reminder", { cache: "no-store" });
        if (!response.ok || stop) return;
        const payload = (await response.json()) as { visit?: DueVisit | null };
        visit = payload.visit ?? null;
      } catch {
        return;
      }
      if (!visit || stop || showing.current || remembered(visit.id) || inRoom(path.current, visit.id)) return;
      showing.current = true;
      const stopRing = startRingtone();
      ring.current = stopRing;
      try {
        const result = await showVisitReminder(visit.patientName, visit.when);
        if (result.isConfirmed) {
          remember(visit.id);
          router.push(visit.href);
        }
      } finally {
        stopRing();
        ring.current = null;
        showing.current = false;
      }
    }

    function schedule() {
      if (stop) return;
      timer = window.setTimeout(() => {
        void look().finally(schedule);
      }, 15000);
    }

    void look().finally(schedule);
    const onVisible = () => {
      if (document.visibilityState === "visible") void look();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      ring.current?.();
      ring.current = null;
      void Swal.close();
    };
  }, [router]);

  return null;
}
