"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { DoctorProfileView, type DoctorProfileData } from "@/app/patient/doctors/[id]/doctor-view";
import { takeDoctor } from "@/app/patient/doctors/doctor-cache";

type OpenProfile = {
  doctor: DoctorProfileData;
  visit: string;
  offer: string;
};

export function InstantDoctor() {
  const pathname = usePathname();
  const [open, setOpen] = useState<OpenProfile | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || link.hasAttribute("download")) return;
      if (link.classList.contains("dm-book")) {
        setOpen(null);
        return;
      }
      const url = new URL(link.href, location.origin);
      if (url.origin !== location.origin) return;
      const match = url.pathname.match(/^\/patient\/doctors\/([0-9a-f-]{36})$/i);
      if (!match) return;
      const doctor = takeDoctor(match[1]);
      if (!doctor) return;
      setOpen({
        doctor,
        visit: url.searchParams.get("visit") ?? "",
        offer: url.searchParams.get("offer") ?? "",
      });
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!open) return;
    if (!pathname.startsWith("/patient/find") && !pathname.startsWith("/patient/doctors/")) {
      setOpen(null);
      return;
    }
    const main = document.querySelector("main");
    if (main?.querySelector(".doctor-page")) {
      setOpen(null);
      return;
    }
    if (!main) return;
    const observer = new MutationObserver(() => {
      if (main.querySelector(".doctor-page")) setOpen(null);
    });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [open, pathname]);

  useEffect(() => {
    const main = document.querySelector(".patient-scroll main");
    if (!(main instanceof HTMLElement)) return;
    if (open) main.setAttribute("inert", "");
    else main.removeAttribute("inert");
    return () => main.removeAttribute("inert");
  }, [open]);

  if (!open) return null;

  return (
    <div className="doctor-instant">
      <DoctorProfileView doctor={open.doctor} visit={open.visit} offer={open.offer} />
    </div>
  );
}
