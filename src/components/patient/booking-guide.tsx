"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import "./booking-guide.css";

const GUIDE_SRC = "/guides/brainhealth-connect-patient-booking-krio.mp4";

export function BookingGuideVideo({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const opener = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = video.current;
    if (typeof node?.play === "function") void node.play().catch(() => undefined);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      node?.pause();
      opener.current?.focus();
    };
  }, [open]);

  return (
    <>
      <button ref={opener} type="button" className="booking-guide-open" onClick={() => setOpen(true)}>
        <PlayMark />
        {label}
      </button>
      {open
        ? createPortal(
            <div className="booking-guide-layer" onClick={() => setOpen(false)}>
              <div
                className="booking-guide-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(event) => event.stopPropagation()}
              >
                <header>
                  <h2 id={titleId}>How to book and pay</h2>
                  <button ref={closeButton} type="button" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </header>
                <video ref={video} controls playsInline preload="metadata" src={GUIDE_SRC} aria-label="How to book and pay, in Krio" />
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function PlayMark() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M10 8.5v7l6-3.5z" fill="currentColor" />
    </svg>
  );
}
