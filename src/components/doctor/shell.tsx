"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import {
  faBars,
  faCalendarCheck,
  faCalendarDays,
  faChevronDown,
  faClipboardCheck,
  faClock,
  faGaugeHigh,
  faKey,
  faMagnifyingGlass,
  faNotesMedical,
  faRightFromBracket,
  faUser,
  faUserDoctor,
  faUserShield,
  faUsers,
  faBell,
  faChevronLeft,
  faXmark,
  type IconDefinition,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { signOutAction } from "@/app/admin/account-actions";
import { CareCircleMark } from "@/components/brand";
import { LiveSearchInput } from "@/components/live-query";
import { NotificationBell, type BellItem } from "@/components/notifications/bell";
import { ProfilePhoto } from "@/components/profile-photo";
import { DoctorGuide } from "@/components/guide/doctor-guide";
import "../patient/patient-shell.css";

config.autoAddCss = false;

const links: Array<{ href: string; label: string; icon: IconDefinition; exact?: boolean }> = [
  { href: "/doctor", label: "Dashboard", icon: faGaugeHigh, exact: true },
  { href: "/doctor/appointments", label: "Appointments", icon: faCalendarDays },
  { href: "/doctor/patients", label: "Patients", icon: faUsers },
  { href: "/doctor/screening", label: "Screening Assessments", icon: faClipboardCheck },
  { href: "/doctor/availability", label: "Availability", icon: faClock },
  { href: "/doctor/notes", label: "Notes & Summaries", icon: faNotesMedical },
  { href: "/doctor/follow-ups", label: "Follow-ups", icon: faCalendarCheck },
  { href: "/doctor/notifications", label: "Notifications", icon: faBell },
  { href: "/doctor/profile", label: "Profile", icon: faUser },
];

function currentHref(pathname: string) {
  let best: string | null = null;
  for (const link of links) {
    const match = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
    if (match && (best === null || link.href.length > best.length)) best = link.href;
  }
  return best;
}

export function DoctorShell({
  userId,
  name,
  systemName,
  specialty,
  imageVersion,
  unread,
  notices,
  administration = false,
  children,
}: {
  userId: string;
  name: string;
  systemName: string;
  specialty: string;
  imageVersion: string | null;
  unread: number | null;
  notices: BellItem[];
  administration?: boolean;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = currentHref(pathname);
  const room = /\/appointments\/[^/]+\/consultation\/?$/.test(pathname);
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [accountPath, setAccountPath] = useState<string | null>(null);
  const accountRef = useRef<HTMLDivElement>(null);
  const open = openPath === pathname;
  const accountOpen = accountPath === pathname;
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPath(null);
        setAccountPath(null);
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

  const tabOrder = ["/doctor", "/doctor/appointments", "/doctor/patients", "/doctor/notes", "/doctor/profile"] as const;
  const tabLabel: Record<(typeof tabOrder)[number], string> = {
    "/doctor": "Home",
    "/doctor/appointments": "Schedule",
    "/doctor/patients": "Patients",
    "/doctor/notes": "Tasks",
    "/doctor/profile": "Profile",
  };

  return (
    <div className="doctor-app fixed inset-0 flex overflow-hidden bg-[#F3F8FC] text-[#10233c]">
      {open ? (
        <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-[#0C2B45]/40 lg:hidden" type="button" onClick={() => setOpenPath(null)} />
      ) : null}
      <aside
        id="doctor-navigation"
        data-no-busy=""
        className={`fixed inset-y-0 left-0 z-40 flex h-dvh w-[248px] shrink-0 flex-col bg-[#0C2B45] text-white transition-transform lg:static lg:translate-x-0 ${collapsed ? "lg:w-[76px]" : ""} ${open ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-2 px-3 py-4">
          <Link href="/doctor" className="flex min-w-0 items-center gap-3 px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
            <CareCircleMark className="h-10 w-10 bg-white" />
            <span className={`block max-w-[148px] text-[15px] leading-snug font-semibold ${collapsed ? "lg:sr-only" : ""}`}>{systemName}</span>
          </Link>
          <button type="button" className="hidden h-9 w-9 items-center justify-center rounded-lg text-white hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white lg:inline-flex" aria-pressed={collapsed} onClick={() => setCollapsed((value) => !value)}>
            <FontAwesomeIcon icon={faChevronLeft} className={collapsed ? "rotate-180" : ""} aria-hidden="true" />
            <span className="sr-only">{collapsed ? "Expand navigation" : "Collapse navigation"}</span>
          </button>
        </div>
        <nav aria-label="Doctor portal" className="min-h-0 flex-1 overflow-y-auto px-3">
          <ul className="grid gap-1">
            {links.map((link) => {
              const current = link.href === active;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    prefetch={false}
                    aria-current={current ? "page" : undefined}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white ${current ? "bg-[#0F766E] text-white" : "text-white/80 hover:bg-white/10"}`}
                  >
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
            <label className="sr-only" htmlFor="doctor-search">
              Search patients by name or ID
            </label>
            <LiveSearchInput id="doctor-search" destination="/doctor/patients" placeholder="Search patients by name or ID..." />
          </form>
          <div className="portal-navbar-end">
            <NotificationBell unread={unread ?? 0} href="/doctor/notifications" items={notices} watch="doctor" />
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
                  <span>{specialty}</span>
                </span>
                <FontAwesomeIcon icon={faChevronDown} className="portal-chevron" aria-hidden="true" />
              </button>
              {accountOpen ? (
                <div role="menu" className="portal-menu">
                  <div className="portal-menu-id">
                    <strong>{name}</strong>
                    <span>{specialty}</span>
                  </div>
                  {administration ? (
                    <Link href="/admin" role="menuitem" onClick={() => setAccountPath(null)}>
                      <FontAwesomeIcon icon={faUserShield} aria-hidden="true" />
                      Administration
                    </Link>
                  ) : null}
                  <Link href="/doctor/profile" role="menuitem" onClick={() => setAccountPath(null)}>
                    <FontAwesomeIcon icon={faUser} aria-hidden="true" />
                    Profile
                  </Link>
                  <Link href="/doctor/onboarding" role="menuitem" onClick={() => setAccountPath(null)}>
                    <FontAwesomeIcon icon={faUserDoctor} aria-hidden="true" />
                    Professional profile
                  </Link>
                  <Link href="/doctor/notifications" role="menuitem" onClick={() => setAccountPath(null)}>
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
        <div className={`min-h-0 w-full min-w-0 flex-1 ${room ? "flex flex-col overflow-hidden" : "doctor-scroll overflow-y-auto"}`}>
          <main className={room ? "flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden" : "w-full min-w-0 px-4 py-6 lg:px-8 lg:py-7"}>{children}</main>
        </div>
        {room || open ? null : (
          <nav className="patient-tabbar" aria-label="Doctor">
            {tabOrder.map((href) => {
              const link = links.find((item) => item.href === href);
              if (!link) return null;
              const current = href === active;
              return (
                <Link key={href} href={href} prefetch={false} aria-current={current ? "page" : undefined}>
                  <FontAwesomeIcon icon={link.icon} aria-hidden="true" />
                  <span>{tabLabel[href]}</span>
                </Link>
              );
            })}
            <button type="button" className={open ? "is-current" : undefined} aria-expanded={open} aria-controls="doctor-navigation" onClick={() => setOpenPath(open ? null : pathname)}>
              <FontAwesomeIcon icon={open ? faXmark : faBars} aria-hidden="true" />
              <span>More</span>
            </button>
          </nav>
        )}
        <DoctorGuide />
      </div>
    </div>
  );
}
