"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight } from "lucide-react";
import { WarmBooking } from "@/app/patient/book/warm-booking";

type Offering = {
  id: string;
  specialty: string;
  service: string;
  description: string | null;
  mode: string;
  durationMinutes: number;
  fee: string;
};

function offeringPlace(mode: string) {
  return mode === "IN_PERSON" ? "In person" : "Video or phone";
}

function offeringChannel(mode: string, visit: string) {
  if (mode === "IN_PERSON") return "in-person";
  return visit === "audio" ? "audio" : "video";
}

function showServiceList(field: HTMLDivElement | null) {
  requestAnimationFrame(() => {
    const scroller = field?.closest(".patient-scroll");
    if (!field || !(scroller instanceof HTMLElement)) return;
    const tab = document.querySelector(".patient-tabbar");
    const tabHeight = tab instanceof HTMLElement ? tab.getBoundingClientRect().height : 0;
    const top = field.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop - 8;
    scroller.scrollTo({ top, behavior: "smooth" });
    const room = scroller.clientHeight - field.getBoundingClientRect().height - tabHeight - 28;
    field.style.setProperty("--service-room", `${Math.max(room, 180)}px`);
  });
}

function optionLabel(offering: Offering, offerings: Offering[]) {
  const shared = offerings.filter((row) => row.service === offering.service).length > 1;
  const name = shared ? `${offering.service} (${offering.specialty})` : offering.service;
  return `${name} · ${offering.fee}`;
}

export function ServiceMenu({
  doctorId,
  doctorUserId,
  doctorImageVersion,
  doctorName,
  visit,
  offer,
  offerings,
  layout,
}: {
  doctorId: string;
  doctorUserId: string;
  doctorImageVersion: string | null;
  doctorName: string;
  visit: string;
  offer: string;
  offerings: Offering[];
  layout: "desk" | "mobile";
}) {
  const initial = offerings.some((offering) => offering.id === offer) ? offer : "";
  const [selectedId, setSelectedId] = useState(initial);
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);
  const selected = offerings.find((offering) => offering.id === selectedId) ?? null;
  const channel = selected ? offeringChannel(selected.mode, visit) : "";
  const bookHref = selected ? `/patient/book/${selected.id}?channel=${channel}` : "";

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!fieldRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={layout === "desk" ? "doctor-service" : "dm-service"}>
      <div className="service-field" ref={fieldRef}>
        <button type="button" className={selected ? "service-box is-set" : "service-box"} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen((value) => { const next = !value; if (next) showServiceList(fieldRef.current); return next; })}>
          {selected ? optionLabel(selected, offerings) : "Choose a service. You pay the price listed on it."}
        </button>
        {open ? (
          <ul className="service-list" role="listbox">
            {offerings.map((offering) => (
              <li key={offering.id}>
                <button type="button" role="option" aria-selected={offering.id === selected?.id} onClick={() => { setSelectedId(offering.id); setOpen(false); }}>
                  {optionLabel(offering, offerings)}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {selected ? (
        <>
          <div className="service-picked">
            <p>{selected.specialty} · {offeringPlace(selected.mode)} · {selected.durationMinutes} minutes</p>
            <p className="service-fee">{selected.fee}</p>
            {selected.description ? <p className="service-note">{selected.description}</p> : null}
          </div>
          {layout === "mobile" ? (
            <WarmBooking
              offeringId={selected.id}
              doctorId={doctorId}
              doctorUserId={doctorUserId}
              doctorImageVersion={doctorImageVersion}
              doctorName={doctorName}
              specialty={selected.specialty}
              service={selected.service}
              mode={selected.mode}
              durationMinutes={selected.durationMinutes}
              fee={selected.fee}
              channel={channel}
            />
          ) : null}
          <p className={layout === "desk" ? "doctor-pay" : "dm-pay"}>You pay {selected.fee}</p>
          <Link className={layout === "desk" ? "doctor-book" : "dm-book"} href={bookHref} prefetch={layout === "mobile"}>
            Book {selected.service} <ArrowRight size={18} aria-hidden="true" />
          </Link>
        </>
      ) : null}
    </div>
  );
}
