"use client";

import { useEffect, useState } from "react";
import { installOfflineSync } from "@/lib/offline/sync";

type Status = { offline: boolean; pending: number; failed: number; synced: boolean };

export function OfflineSync() {
  const [status, setStatus] = useState<Status>({ offline: false, pending: 0, failed: 0, synced: false });

  useEffect(() => {
    const uninstall = installOfflineSync((notice) => {
      setStatus(notice);
    });
    return uninstall;
  }, []);

  useEffect(() => {
    if (!status.synced) return;
    const timer = window.setTimeout(() => setStatus((current) => ({ ...current, synced: false })), 4000);
    return () => window.clearTimeout(timer);
  }, [status.synced]);

  const message = status.offline
    ? "You're offline. You can keep working. Changes will sync when the internet returns."
    : status.pending > 0
      ? "Syncing changes made offline…"
      : status.failed > 0
        ? "Some changes could not sync. Try them again while you are signed in."
        : status.synced
          ? "Changes made offline are saved."
          : "";
  if (!message) return null;
  return (
    <p className="offline-sync" role="status">
      {message}
    </p>
  );
}
