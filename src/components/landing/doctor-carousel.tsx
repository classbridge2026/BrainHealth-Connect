"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PublicDoctor } from "@/lib/public/landing";
import { profileImageSrc } from "@/components/profile-image-src";
import { focusRing } from "./styles";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "Dr";
}

function visitLabel(modes: PublicDoctor["consultationTypes"]): string | null {
  const online = modes.includes("ONLINE");
  const inPerson = modes.includes("IN_PERSON");
  if (online && inPerson) return "Online & In-Person";
  if (online) return "Online";
  if (inPerson) return "In-Person";
  return null;
}

function DoctorCard({ doctor }: { doctor: PublicDoctor }) {
  const role = doctor.qualification ?? doctor.specialties[0] ?? "Clinician";
  const visits = visitLabel(doctor.consultationTypes);
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-2xl border border-[#d7e6f2] bg-white shadow-[0_10px_30px_rgba(18,48,74,0.08)]">
      <div className="relative h-28 bg-gradient-to-b from-[#e7f3f8] to-[#d5ebe8] sm:h-32">
        {doctor.photo ? (
          <Image className="object-cover object-top" src={profileImageSrc(doctor.photo.userId, doctor.photo.version)} alt="" fill sizes="240px" quality={55} />
        ) : (
          <p className="absolute inset-0 flex items-center justify-center text-2xl font-semibold tracking-tight text-brand-navy" aria-hidden="true">
            {initials(doctor.displayName)}
          </p>
        )}
        <p className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#178a4a] shadow-sm">
          <span aria-hidden="true" className="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#178a4a] text-[9px] text-white">
            ✓
          </span>
          Verified
        </p>
      </div>
      <div className="flex flex-1 flex-col px-3.5 pt-3 pb-3">
        <h3 className="truncate text-base font-semibold text-brand-navy">{doctor.displayName}</h3>
        <p className="mt-0.5 truncate text-sm text-brand-muted">{role}</p>
        {visits || doctor.sessionFee ? (
          <p className="mt-2 truncate text-xs font-semibold text-brand-navy">{[visits, doctor.sessionFee].filter(Boolean).join(" · ")}</p>
        ) : null}
        {doctor.services.length > 0 ? <p className="mt-1 truncate text-xs text-brand-ink">Services: {doctor.services.join(", ")}</p> : null}
        {doctor.languages.length > 0 ? <p className="mt-0.5 truncate text-xs text-brand-muted">Languages: {doctor.languages.join(", ")}</p> : null}
        <Link
          href={`/patient/doctors/${doctor.id}`}
          prefetch={false}
          className={`mt-3 inline-flex h-9 w-full items-center justify-center rounded-lg bg-brand-navy text-sm font-semibold text-white hover:bg-[#0c2438] ${focusRing}`}
        >
          Book Appointment
        </Link>
      </div>
    </article>
  );
}

export function DoctorCarousel({ doctors }: { doctors: PublicDoctor[] }) {
  const scroller = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);

  useEffect(() => {
    const list = scroller.current;
    if (!list) return;
    function update() {
      if (!list) return;
      setAtStart(list.scrollLeft <= 4);
      setAtEnd(list.scrollLeft + list.clientWidth >= list.scrollWidth - 4);
    }
    update();
    list.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      list.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [doctors.length]);

  function move(direction: -1 | 1) {
    const list = scroller.current;
    const card = list?.querySelector("li");
    if (!list || !card) return;
    const gap = 16;
    list.scrollBy({ left: direction * (card.getBoundingClientRect().width + gap), behavior: "smooth" });
  }

  return (
    <div className="relative">
      <ul
        ref={scroller}
        className="flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-px-1 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {doctors.map((doctor) => (
          <li key={doctor.id} className="w-60 shrink-0 snap-start sm:w-64">
            <DoctorCard doctor={doctor} />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={`absolute top-1/3 -left-2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-brand-line bg-white text-brand-navy shadow-md sm:-left-5 ${focusRing} disabled:pointer-events-none disabled:opacity-40`}
        aria-label="Previous doctors"
        disabled={atStart}
        onClick={() => move(-1)}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <button
        type="button"
        className={`absolute top-1/3 -right-2 inline-flex h-11 w-11 items-center justify-center rounded-full border border-brand-line bg-white text-brand-navy shadow-md sm:-right-5 ${focusRing} disabled:pointer-events-none disabled:opacity-40`}
        aria-label="Next doctors"
        disabled={atEnd}
        onClick={() => move(1)}
      >
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
