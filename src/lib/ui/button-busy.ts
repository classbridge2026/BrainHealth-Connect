export type ButtonBusyOptions = {
  signalGraceMs?: number;
  minVisibleMs?: number;
  maxVisibleMs?: number;
  pollMs?: number;
};

type RequestKind = "action" | "navigation";

type Watch = {
  control: HTMLElement;
  baselineSeq: number;
  baselineNav: number;
  confirmed: boolean;
  plainNavigation: boolean;
  owned: Map<number, RequestKind>;
  shownAt: number;
  startedAt: number;
  sawDisabled: boolean;
  stopped: boolean;
};

const defaults = {
  signalGraceMs: 300,
  minVisibleMs: 400,
  maxVisibleMs: 60_000,
  pollMs: 32,
};

function timingOf(options?: ButtonBusyOptions) {
  return {
    signalGraceMs: options?.signalGraceMs ?? defaults.signalGraceMs,
    minVisibleMs: options?.minVisibleMs ?? defaults.minVisibleMs,
    maxVisibleMs: options?.maxVisibleMs ?? defaults.maxVisibleMs,
    pollMs: options?.pollMs ?? defaults.pollMs,
  };
}

function headerBag(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.headers) return new Headers(init.headers);
  if (typeof Request !== "undefined" && input instanceof Request) return new Headers(input.headers);
  return new Headers();
}

function methodOf(input: RequestInfo | URL, init?: RequestInit) {
  if (init?.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) return input.method.toUpperCase();
  return "GET";
}

function classify(input: RequestInfo | URL, init?: RequestInit): RequestKind | null {
  const headers = headerBag(input, init);
  if (headers.has("next-router-prefetch") || headers.has("next-router-segment-prefetch") || headers.has("next-hmr-refresh")) {
    return null;
  }
  if (headers.has("next-action")) return "action";
  const method = methodOf(input, init);
  if (method !== "GET" && method !== "HEAD") return "action";
  const accept = headers.get("accept") ?? "";
  if (headers.has("rsc") || accept.includes("text/x-component")) return "navigation";
  return null;
}

function findControl(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const button = target.closest("button, input[type='submit'], input[type='button']");
  if (button instanceof HTMLButtonElement) {
    if (button.type === "reset" || button.closest("[data-no-busy]")) return null;
    return button;
  }
  if (button instanceof HTMLInputElement) {
    if (button.closest("[data-no-busy]")) return null;
    return button;
  }
  const link = target.closest("a[href]");
  if (!(link instanceof HTMLAnchorElement) || link.closest("[data-no-busy]")) return null;
  if (link.target === "_blank" || link.hasAttribute("download")) return null;
  const href = link.getAttribute("href") ?? "";
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) return null;
  return link;
}

function isDisabled(control: HTMLElement) {
  return (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) && control.disabled;
}

const spinnerSize = 14;
const spinnerGap = 6;
const spinnerInset = 4;

function spinnerColor(control: HTMLElement) {
  const color = getComputedStyle(control).color;
  if (!color || color === "transparent" || color === "rgba(0, 0, 0, 0)") return "#12304a";
  return color;
}

function labelEdges(control: HTMLElement) {
  const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT);
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let found = false;
  while (walker.nextNode()) {
    if (!walker.currentNode.textContent?.trim()) continue;
    const range = document.createRange();
    range.selectNodeContents(walker.currentNode);
    const rect = range.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    found = true;
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
  }
  return found ? { left, right } : null;
}

function placeSpinner(control: HTMLElement) {
  const box = control.getBoundingClientRect();
  if (box.width < spinnerSize || box.height < spinnerSize) return;
  const style = getComputedStyle(control);
  const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0;
  const borderRight = Number.parseFloat(style.borderRightWidth) || 0;
  const edges = labelEdges(control);
  const contentLeft = edges?.left ?? box.left + borderLeft;
  const contentRight = edges?.right ?? box.right - borderRight;
  const roomLeft = contentLeft - box.left - borderLeft;
  const roomRight = box.right - borderRight - contentRight;
  const needed = spinnerSize + spinnerGap + spinnerInset;
  const besideLeft = roomLeft - spinnerGap - spinnerSize;
  const besideRight = contentRight - box.left - borderLeft + spinnerGap;
  const x = roomRight >= needed && roomRight >= roomLeft ? besideRight : besideLeft;
  control.style.setProperty("--btn-spinner-x", `${Math.round(x)}px`);
}

function show(control: HTMLElement) {
  if (control.getAttribute("data-loading") === "true") return;
  control.style.setProperty("--btn-spinner", spinnerColor(control));
  if (getComputedStyle(control).position === "static") control.setAttribute("data-loading-anchor", "static");
  placeSpinner(control);
  if (!control.hasAttribute("aria-busy")) control.setAttribute("data-loading-busy", "owned");
  control.setAttribute("aria-busy", "true");
  control.setAttribute("data-loading", "true");
  requestAnimationFrame(() => {
    if (control.getAttribute("data-loading") === "true") placeSpinner(control);
  });
}

function hide(control: HTMLElement) {
  control.removeAttribute("data-loading");
  control.removeAttribute("data-loading-anchor");
  control.style.removeProperty("--btn-spinner");
  control.style.removeProperty("--btn-spinner-x");
  if (control.getAttribute("data-loading-busy") === "owned") {
    control.removeAttribute("aria-busy");
    control.removeAttribute("data-loading-busy");
  }
}

let notifyNavigation = () => {};

export function notifyButtonBusyNavigation() {
  notifyNavigation();
}

function submitterFrom(event: SubmitEvent) {
  if (event.submitter instanceof HTMLElement) return event.submitter;
  if (!(event.target instanceof HTMLFormElement)) return null;
  const found = event.target.querySelector("button[type='submit'], button:not([type]), input[type='submit']");
  return found instanceof HTMLElement ? found : null;
}

/**
 * Shows the dual-ring spinner on buttons and links while the click is still working:
 * a submit, a disabled/pending control, a POST or server action, or a page navigation.
 * Clicks that only toggle something on the page do not keep the spinner.
 */
export function installButtonBusy(doc: Document = document, options?: ButtonBusyOptions) {
  const timing = timingOf(options);
  const recent: Array<{ id: number; kind: RequestKind }> = [];
  const inflight = new Set<number>();
  const failedNav = new Set<number>();
  const watches = new Map<HTMLElement, Watch>();
  let seq = 0;
  let navVersion = 0;
  let pollTimer = 0;
  let staged: { seq: number; nav: number } | null = null;

  const originalFetch = window.fetch.bind(window);
  const originalPush = history.pushState.bind(history);
  const originalReplace = history.replaceState.bind(history);

  function track(kind: RequestKind, promise: Promise<Response>) {
    const id = ++seq;
    recent.push({ id, kind });
    if (recent.length > 80) recent.shift();
    inflight.add(id);
    promise.then(
      (response) => {
        inflight.delete(id);
        if (kind === "navigation" && !response.ok) failedNav.add(id);
        pump();
      },
      () => {
        inflight.delete(id);
        if (kind === "navigation") failedNav.add(id);
        pump();
      },
    );
  }

  function patchedFetch(input: RequestInfo | URL, init?: RequestInit) {
    const kind = classify(input, init);
    const result = originalFetch(input, init);
    if (kind) track(kind, result);
    return result;
  }

  function pump() {
    for (const watch of [...watches.values()]) {
      if (watch.stopped) continue;
      if (evaluate(watch) === "stop") finish(watch);
    }
    if (watches.size === 0 && pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
  }

  function ensurePoll() {
    if (pollTimer) return;
    pollTimer = window.setInterval(pump, timing.pollMs);
  }

  function evaluate(watch: Watch): "continue" | "stop" {
    const { control } = watch;
    if (!control.isConnected) return "stop";
    const now = Date.now();
    if (now - watch.startedAt <= timing.signalGraceMs) {
      for (const item of recent) {
        if (item.id > watch.baselineSeq) watch.owned.set(item.id, item.kind);
      }
    }

    const disabled = isDisabled(control);
    if (disabled) watch.sawDisabled = true;
    const navigated = navVersion > watch.baselineNav;
    const fetchesOpen = [...watch.owned.keys()].some((id) => inflight.has(id));
    const navIds = [...watch.owned.entries()].filter(([, kind]) => kind === "navigation").map(([id]) => id);
    const navFailed = navIds.length > 0 && navIds.every((id) => failedNav.has(id));
    const waitingForNav = watch.plainNavigation ? !navigated : navIds.length > 0 && !navFailed && !navigated;
    const worked = watch.owned.size > 0 || watch.sawDisabled || navigated || watch.plainNavigation;
    const graceOver = now - watch.startedAt > timing.signalGraceMs;

    if (!watch.shownAt) {
      const signal = disabled || watch.owned.size > 0 || navigated || watch.plainNavigation || (watch.confirmed && !graceOver);
      if (!signal) return graceOver ? "stop" : "continue";
      show(control);
      watch.shownAt = now;
    } else if (control.getAttribute("data-loading") !== "true") {
      show(control);
    }

    if (now - watch.shownAt >= timing.maxVisibleMs) return "stop";
    if (!worked && graceOver) return "stop";
    const busy = disabled || fetchesOpen || waitingForNav;
    if (!busy && now - watch.shownAt >= timing.minVisibleMs) return "stop";
    return "continue";
  }

  function finish(watch: Watch) {
    if (watch.stopped) return;
    watch.stopped = true;
    watches.delete(watch.control);
    hide(watch.control);
  }

  function noteNavigation() {
    navVersion += 1;
    pump();
  }

  notifyNavigation = noteNavigation;

  function watchControl(control: HTMLElement, baseline: { seq: number; nav: number }, flags?: { confirmed?: boolean; plainNavigation?: boolean }) {
    const existing = watches.get(control);
    if (existing && !existing.stopped) {
      existing.confirmed = existing.confirmed || Boolean(flags?.confirmed);
      existing.plainNavigation = existing.plainNavigation || Boolean(flags?.plainNavigation);
      if (evaluate(existing) === "stop") finish(existing);
      return;
    }
    const watch: Watch = {
      control,
      baselineSeq: baseline.seq,
      baselineNav: baseline.nav,
      confirmed: Boolean(flags?.confirmed),
      plainNavigation: Boolean(flags?.plainNavigation),
      owned: new Map(),
      shownAt: 0,
      startedAt: Date.now(),
      sawDisabled: false,
      stopped: false,
    };
    watches.set(control, watch);
    ensurePoll();
    window.setTimeout(pump, 0);
    if (evaluate(watch) === "stop") finish(watch);
  }

  function stage() {
    staged = { seq, nav: navVersion };
  }

  function onClickCapture(event: Event) {
    const control = findControl(event.target);
    if (!control || control.getAttribute("data-loading") !== "true") return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onClick(event: MouseEvent) {
    const baseline = staged ?? { seq, nav: navVersion };
    staged = null;
    const control = findControl(event.target);
    if (!control || control.getAttribute("data-loading") === "true" || control.getAttribute("aria-disabled") === "true") return;
    if (control instanceof HTMLAnchorElement && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return;
    const plainNavigation = control instanceof HTMLAnchorElement && !event.defaultPrevented;
    watchControl(control, baseline, { plainNavigation });
  }

  function onSubmit(event: SubmitEvent) {
    const baseline = staged ?? { seq, nav: navVersion };
    staged = null;
    const control = submitterFrom(event);
    if (!control || control.getAttribute("data-loading") === "true" || isDisabled(control)) return;
    // React prevents the browser submit for server actions after the request has started.
    if (event.defaultPrevented && seq === baseline.seq) return;
    watchControl(control, baseline, { confirmed: true });
  }

  function patchedPush(data: unknown, unused: string, url?: string | URL | null) {
    const before = `${location.pathname}${location.search}`;
    originalPush(data, unused, url);
    if (`${location.pathname}${location.search}` !== before) noteNavigation();
  }

  function patchedReplace(data: unknown, unused: string, url?: string | URL | null) {
    const before = `${location.pathname}${location.search}`;
    originalReplace(data, unused, url);
    if (`${location.pathname}${location.search}` !== before) noteNavigation();
  }

  window.fetch = patchedFetch;
  history.pushState = patchedPush;
  history.replaceState = patchedReplace;
  doc.addEventListener("click", stage, true);
  doc.addEventListener("submit", stage, true);
  doc.addEventListener("click", onClickCapture, true);
  doc.addEventListener("click", onClick);
  doc.addEventListener("submit", onSubmit);
  function clearAll() {
    for (const watch of [...watches.values()]) finish(watch);
  }

  window.addEventListener("pagehide", clearAll);

  return function uninstall() {
    doc.removeEventListener("click", stage, true);
    doc.removeEventListener("submit", stage, true);
    doc.removeEventListener("click", onClickCapture, true);
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("submit", onSubmit);
    window.removeEventListener("pagehide", clearAll);
    if (pollTimer) window.clearInterval(pollTimer);
    for (const watch of [...watches.values()]) finish(watch);
    if (window.fetch === patchedFetch) window.fetch = originalFetch;
    if (history.pushState === patchedPush) history.pushState = originalPush;
    if (history.replaceState === patchedReplace) history.replaceState = originalReplace;
    if (notifyNavigation === noteNavigation) notifyNavigation = () => {};
  };
}
