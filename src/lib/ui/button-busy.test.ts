/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from "vitest";
import { installButtonBusy } from "@/lib/ui/button-busy";

const fast = { signalGraceMs: 40, minVisibleMs: 20, maxVisibleMs: 500, pollMs: 10 };

let uninstall = () => {};

afterEach(() => {
  uninstall();
  uninstall = () => {};
  document.body.replaceChildren();
});

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

describe("button busy spinner", () => {
  it("does not spin links or buttons inside navigation marked data-no-busy", async () => {
    window.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    uninstall = installButtonBusy(document, fast);
    const nav = document.createElement("nav");
    nav.setAttribute("data-no-busy", "");
    const link = document.createElement("a");
    link.href = "/patient";
    link.textContent = "Appointments";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void window.fetch("/patient", { headers: { rsc: "1" } });
    });
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Log Out";
    nav.append(link, button);
    document.body.append(nav);

    link.click();
    button.click();
    await delay(70);

    expect(link.hasAttribute("data-loading")).toBe(false);
    expect(button.hasAttribute("data-loading")).toBe(false);
  });

  it("leaves a button alone when the click does not start work", async () => {
    uninstall = installButtonBusy(document, fast);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Open menu";
    document.body.append(button);

    button.click();
    await delay(70);

    expect(button.hasAttribute("data-loading")).toBe(false);
  });

  it("shows the spinner while a clicked button is disabled, then clears it", async () => {
    uninstall = installButtonBusy(document, fast);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Save";
    button.addEventListener("click", () => {
      button.disabled = true;
    });
    document.body.append(button);

    button.click();
    expect(button.getAttribute("data-loading")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");

    button.disabled = false;
    await delay(50);

    expect(button.hasAttribute("data-loading")).toBe(false);
    expect(button.hasAttribute("aria-busy")).toBe(false);
  });

  it("shows the spinner for a POST and ignores ordinary GET requests", async () => {
    let release = (_value: Response) => {};
    window.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => new Promise<Response>((resolve) => {
      release = resolve;
    })) as typeof fetch;
    uninstall = installButtonBusy(document, fast);

    const poll = document.createElement("button");
    poll.type = "button";
    poll.textContent = "Refresh";
    poll.addEventListener("click", () => {
      void window.fetch("/api/patient/consultation-calls");
    });
    document.body.append(poll);
    poll.click();
    await delay(70);
    expect(poll.hasAttribute("data-loading")).toBe(false);

    const save = document.createElement("button");
    save.type = "button";
    save.textContent = "Save";
    save.addEventListener("click", () => {
      void window.fetch("/save", { method: "POST" });
    });
    document.body.append(save);
    save.click();
    expect(save.getAttribute("data-loading")).toBe("true");

    release(new Response("ok"));
    await delay(50);
    expect(save.hasAttribute("data-loading")).toBe(false);
  });

  it("does not spin a link or a button that only opens a page, and ignores prefetches", async () => {
    window.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    uninstall = installButtonBusy(document, fast);

    const prefetch = document.createElement("button");
    prefetch.type = "button";
    prefetch.textContent = "Hover";
    prefetch.addEventListener("click", () => {
      void window.fetch("/patient", { headers: { rsc: "1", "next-router-prefetch": "1" } });
    });
    document.body.append(prefetch);
    prefetch.click();
    await delay(70);
    expect(prefetch.hasAttribute("data-loading")).toBe(false);

    const link = document.createElement("a");
    link.href = "/patient";
    link.textContent = "Patient portal";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      void window.fetch("/patient", { headers: { rsc: "1", accept: "text/x-component" } });
    });
    document.body.append(link);
    link.click();
    await delay(70);
    expect(link.hasAttribute("data-loading")).toBe(false);

    const open = document.createElement("button");
    open.type = "button";
    open.textContent = "Open record";
    open.addEventListener("click", () => {
      void window.fetch("/patient/appointments", { headers: { rsc: "1", accept: "text/x-component" } });
    });
    document.body.append(open);
    open.click();
    await delay(70);
    expect(open.hasAttribute("data-loading")).toBe(false);
  });

  it("shows the spinner when a server action prevents the browser submit", () => {
    window.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    uninstall = installButtonBusy(document, fast);
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Login";
    form.append(button);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void window.fetch("/login", { method: "POST", headers: { "next-action": "abc" } });
    });
    document.body.append(form);

    button.click();

    expect(button.getAttribute("data-loading")).toBe("true");
  });

  it("does not spin when a form submit is cancelled", async () => {
    uninstall = installButtonBusy(document, fast);
    const form = document.createElement("form");
    const button = document.createElement("button");
    button.type = "submit";
    button.textContent = "Create account";
    form.append(button);
    form.addEventListener("submit", (event) => event.preventDefault());
    document.body.append(form);

    button.click();
    await delay(70);

    expect(button.hasAttribute("data-loading")).toBe(false);
  });

  it("places the spinner beside the label without moving the label", async () => {
    window.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    uninstall = installButtonBusy(document, fast);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Save offering";
    button.getBoundingClientRect = () =>
      ({ x: 0, y: 0, top: 0, left: 0, right: 280, bottom: 48, width: 280, height: 48, toJSON() { return {}; } }) as DOMRect;
    const originalRange = document.createRange.bind(document);
    document.createRange = () => ({
      selectNodeContents() {},
      getBoundingClientRect: () =>
        ({ x: 90, y: 14, top: 14, left: 90, right: 190, bottom: 34, width: 100, height: 20, toJSON() { return {}; } }) as DOMRect,
    }) as unknown as Range;
    button.addEventListener("click", () => {
      void window.fetch("/save", { method: "POST" });
    });
    document.body.append(button);

    button.click();
    await delay(40);

    document.createRange = originalRange;
    expect(button.textContent).toBe("Save offering");
    expect(button.style.getPropertyValue("--btn-spinner-x")).toBe("196px");
  });

  it("ignores a second click while the spinner is showing", async () => {
    window.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
    uninstall = installButtonBusy(document, fast);
    let runs = 0;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Save";
    button.addEventListener("click", () => {
      runs += 1;
      void window.fetch("/save", { method: "POST" });
    });
    document.body.append(button);

    button.click();
    button.click();

    expect(runs).toBe(1);
    expect(button.getAttribute("data-loading")).toBe("true");
  });
});
