"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { BookingDetailsPage } from "@/app/patient/book/[offeringId]/booking-details";
import { stashBooking, subscribeBooking, takeBooking } from "@/app/patient/book/book-cache";
import { bookingPreview, type BookingPreview } from "@/app/patient/book/preview-action";
import { freetownDate } from "@/lib/appointments/time";

export function InstantBook() {
  const pathname = usePathname();
  const step = useSearchParams().get("step");
  const [open, setOpen] = useState<BookingPreview | null>(null);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank" || !link.classList.contains("dm-book")) return;
      const url = new URL(link.href, location.origin);
      if (url.origin !== location.origin) return;
      const match = url.pathname.match(/^\/patient\/book\/([0-9a-f-]{36})$/i);
      if (!match) return;
      const channel = url.searchParams.get("channel") || "video";
      const day = url.searchParams.get("date") || freetownDate(new Date());
      const cached = takeBooking(match[1], day, channel);
      if (!cached) return;
      setOpen(cached);
    }

    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => subscribeBooking(() => {
    setOpen((current) => {
      if (!current) return current;
      return takeBooking(current.offering.id, current.requested, current.channelQuery) ?? current;
    });
  }), []);

  useEffect(() => {
    if (!open || open.slotsReady) return;
    let cancel = false;
    bookingPreview(open.offering.id, open.requested, open.channelQuery)
      .then((preview) => {
        if (cancel) return;
        if (preview) stashBooking(preview);
        else stashBooking({ ...open, slotsReady: true });
      })
      .catch(() => {
        if (!cancel) stashBooking({ ...open, slotsReady: true });
      });
    return () => {
      cancel = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (step === "payment" || step === "confirmation") {
      setOpen(null);
      return;
    }
    if (!pathname.startsWith("/patient/find") && !pathname.startsWith("/patient/doctors/") && !pathname.startsWith("/patient/book/")) {
      setOpen(null);
    }
  }, [open, pathname, step]);

  useEffect(() => {
    const main = document.querySelector(".patient-scroll main");
    if (!(main instanceof HTMLElement)) return;
    if (open) main.setAttribute("inert", "");
    else main.removeAttribute("inert");
    return () => main.removeAttribute("inert");
  }, [open]);

  if (!open) return null;

  return (
    <div className="book-instant">
      <BookingDetailsPage
        offering={open.offering}
        days={open.days}
        today={open.today}
        requested={open.requested}
        locationId={open.locationId}
        locations={open.locations}
        channel={open.channel}
        channelQuery={open.channelQuery}
        start={open.start}
        slots={open.slots}
        slotsReady={open.slotsReady}
      />
    </div>
  );
}
