"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { faBell, faChevronLeft } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { noticeStamp } from "@/lib/notifications/stamp";
import { markAllNotificationsReadAction, markViewedNotificationsAction } from "./actions";
import { armNoticeSound, playNoticeSound } from "./sound";
import "./bell.css";

export type BellItem = {
  id: string;
  title: string;
  href: string | null;
  read: boolean;
  preview?: string | null;
  when?: string;
};

type NoticeAudience = "patient" | "doctor" | "admin";

type NoticeSnapshot = { unread: number; items: BellItem[]; stamp: string };

function safeNoticeHref(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return null;
  return value;
}

function readPulse(value: unknown): NoticeSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { unread?: unknown; stamp?: unknown; items?: unknown };
  if (typeof row.unread !== "number" || !Number.isInteger(row.unread) || row.unread < 0) return null;
  if (typeof row.stamp !== "string" || !Array.isArray(row.items)) return null;
  const items: BellItem[] = [];
  for (const item of row.items.slice(0, 8)) {
    if (!item || typeof item !== "object") return null;
    const note = item as { id?: unknown; title?: unknown; href?: unknown; preview?: unknown; when?: unknown };
    if (typeof note.id !== "string" || typeof note.title !== "string") return null;
    items.push({
      id: note.id,
      title: note.title,
      href: safeNoticeHref(note.href),
      read: false,
      preview: typeof note.preview === "string" ? note.preview : null,
      when: typeof note.when === "string" ? note.when : undefined,
    });
  }
  const stamp = noticeStamp(row.unread, items.map((item) => item.id));
  if (row.stamp !== stamp) return null;
  return { unread: row.unread, items, stamp };
}

export function NotificationBell({
  unread,
  href,
  items,
  watch,
}: {
  unread: number;
  href: string;
  items: BellItem[];
  watch?: NoticeAudience;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const titleId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<{ top: number; right: number } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [cleared, setCleared] = useState(false);
  const [live, setLive] = useState<NoticeSnapshot | null>(null);
  const unreadRef = useRef(unread);
  const openedPayment = useRef(unread);
  const routerRef = useRef(router);
  routerRef.current = router;
  const serverStamp = noticeStamp(unread, items.map((item) => item.id));
  const serverStampRef = useRef(serverStamp);
  serverStampRef.current = serverStamp;
  const shown = live && live.stamp !== serverStamp ? live : null;
  const shownUnread = shown?.unread ?? unread;
  const shownItems = shown?.items ?? items;

  useEffect(() => {
    if (unreadRef.current === shownUnread) return;
    const increased = shownUnread > unreadRef.current;
    unreadRef.current = shownUnread;
    if (!increased) return;
    playNoticeSound();
    setCleared(false);
    setHidden(new Set());
  }, [shownUnread]);

  useEffect(() => {
    if (watch !== "admin") return;
    if (shownUnread <= openedPayment.current) {
      openedPayment.current = shownUnread;
      return;
    }
    openedPayment.current = shownUnread;
    const payment = shownItems[0];
    if (!payment?.href?.startsWith("/admin/payments/") || pathname === payment.href) return;
    router.push(payment.href);
  }, [watch, shownUnread, shownItems, pathname, router]);

  useEffect(() => {
    const arm = () => armNoticeSound();
    document.addEventListener("pointerdown", arm);
    document.addEventListener("keydown", arm);
    return () => {
      document.removeEventListener("pointerdown", arm);
      document.removeEventListener("keydown", arm);
    };
  }, []);

  useEffect(() => {
    if (!watch) return;
    let stop = false;
    let timer = 0;

    async function look() {
      if (stop || document.visibilityState === "hidden") return;
      try {
        const response = await fetch(`/api/notices/pulse?audience=${watch}`, { cache: "no-store" });
        if (!response.ok) return;
        const pulse = readPulse(await response.json());
        if (stop || !pulse) return;
        if (pulse.stamp === serverStampRef.current) {
          setLive(null);
          return;
        }
        setLive(pulse);
        routerRef.current.refresh();
      } catch {
        // The next check tries again.
      }
    }

    function schedule(delay: number) {
      timer = window.setTimeout(() => {
        void look().finally(() => {
          if (!stop) schedule(8000);
        });
      }, delay);
    }

    function onVisible() {
      if (document.visibilityState === "visible") void look();
    }

    schedule(1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [watch]);

  const visible = cleared ? [] : shownItems.filter((item) => !item.read && !hidden.has(item.id));
  const pending = shownItems.filter((item) => !item.read && hidden.has(item.id)).length;
  const badge = cleared ? 0 : Math.max(0, shownUnread - pending);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    function place() {
      const narrow = window.matchMedia("(max-width: 1023px)").matches;
      setSheet(narrow);
      const button = buttonRef.current;
      if (!button) return;
      const rect = button.getBoundingClientRect();
      setBox(narrow ? { top: 0, right: 0 } : { top: rect.bottom + 8, right: Math.max(8, window.innerWidth - rect.right) });
    }
    function onPointer(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    place();
    panelRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    if (window.matchMedia("(max-width: 1023px)").matches) document.body.style.overflow = "hidden";
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function hide(id: string) {
    setHidden((current) => {
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function restore(id: string) {
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  function readOne(item: BellItem, follow: boolean) {
    hide(item.id);
    void markViewedNotificationsAction([item.id]).then((result) => {
      if (!result.ok) {
        restore(item.id);
        return;
      }
      router.refresh();
      if (follow && item.href) {
        setOpen(false);
        router.push(item.href);
      }
    });
  }

  function readAll() {
    setCleared(true);
    void markAllNotificationsReadAction().then((result) => {
      if (!result.ok) {
        setCleared(false);
        return;
      }
      router.refresh();
    });
  }

  const label = badge > 0 ? `Notifications, ${badge} unread` : "Notifications, none unread";
  const panel = open && mounted && box ? createPortal(
    <div
      ref={panelRef}
      className={sheet ? "bell-panel is-sheet" : "bell-panel"}
      role="dialog"
      aria-modal={sheet}
      aria-labelledby={titleId}
      tabIndex={-1}
      style={sheet ? undefined : { top: box.top, right: box.right }}
    >
      {sheet ? (
        <header className="bell-screen-bar">
          <button type="button" className="bell-screen-back" aria-label="Back" onClick={() => setOpen(false)}>
            <FontAwesomeIcon icon={faChevronLeft} aria-hidden="true" />
          </button>
          <div>
            <h2 id={titleId}>Notifications</h2>
            <p>{badge === 0 ? "You're all caught up" : `${badge} unread`}</p>
          </div>
          {badge > 0 ? (
            <button type="button" className="bell-screen-mark" onClick={readAll}>Mark all</button>
          ) : (
            <span className="bell-screen-mark" />
          )}
        </header>
      ) : (
        <header className="bell-head">
          <div>
            <h2 id={titleId}>Notifications</h2>
            <p>{badge === 0 ? "None unread" : `${badge} unread`}</p>
          </div>
          {badge > 0 ? (
            <button type="button" onClick={readAll}>Mark all as read</button>
          ) : null}
        </header>
      )}
      {visible.length === 0 ? (
        sheet ? (
          <div className="bell-screen-empty">
            <FontAwesomeIcon icon={faBell} aria-hidden="true" />
            <p>No notifications yet</p>
            <span>New notices will show up here.</span>
          </div>
        ) : (
          <p className="bell-empty">No new notifications.</p>
        )
      ) : (
        <ul className={sheet ? "bell-list bell-screen-list" : "bell-list"}>
          {visible.map((item) => (
            <li key={item.id}>
              {sheet ? (
                <button type="button" className="bell-screen-open" onClick={() => readOne(item, true)}>
                  <span className="bell-dot" aria-hidden="true" />
                  <span className="bell-screen-copy">
                    <strong>{item.title}</strong>
                    {item.preview ? <span>{item.preview}</span> : null}
                  </span>
                  {item.when ? <time>{item.when}</time> : null}
                </button>
              ) : (
                <div className="bell-row">
                  <button type="button" className="bell-open" onClick={() => readOne(item, true)}>
                    <strong>{item.title}</strong>
                    {item.preview ? <span>{item.preview}</span> : null}
                    {item.when ? <time>{item.when}</time> : null}
                  </button>
                  <button type="button" className="bell-read" onClick={() => readOne(item, false)}>Mark read</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {badge > visible.length ? <p className="bell-more">{badge - visible.length} more in your inbox.</p> : null}
      <Link className="bell-all" href={href} onClick={() => setOpen(false)}>See all notifications</Link>
    </div>,
    document.body,
  ) : null;

  return (
    <div className="bell">
      <button
        ref={buttonRef}
        type="button"
        className="bell-button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
      >
        <FontAwesomeIcon icon={faBell} aria-hidden="true" />
        {badge > 0 ? <span className="bell-count">{badge > 99 ? "99+" : badge}</span> : null}
      </button>
      {panel}
    </div>
  );
}
