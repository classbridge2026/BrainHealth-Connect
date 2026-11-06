"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CareCircleMark } from "@/components/brand";
import { InstallApp } from "@/components/install-app";
import { LiveSearchInput } from "@/components/live-query";
import { NotificationBell, type BellItem } from "@/components/notifications/bell";
import { ProfilePhoto } from "@/components/profile-photo";
import { signOutAction } from "@/app/admin/account-actions";
import { claimChatDevice, forgetChatDevice } from "@/lib/care-chat/device-copy";
import { ChatCount, useChatUnread } from "@/components/care-chat/unread";
import { AdminNoticesContext } from "./admin-notices";
import { AdminIcon, type AdminIconName } from "./admin-icons";

const AdminGuide = dynamic(() => import("./admin-guide").then((mod) => mod.AdminGuide), { ssr: false });

type Item = { href: string; label: string; icon: AdminIconName; exact?: boolean };

const groups: Array<{ label: string; items: Item[] }> = [
  { label: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: "gauge", exact: true }] },
  {
    label: "People and access",
    items: [
      { href: "/admin/users", label: "All users", icon: "users" },
      { href: "/admin/messages", label: "Messages", icon: "messages" },
      { href: "/admin/patients", label: "Patients", icon: "patient" },
      { href: "/admin/doctors", label: "Doctors", icon: "doctor" },
      { href: "/admin/roles", label: "Administrators and roles", icon: "shield" },
      { href: "/admin/doctors/pending", label: "Doctor verification", icon: "verify" },
    ],
  },
  {
    label: "Healthcare configuration",
    items: [
      { href: "/admin/specialties", label: "Specialties", icon: "specialty" },
      { href: "/admin/services", label: "Consultation services", icon: "service" },
      { href: "/admin/offerings", label: "Doctor offerings", icon: "offering" },
      { href: "/admin/pricing", label: "Fees and pricing", icon: "fee" },
      { href: "/admin/locations", label: "Locations", icon: "location" },
      { href: "/admin/screening", label: "Screening management", icon: "screening" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/admin/appointments", label: "Appointments", icon: "calendar" },
      { href: "/admin/payments", label: "Payments", icon: "payment" },
      { href: "/admin/reconciliation", label: "Payment reconciliation", icon: "reconcile" },
      { href: "/admin/operations", label: "Operational issues", icon: "issue" },
      { href: "/admin/support", label: "Account support", icon: "guide" },
    ],
  },
  {
    label: "Platform management",
    items: [
      { href: "/admin/notifications", label: "Notifications", icon: "bell" },
      { href: "/admin/settings", label: "Platform settings", icon: "settings" },
      { href: "/admin/audit", label: "Audit logs", icon: "audit" },
      { href: "/admin/reports", label: "Reports and analytics", icon: "reports" },
    ],
  },
];

const titles: Array<{ href: string; title: string; exact?: boolean }> = [
  { href: "/admin", title: "Dashboard", exact: true },
  { href: "/admin/users", title: "All users" },
  { href: "/admin/messages", title: "Messages" },
  { href: "/admin/patients", title: "Patients" },
  { href: "/admin/doctors/new", title: "Add doctor" },
  { href: "/admin/doctors/pending", title: "Doctor verification" },
  { href: "/admin/doctors/invitations", title: "Doctor invitations" },
  { href: "/admin/doctors", title: "Doctors" },
  { href: "/admin/roles", title: "Administrators and roles" },
  { href: "/admin/specialties", title: "Specialties" },
  { href: "/admin/services", title: "Consultation services" },
  { href: "/admin/offerings", title: "Doctor offerings" },
  { href: "/admin/pricing", title: "Fees and pricing" },
  { href: "/admin/locations", title: "Locations" },
  { href: "/admin/screening", title: "Screening management" },
  { href: "/admin/configuration", title: "Catalog status" },
  { href: "/admin/appointments", title: "Appointments" },
  { href: "/admin/payments", title: "Payments" },
  { href: "/admin/reconciliation", title: "Payment reconciliation" },
  { href: "/admin/operations", title: "Operational issues" },
  { href: "/admin/support", title: "Account support" },
  { href: "/admin/profile", title: "Your photo" },
  { href: "/admin/notifications", title: "Notifications" },
  { href: "/admin/settings", title: "Platform settings" },
  { href: "/admin/audit", title: "Audit logs" },
  { href: "/admin/reports", title: "Reports and analytics" },
];

function matches(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function currentHref(pathname: string) {
  const items = groups.flatMap((group) => group.items);
  let best: string | null = null;
  for (const item of items) {
    if (matches(pathname, item.href, item.exact) && (best === null || item.href.length > best.length)) best = item.href;
  }
  return best;
}

function currentTitle(pathname: string) {
  const ordered = [...titles].sort((a, b) => b.href.length - a.href.length);
  return ordered.find((item) => matches(pathname, item.href, item.exact))?.title ?? "Administration";
}

const mobileTabs: Array<{ href: string; label: string; icon: AdminIconName; exact?: boolean }> = [
  { href: "/admin", label: "Home", icon: "gauge", exact: true },
  { href: "/admin/users", label: "Users", icon: "users" },
  { href: "/admin/appointments", label: "Visits", icon: "calendar" },
  { href: "/admin/payments", label: "Payments", icon: "payment" },
];

const searchRoutes = [
  "/admin/doctors/pending",
  "/admin/doctors",
  "/admin/patients",
  "/admin/users",
  "/admin/appointments",
  "/admin/payments",
  "/admin/locations",
  "/admin/services",
  "/admin/specialties",
  "/admin/offerings",
  "/admin/pricing",
  "/admin/audit",
  "/admin/notifications",
];

function searchAction(pathname: string) {
  return searchRoutes.find((href) => matches(pathname, href)) ?? "/admin/users";
}

export function AdminShell({
  userId,
  email,
  systemName,
  imageVersion,
  roleLabel,
  unreadNotifications,
  notices,
  children,
}: {
  userId: string;
  email: string;
  systemName: string;
  imageVersion: string | null;
  roleLabel: string;
  unreadNotifications: number | null;
  notices: BellItem[];
  children: ReactNode;
}) {
  const pathname = usePathname();
  const active = currentHref(pathname);
  const chatUnread = useChatUnread();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [accountPath, setAccountPath] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [wide, setWide] = useState(false);
  const accountRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pageThumbRef = useRef<HTMLDivElement>(null);
  const sideScrollRef = useRef<HTMLElement>(null);
  const sideThumbRef = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const open = openPath === pathname;
  const accountOpen = accountPath === pathname;
  const title = currentTitle(pathname);
  const tabCurrent = mobileTabs.some((tab) => matches(pathname, tab.href, tab.exact));

  useEffect(() => {
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    void claimChatDevice(userId);
  }, [userId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenPath(null);
        setAccountPath(null);
        setSearchOpen(false);
      }
    }
    function onPointer(event: MouseEvent) {
      if (accountRef.current && !accountRef.current.contains(event.target as Node)) setAccountPath(null);
    }
    const media = window.matchMedia("(min-width: 1024px)");
    const sync = () => {
      setWide(media.matches);
      if (media.matches) setOpenPath(null);
    };
    sync();
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    media.addEventListener("change", sync);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      media.removeEventListener("change", sync);
    };
  }, []);

  useEffect(() => {
    const pageThumb = pageThumbRef.current;
    const side = sideScrollRef.current;
    const sideThumb = sideThumbRef.current;
    if (!pageThumb || !side || !sideThumb) return;
    const root = document.documentElement;
    const media = window.matchMedia("(max-width: 1023px)");
    let pageTimer = 0;
    let sideTimer = 0;

    function place(scroller: HTMLElement, thumb: HTMLDivElement, top: number) {
      const maxScroll = scroller.scrollHeight - scroller.clientHeight;
      if (!media.matches || maxScroll <= 1) {
        thumb.classList.remove("is-visible");
        return;
      }
      const height = Math.max(36, (scroller.clientHeight / scroller.scrollHeight) * scroller.clientHeight);
      const offset = (top / maxScroll) * (scroller.clientHeight - height);
      thumb.style.height = `${height}px`;
      thumb.style.transform = `translateY(${offset}px)`;
      thumb.classList.add("is-visible");
    }

    function onPageScroll() {
      place(root, pageThumb!, window.scrollY);
      window.clearTimeout(pageTimer);
      pageTimer = window.setTimeout(() => pageThumb?.classList.remove("is-visible"), 700);
    }

    function onSideScroll() {
      place(side!, sideThumb!, side!.scrollTop);
      window.clearTimeout(sideTimer);
      sideTimer = window.setTimeout(() => sideThumb?.classList.remove("is-visible"), 700);
    }

    function apply() {
      root.classList.toggle("admin-mobile-scroll", media.matches);
      if (!media.matches) {
        pageThumb?.classList.remove("is-visible");
        sideThumb?.classList.remove("is-visible");
      }
    }

    apply();
    window.addEventListener("scroll", onPageScroll, { passive: true });
    side.addEventListener("scroll", onSideScroll, { passive: true });
    media.addEventListener("change", apply);
    return () => {
      window.removeEventListener("scroll", onPageScroll);
      side.removeEventListener("scroll", onSideScroll);
      media.removeEventListener("change", apply);
      window.clearTimeout(pageTimer);
      window.clearTimeout(sideTimer);
      root.classList.remove("admin-mobile-scroll");
      pageThumb.classList.remove("is-visible");
      sideThumb.classList.remove("is-visible");
    };
  }, []);

  function toggleNavigation() {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      setCollapsed((value) => !value);
      return;
    }
    setOpenPath(open ? null : pathname);
  }

  return (
    <AdminNoticesContext.Provider value={{ unread: unreadNotifications ?? 0, notices }}>
    <div className="admin-app">
      <header className="admin-navbar">
        <div className="admin-navbar-start">
          <button
            type="button"
            className="admin-icon-btn admin-nav-toggle"
            aria-expanded={wide ? !collapsed : open}
            aria-controls="admin-navigation"
            onClick={toggleNavigation}
          >
            <AdminIcon name={!wide && open ? "close" : "menu"} />
            <span className="sr-only">{wide ? (collapsed ? "Expand navigation" : "Collapse navigation") : open ? "Close navigation" : "Open navigation"}</span>
          </button>
          <Link href="/admin" className="admin-navbar-brand">
            <CareCircleMark className="h-9 w-9 bg-white" />
            <span className="admin-navbar-brand-copy">
              <strong>{systemName}</strong>
              <span>Administration</span>
            </span>
          </Link>
          <span className="admin-navbar-divider" aria-hidden="true" />
          <div className="admin-navbar-title">
            <p className="admin-navbar-kicker">{systemName}</p>
            <p className="admin-navbar-heading">{title}</p>
          </div>
        </div>
        <form className={`admin-search${searchOpen ? " is-open" : ""}`} role="search" onSubmit={(event) => event.preventDefault()}>
          <AdminIcon name="search" />
          <label className="sr-only" htmlFor="admin-search">
            Search patients, doctors, or appointments
          </label>
          <LiveSearchInput
            ref={searchRef}
            id="admin-search"
            destination={searchAction(pathname)}
            placeholder="Search patients, doctors, or appointments..."
          />
          <button
            type="button"
            className="admin-search-dismiss"
            onClick={() => setSearchOpen(false)}
          >
            <AdminIcon name="close" />
            <span className="sr-only">Close search</span>
          </button>
        </form>
        <div className="admin-navbar-end">
          <button
            type="button"
            className="admin-icon-btn admin-search-toggle"
            aria-expanded={searchOpen}
            aria-controls="admin-search"
            onClick={() => {
              setSearchOpen(true);
              window.setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            <AdminIcon name="search" />
            <span className="sr-only">Open search</span>
          </button>
          <InstallApp systemName={systemName} />
          <NotificationBell unread={unreadNotifications ?? 0} href="/admin/notifications" items={notices} watch="admin" />
          <div className="admin-account" ref={accountRef}>
            <button
              type="button"
              className="admin-account-btn"
              aria-expanded={accountOpen}
              aria-haspopup="menu"
              onClick={() => setAccountPath(accountOpen ? null : pathname)}
            >
              <ProfilePhoto userId={userId} name={email} version={imageVersion} size={34} />
              <span className="admin-account-meta">
                <strong>{email}</strong>
                <span>{roleLabel}</span>
              </span>
              <AdminIcon name="chevron" className="admin-chevron" />
            </button>
            {accountOpen ? (
              <div role="menu" className="admin-menu">
                <div className="admin-menu-id">
                  <strong>{email}</strong>
                  <span>{roleLabel}</span>
                </div>
                <Link href="/doctor" role="menuitem" onClick={() => setAccountPath(null)}>
                  <AdminIcon name="doctor" />
                  Doctor workspace
                </Link>
                <Link href="/admin/profile" role="menuitem" onClick={() => setAccountPath(null)}>
                  <AdminIcon name="view" />
                  Your photo
                </Link>
                <Link href="/admin/notifications" role="menuitem" onClick={() => setAccountPath(null)}>
                  <AdminIcon name="bell" />
                  Notifications
                </Link>
                <Link href="/admin/settings" role="menuitem" onClick={() => setAccountPath(null)}>
                  <AdminIcon name="settings" />
                  Platform settings
                </Link>
                <form action={signOutAction} onSubmit={() => { void forgetChatDevice(userId); }}>
                  <button type="submit" role="menuitem">
                    <AdminIcon name="signOut" />
                    Sign out
                  </button>
                </form>
              </div>
            ) : null}
          </div>
        </div>
      </header>
      {open ? (
        <button aria-label="Close navigation" className="admin-backdrop lg:hidden" type="button" onClick={() => setOpenPath(null)} />
      ) : null}
      <div className="admin-frame">
        <aside id="admin-navigation" data-no-busy="" className={`admin-sidebar${open ? " is-open" : ""}${collapsed ? " is-collapsed" : ""}`} aria-label="Administration">
          <nav ref={sideScrollRef} className="admin-sidebar-scroll">
            {groups.map((group) => (
              <div key={group.label} className="admin-nav-group">
                <p className="admin-nav-label">{group.label}</p>
                <ul className="admin-nav-list">
                  {group.items.map((item) => {
                    const current = item.href === active;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          aria-current={current ? "page" : undefined}
                          title={item.label}
                          className="admin-nav-link"
                          onClick={() => setOpenPath(null)}
                        >
                          <AdminIcon name={item.icon} />
                          <span className="admin-nav-text">{item.label}</span>
                          {item.href === "/admin/messages" ? <ChatCount count={chatUnread.total} /> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
          <div ref={sideThumbRef} className="admin-scroll-thumb admin-side-thumb" aria-hidden="true" />
        </aside>
        <div className="admin-content">{children}</div>
      </div>
      <nav className="admin-tabbar" aria-label="Administration" data-no-busy="">
        {mobileTabs.map((tab) => {
          const current = matches(pathname, tab.href, tab.exact);
          return (
            <Link key={tab.href} href={tab.href} prefetch={false} aria-current={current ? "page" : undefined} onClick={() => setOpenPath(null)}>
              <AdminIcon name={tab.icon} />
              <span>{tab.label}</span>
            </Link>
          );
        })}
        <button type="button" className={!tabCurrent || open ? "is-current" : undefined} aria-expanded={open} aria-controls="admin-navigation" onClick={toggleNavigation}>
          <AdminIcon name={open ? "close" : "menu"} />
          <span>More</span>
        </button>
      </nav>
      <div ref={pageThumbRef} className="admin-scroll-thumb admin-page-thumb" aria-hidden="true" />
      <AdminGuide superAdmin={roleLabel === "Super administrator"} systemName={systemName} />
    </div>
    </AdminNoticesContext.Provider>
  );
}
