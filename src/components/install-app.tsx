"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { installGuide } from "@/lib/install/prompt";
import { promptInstall, useInstallState } from "@/lib/install/store";

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </svg>
  );
}

export function InstallApp({ systemName, placement = "portal" }: { systemName: string; placement?: "bar" | "menu" | "portal" }) {
  const install = useInstallState();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const label = placement === "menu" ? "inline" : placement === "bar" ? "hidden 2xl:inline" : "hidden sm:inline";
  const buttonClass =
    placement === "menu"
      ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-brand-line bg-white px-4 text-sm font-semibold text-brand-navy hover:bg-brand-ice focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-teal"
      : "inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-[#d7e3ee] bg-white px-2.5 text-sm font-semibold text-[#0c2b45] hover:bg-[#f3f8fc] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f766e]";

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  if (!install.ready || install.standalone) return null;

  const guide = installGuide(install.ios ? "ios" : "browser", systemName);

  async function onInstall() {
    if (install.canPrompt) {
      await promptInstall();
      return;
    }
    setOpen(true);
  }

  return (
    <>
      <button ref={buttonRef} type="button" className={buttonClass} data-no-busy="" aria-label={`Install ${systemName}`} onClick={onInstall}>
        <DownloadIcon />
        <span className={label}>Install</span>
      </button>
      {open
        ? createPortal(
            <div className="fixed inset-0 z-[80] flex items-end justify-center bg-[#0c2b45]/45 p-4 sm:items-center" onClick={() => setOpen(false)}>
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-md rounded-2xl bg-white p-5 text-[#10233c] shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id={titleId} className="text-lg font-semibold text-[#0c2b45]">
                  {guide.title}
                </h2>
                <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm leading-6">
                  {guide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
                <button
                  ref={closeRef}
                  type="button"
                  className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-xl bg-[#0f766e] text-sm font-semibold text-white hover:bg-[#0c5f59] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f766e]"
                  onClick={() => {
                    setOpen(false);
                    buttonRef.current?.focus();
                  }}
                >
                  Close
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
