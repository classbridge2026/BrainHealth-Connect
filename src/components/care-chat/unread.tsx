"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type ChatUnreadState = {
  total: number;
  byPartner: Record<string, number>;
};

const ChatUnreadContext = createContext<ChatUnreadState>({ total: 0, byPartner: {} });

export function useChatUnread() {
  return useContext(ChatUnreadContext);
}

export function ChatCount({ count }: { count: number }) {
  if (count < 1) return null;
  return <b className="chat-nav-count">{count > 9 ? "9+" : count}</b>;
}

export function ChatUnreadProvider({
  side,
  children,
}: {
  side: "patient" | "doctor" | "admin";
  children: ReactNode;
}) {
  const [unread, setUnread] = useState<ChatUnreadState>({ total: 0, byPartner: {} });

  useEffect(() => {
    let stop = false;
    let busy = false;
    let timer = 0;
    async function pull() {
      if (stop || busy || document.visibilityState === "hidden") return false;
      busy = true;
      const started = Date.now();
      try {
        const response = await fetch(`/api/care-chat/unread?side=${side}`, { cache: "no-store" });
        const slow = !response.ok || Date.now() - started > 2_000;
        if (!response.ok || stop) return slow;
        const payload = (await response.json()) as { total?: number; byPartner?: Array<{ id: string; unread: number }> };
        const byPartner: Record<string, number> = {};
        for (const row of payload.byPartner ?? []) {
          if (row.id && row.unread > 0) byPartner[row.id] = row.unread;
        }
        if (!stop) setUnread({ total: Math.max(0, payload.total ?? 0), byPartner });
        return slow;
      } catch {
        return true;
      } finally {
        busy = false;
      }
    }
    function schedule(delay: number) {
      timer = window.setTimeout(() => {
        void pull().then((slow) => {
          if (!stop) schedule(slow ? 25_000 : 10_000);
        });
      }, delay);
    }
    void pull().then((slow) => {
      if (!stop) schedule(slow ? 25_000 : 10_000);
    });
    const onVisible = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop = true;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [side]);

  return <ChatUnreadContext.Provider value={unread}>{children}</ChatUnreadContext.Provider>;
}
