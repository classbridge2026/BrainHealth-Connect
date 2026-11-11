import { useSyncExternalStore } from "react";
import { isIosInstallTarget, isStandaloneDisplay } from "./prompt";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export type InstallSnapshot = {
  ready: boolean;
  standalone: boolean;
  ios: boolean;
  canPrompt: boolean;
};

const serverSnapshot: InstallSnapshot = {
  ready: false,
  standalone: false,
  ios: false,
  canPrompt: false,
};

let snapshot: InstallSnapshot = serverSnapshot;
let deferred: BeforeInstallPromptEvent | null = null;
let listening = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function publish(next: InstallSnapshot) {
  if (
    snapshot.ready === next.ready &&
    snapshot.standalone === next.standalone &&
    snapshot.ios === next.ios &&
    snapshot.canPrompt === next.canPrompt
  ) {
    return;
  }
  snapshot = next;
  emit();
}

export function getInstallSnapshot() {
  return snapshot;
}

export function getServerInstallSnapshot() {
  return serverSnapshot;
}

export function subscribeInstall(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function refreshInstallSnapshot() {
  if (typeof window === "undefined") return;
  const nav = navigator as Navigator & { standalone?: boolean };
  const displayModeStandalone = typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches;
  publish({
    ready: true,
    standalone: isStandaloneDisplay({
      displayModeStandalone,
      navigatorStandalone: nav.standalone,
    }),
    ios: isIosInstallTarget(navigator.userAgent, navigator.maxTouchPoints, navigator.platform),
    canPrompt: deferred !== null,
  });
}

export function bindInstallPrompt() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    refreshInstallSnapshot();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    refreshInstallSnapshot();
  });
  if (typeof window.matchMedia === "function") {
    window.matchMedia("(display-mode: standalone)").addEventListener("change", () => refreshInstallSnapshot());
  }
}

export async function shareInstall(title: string) {
  if (typeof navigator.share !== "function") return "unavailable" as const;
  try {
    await navigator.share({ title, url: `${window.location.origin}/` });
    return "shared" as const;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return "dismissed" as const;
    return "unavailable" as const;
  }
}

export async function promptInstall() {
  const event = deferred;
  if (!event) return "unavailable" as const;
  deferred = null;
  refreshInstallSnapshot();
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  } catch {
    return "unavailable" as const;
  }
}

export function useInstallState() {
  return useSyncExternalStore(subscribeInstall, getInstallSnapshot, getServerInstallSnapshot);
}
