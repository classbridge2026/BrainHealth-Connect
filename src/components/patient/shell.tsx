"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import {
  faBars,
  faBell,
  faCalendarCheck,
  faCalendarDays,
  faChevronDown,
  faChevronLeft,
  faClipboardList,
  faCreditCard,
  faGaugeHigh,
  faKey,
  faMagnifyingGlass,
  faNotesMedical,
  faRightFromBracket,
  faUser,
  faUserDoctor,
  faXmark,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { signOutAction } from "@/app/admin/account-actions";
import { CareCircleMark } from "@/components/brand";
import { InstallApp } from "@/components/install-app";
import { LiveSearchInput } from "@/components/live-query";
import { NotificationBell, type BellItem } from "@/components/notifications/bell";
import { PatientCallAlert } from "@/components/consultation/patient-call-alert";
import { PatientGuide } from "@/components/guide/patient-guide";
import { ProfilePhoto } from "@/components/profile-photo";
import "./patient-shell.css";

config.autoAddCss = false;

const links: Array<{ href: string; label: string; icon: IconDefinition; exact?: boolean }> = [
  { href: "/patient", label: "Dashboard", icon: faGaugeHigh, exact: true },
  { href: "/patient/find", label: "Find a Doctor", icon: faUserDoctor },
  { href: "/patient/appointments", label: "Appointments", icon: faCalendarDays },
  { href: "/patient/screening", label: "Screening Centre", icon: faClipboardList },
  { href: "/patient/payments", label: "Payments", icon: faCreditCard },
  { href: "/patient/summaries", label: "Clinical Summaries", icon: faNotesMedical },
  { href: "/patient/follow-ups", label: "Follow-ups", icon: faCalendarCheck },
  { href: "/patient/notifications", label: "Notifications", icon: faBell },
  { href: "/patient/profile", label: "Profile", icon: faUser },
];

const tabOrder = ["/patient", "/patient/find", "/patient/appointments", "/patient/summaries", "/patient/profile"] as const;
const tabLabel: Record<(typeof tabOrder)[number], string> = {
  "/patient": "Home",
  "/patient/find": "Find",
  "/patient/appointments": "Visits",
  "/patient/summaries": "Records",
  "/patient/profile": "Profile",
};
const tabs = tabOrder.map((href) => links.find((link) => link.href === href)!);
const moreLinks = links.filter((link) => !tabOrder.includes(link.href as (typeof tabOrder)[number]));

function currentHref(pathname: string) {
  if (pathname.startsWith("/patient/doctors") || pathname.startsWith("/patient/book")) return "/patient/find";
  let best: string | null = null;
  for (const link of links) {
    const match = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
    if (match && (best === null || link.href.length > best.length)) best = link.href;
  }
  return best;
}

export function PatientShell({
  userId,
  name,
  systemName,
  imageVersion,
  unread,
  notices,
  children,
}: {
  userId: string;
  name: string;
  systemName: string;
  imageVersion: string | null;
  unread: number;
  notices: BellItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = currentHref(pathname);
  const room = /\/patient\/appointments\/[^/]+\/consultation\/?$/.test(pathname);
  const [accountPath, setAccountPath] = useState<string | null>(null);
  const [morePath, setMorePath] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollThumbRef = useRef<HTMLDivElement>(null);
  const accountOpen = accountPath === pathname;
  const moreOpen = morePath === pathname;
  const moreCurrent = moreLinks.some((link) => link.href === active);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAccountPath(null);
        setMorePath(null);
      }
    }
    function onPointer(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountPath(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    const thumb = scrollThumbRef.current;
    if (!node || !thumb) return;
    const media = window.matchMedia("(max-width: 1023px)");
    let timer = 0;

    function hide() {
      thumb?.classList.remove("is-visible");
    }

    function onScroll() {
      const scroller = node;
      const marker = thumb;
      if (!scroller || !marker || !media.matches) {
        hide();
        return;
      }
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (maxScroll <= 1) {
        hide();
        return;
      }
      const height = Math.max(36, (scroller.clientHeight / scroller.scrollHeight) * scroller.clientHeight);
      const top = (scroller.scrollTop / maxScroll) * (scroller.clientHeight - height);
      marker.style.height = `${height}px`;
      marker.style.transform = `translateY(${top}px)`;
      marker.classList.add("is-visible");
      window.clearTimeout(timer);
      timer = window.setTimeout(hide, 700);
    }

    node.addEventListener("scroll", onScroll, { passive: true });
    media.addEventListener("change", hide);
    return () => {
      node.removeEventListener("scroll", onScroll);
      media.removeEventListener("change", hide);
      window.clearTimeout(timer);
      hide();
    };
  }, [room]);

  if (room) {
    return (
      <div className="fixed inset-0 overflow-hidden bg-[#F3F8FC] text-[#0C2B45]">
        {children}
      </div>
    );
  }

  return (
    <div className="patient-app fixed inset-0 flex overflow-hidden bg-[#F3F8FC] text-[#10233c]">
      <aside
        id="patient-navigation"
        data-no-busy=""
        className={`patient-drawer fixed inset-y-0 left-0 z-40 flex h-dvh w-[248px] shrink-0 -translate-x-full flex-col bg-[#0C2B45] text-white transition-transform lg:static lg:translate-x-0 ${collapsed ? "lg:w-[76px]" : ""}`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-4">
          <Link href="/patient" className="flex min-w-0 items-center gap-3 px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <CareCircleMark className="h-10 w-10 bg-white" />
            <span className={`block max-w-[148px] text-[15px] leading-snug font-semibold ${collapsed ? "lg:sr-only" : ""}`}>{systemName}</span>
          </Link>
          <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:inline-flex" aria-pressed={collapsed} onClick={() => setCollapsed((value) => !value)}>
            <FontAwesomeIcon icon={faChevronLeft} className={collapsed ? "rotate-180" : ""} aria-hidden="true" />
            <span className="sr-only">{collapsed ? "Expand navigation" : "Collapse navigation"}</span>
          </button>
        </div>
        <nav aria-label="Patient portal" className="flex-1 overflow-y-auto px-3">
          <ul className="grid gap-1">
            {links.map((link) => {
              const current = link.href === active;
              return (
                <li key={link.href}>
                  <Link href={link.href} prefetch={false} aria-current={current ? "page" : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${current ? "bg-[#0F766E] text-white" : "text-white/80 hover:bg-white/10"}`}>
                    <FontAwesomeIcon icon={link.icon} className="w-4" aria-hidden="true" />
                    <span className={collapsed ? "lg:sr-only" : undefined}>{link.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <form action={signOutAction} className="border-t border-white/10 p-3">
          <button className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-white/80 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" type="submit">
            <FontAwesomeIcon icon={faRightFromBracket} className="w-4" aria-hidden="true" />
            <span className={collapsed ? "lg:sr-only" : undefined}>Log Out</span>
          </button>
        </form>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="portal-navbar">
          <form className="portal-search" role="search" onSubmit={(event) => event.preventDefault()}>
            <FontAwesomeIcon icon={faMagnifyingGlass} aria-hidden="true" />
            <label className="sr-only" htmlFor="portal-search">
              Search doctors by name or specialty
            </label>
            <LiveSearchInput id="portal-search" destination="/patient/find" placeholder="Search doctors by name or specialty..." />
          </form>
          <div className="portal-navbar-end">
            <InstallApp systemName={systemName} />
            <NotificationBell unread={unread} href="/patient/notifications" items={notices} watch="patient" />
            <div className="portal-account" ref={accountRef}>
              <button
                type="button"
                className="portal-account-btn"
                aria-expanded={accountOpen}
                aria-haspopup="menu"
                onClick={() => setAccountPath(accountOpen ? null : pathname)}
              >
                <ProfilePhoto userId={userId} name={name} version={imageVersion} size={34} alt="" />
                <span className="portal-account-meta">
                  <strong>{name}</strong>
                  <span>Patient</span>
                </span>
                <FontAwesomeIcon icon={faChevronDown} className="portal-chevron" aria-hidden="true" />
              </button>
              {accountOpen ? (
                <div role="menu" className="portal-menu">
                  <div className="portal-menu-id">
                    <strong>{name}</strong>
                    <span>Patient</span>
                  </div>
                  <Link href="/patient/profile" role="menuitem" onClick={() => setAccountPath(null)}>
                    <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                    Profile
                  </Link>
                  <Link href="/patient/notifications" role="menuitem" onClick={() => setAccountPath(null)}>
                    <FontAwesomeIcon icon={faBell} aria-hidden="true" />
                    Notifications
                  </Link>
                  <Link href="/forgot-password" role="menuitem" onClick={() => setAccountPath(null)}>
                    <FontAwesomeIcon icon={faKey} aria-hidden="true" />
                    Reset password
                  </Link>
                  <form action={signOutAction}>
                    <button type="submit" role="menuitem">
                      <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
                      Log Out
                    </button>
                  </form>
                </div>
              ) : null}
            </div>
          </div>
        </header>
        <div className="patient-scroll-frame">
          <div ref={scrollRef} className="patient-scroll min-h-0 flex-1 overflow-y-auto">
            <main className="px-4 py-6 lg:px-8 lg:py-7">{children}</main>
          </div>
          <div ref={scrollThumbRef} className="patient-scroll-thumb" aria-hidden="true" />
        </div>
        <nav className="patient-tabbar" aria-label="Patient">
          {tabs.map((link) => {
            const current = link.href === active;
            return (
              <Link key={link.href} href={link.href} prefetch={false} aria-current={current ? "page" : undefined} onClick={() => setMorePath(null)}>
                <FontAwesomeIcon icon={link.icon} aria-hidden="true" />
                <span>{tabLabel[link.href as (typeof tabOrder)[number]]}</span>
              </Link>
            );
          })}
          <button type="button" className={moreCurrent || moreOpen ? "is-current" : undefined} aria-expanded={moreOpen} aria-controls="patient-more" onClick={() => setMorePath(moreOpen ? null : pathname)}>
            <FontAwesomeIcon icon={moreOpen ? faXmark : faBars} aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>
        {moreOpen ? (
          <>
            <button type="button" className="patient-more-backdrop" aria-label="Close more menu" onClick={() => setMorePath(null)} />
            <div id="patient-more" className="patient-more" role="dialog" aria-modal="true" aria-label="More">
              {moreLinks.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false} aria-current={link.href === active ? "page" : undefined} onClick={() => setMorePath(null)}>
                  <FontAwesomeIcon icon={link.icon} aria-hidden="true" />
                  {link.label}
                </Link>
              ))}
              <form action={signOutAction}>
                <button type="submit">
                  <FontAwesomeIcon icon={faRightFromBracket} aria-hidden="true" />
                  Log Out
                </button>
              </form>
            </div>
          </>
        ) : null}
        <PatientCallAlert />
        <PatientGuide />
      </div>
    </div>
  );
}
