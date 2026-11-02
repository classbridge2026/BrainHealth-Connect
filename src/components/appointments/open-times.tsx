"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { visibleBookingSlots, type SlotAvailability } from "@/lib/appointments/slots";
import "@/app/patient/book/book.css";

export type BookingTime = {
  startsAt: string;
  label: string;
  availability: SlotAvailability;
};

function pageHref(basePath: string, date: string, locationId: string, startsAt?: string, hash?: string, channel = "") {
  const params = new URLSearchParams();
  params.set("date", date);
  if (locationId) params.set("location", locationId);
  if (channel) params.set("channel", channel);
  if (startsAt) params.set("start", startsAt);
  return `${basePath}?${params.toString()}${hash ? `#${hash}` : ""}`;
}

export function OpenTimes({
  slots,
  selectedStart,
  basePath,
  date,
  locationId = "",
  channel = "",
  hash,
  children,
}: {
  slots: BookingTime[];
  selectedStart: string;
  basePath: string;
  date: string;
  locationId?: string;
  channel?: string;
  hash?: string;
  children?: ReactNode;
}) {
  const router = useRouter();
  const cleared = useRef(false);
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    cleared.current = false;
  }, [selectedStart]);

  const visible = visibleBookingSlots(slots, now);
  const selectedOpen = visible.some((slot) => slot.availability === "open" && slot.startsAt === selectedStart);
  const openCount = visible.filter((slot) => slot.availability === "open").length;

  useEffect(() => {
    if (!selectedStart || selectedOpen || cleared.current) return;
    cleared.current = true;
    router.replace(pageHref(basePath, date, locationId, undefined, hash, channel));
  }, [basePath, channel, date, hash, locationId, router, selectedOpen, selectedStart]);

  return (
    <div className="book-times">
      {openCount === 0 ? (
        <p className="book-empty">
          No open times left on this date. A time disappears once it has passed{visible.some((slot) => slot.availability === "booked") ? ", and booked times stay listed" : ""}.
        </p>
      ) : null}
      <ul className="book-slots">
        {visible.map((slot) => {
          const href = pageHref(basePath, date, locationId, slot.startsAt, hash, channel);
          const chosen = slot.startsAt === selectedStart;
          return (
            <li key={slot.startsAt}>
              {slot.availability === "open" ? (
                <Link href={href} className={`book-slot${chosen ? " book-slot-on" : ""}`}>
                  {slot.label}
                </Link>
              ) : (
                <span className="book-slot book-slot-busy" aria-disabled="true">
                  {slot.label} · Booked
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {selectedOpen ? children : null}
    </div>
  );
}
