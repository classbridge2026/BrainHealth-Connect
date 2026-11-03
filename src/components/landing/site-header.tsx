"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { BrandMark } from "./brand-mark";
import { LandingIcon } from "./icons";
import { btnGhost, btnPrimary, btnSecondary, focusRing } from "./styles";

const navItems = [
  { href: "/#top", label: "Home" },
  { href: "/patient/find", label: "Find a Doctor" },
  { href: "/#services", label: "Services" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/#about", label: "About Us" },
  { href: "/#contact", label: "Contact" },
];

const linkClass = `shrink-0 rounded-lg px-1.5 py-2 text-sm font-semibold whitespace-nowrap text-brand-navy hover:bg-brand-ice 2xl:px-2.5 ${focusRing}`;
const barButton = "inline-flex h-10 shrink-0 items-center justify-center whitespace-nowrap rounded-xl px-3 text-sm font-semibold";

function Actions({ onNavigate, stacked }: { onNavigate?: () => void; stacked?: boolean }) {
  if (!stacked) {
    return (
      <div className="flex items-center gap-1.5 2xl:gap-2">
        <Link href="/login" prefetch={false} className={`${barButton} text-brand-navy hover:bg-brand-ice ${focusRing}`} onClick={onNavigate}>
          Log In
        </Link>
        <Link href="/register" prefetch={false} className={`${barButton} border border-brand-line bg-white text-brand-navy hover:bg-brand-ice ${focusRing}`} onClick={onNavigate}>
          Create Patient Account
        </Link>
        <Link href="/patient/find" prefetch={false} className={`${barButton} bg-brand-teal text-white hover:bg-brand-teal-hover ${focusRing}`} onClick={onNavigate}>
          Book an Appointment
        </Link>
      </div>
    );
  }

  const full = "w-full";
  return (
    <div className="flex w-full flex-col gap-2">
      <Link href="/login" prefetch={false} className={`${btnGhost} ${full}`} onClick={onNavigate}>
        Log In
      </Link>
      <Link href="/register" prefetch={false} className={`${btnSecondary} ${full}`} onClick={onNavigate}>
        Create Patient Account
      </Link>
      <Link href="/patient/find" prefetch={false} className={`${btnPrimary} ${full}`} onClick={onNavigate}>
        Book an Appointment
      </Link>
    </div>
  );
}

export function SiteHeader({ systemName }: { systemName: string }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const onChange = () => {
      if (media.matches) setOpen(false);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>("a[href], button:not([disabled])")?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      buttonRef.current?.focus();
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function close() {
    setOpen(false);
  }

  return (
    <header data-no-busy="" className="sticky top-0 z-40 border-b border-brand-line bg-white/95 backdrop-blur-sm">
      <div className="mx-auto flex w-full max-w-7xl items-center gap-2 px-4 py-3 sm:px-6 xl:gap-3">
        <Link href="/#top" className={`flex shrink-0 items-center gap-2.5 rounded-lg ${focusRing}`} onClick={close}>
          <BrandMark className="h-10 w-10 shrink-0" />
          <span className="text-sm leading-tight font-semibold tracking-tight text-brand-navy">{systemName}</span>
        </Link>

        <nav aria-label="Primary" className="ml-auto hidden items-center gap-0.5 xl:flex 2xl:gap-1">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href} prefetch={item.href.startsWith("/#") ? undefined : false} className={linkClass}>
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="hidden shrink-0 xl:block">
          <Actions />
        </div>

        <button
          ref={buttonRef}
          type="button"
          className={`ml-auto inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-brand-navy hover:bg-brand-ice xl:hidden ${focusRing}`}
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((current) => !current)}
        >
          <LandingIcon name={open ? "close" : "menu"} className="h-6 w-6" />
          <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        </button>
      </div>

      {open ? (
        <div
          id={menuId}
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="max-h-[calc(100dvh-4.5rem)] overflow-y-auto border-t border-brand-line bg-white px-4 py-4 xl:hidden"
        >
          <nav aria-label="Mobile" className="grid gap-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                prefetch={item.href.startsWith("/#") ? undefined : false}
                className={`rounded-xl px-3 py-3 text-base font-semibold text-brand-navy hover:bg-brand-ice ${focusRing}`}
                onClick={close}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="mt-4 border-t border-brand-line pt-4">
            <Actions stacked onNavigate={close} />
          </div>
        </div>
      ) : null}
    </header>
  );
}
