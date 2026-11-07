"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isPortalPath, pageHref, type PageHere } from "@/lib/ui/instant-open";

const freshFor = 25_000;
const warmedAt = new Map<string, number>();

function here(): PageHere {
  return { origin: location.origin, pathname: location.pathname, search: location.search };
}

function fresh(href: string) {
  const at = warmedAt.get(href);
  return at !== undefined && Date.now() - at < freshFor;
}

export function InstantOpen() {
  const router = useRouter();

  useEffect(() => {
    const prefetch = router.prefetch as (href: string, options?: { kind?: "auto" | "full" }) => void;

    function warm(href: string | null) {
      if (!href || fresh(href)) return;
      warmedAt.set(href, Date.now());
      prefetch(href, { kind: "full" });
    }

    function targetHref(event: Event) {
      if (!(event.target instanceof Element)) return null;
      const link = event.target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return null;
      if (link.target === "_blank" || link.hasAttribute("download")) return null;
      return pageHref(link.href, here());
    }

    let hoverTimer = 0;
    function onOver(event: PointerEvent) {
      window.clearTimeout(hoverTimer);
      const href = targetHref(event);
      if (!href) return;
      hoverTimer = window.setTimeout(() => warm(href), 60);
    }
    function onLeave() {
      window.clearTimeout(hoverTimer);
    }
    function onDown(event: Event) {
      window.clearTimeout(hoverTimer);
      warm(targetHref(event));
    }

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerout", onLeave);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("focusin", onDown);

    let queueTimer = 0;
    const startTimer = window.setTimeout(() => {
      if (!isPortalPath(location.pathname)) return;
      const place = here();
      const seen = new Set<string>();
      const queue: string[] = [];
      const nodes = document.querySelectorAll(".patient-tabbar a[href], .admin-tabbar a[href], nav a[href]");
      nodes.forEach((node) => {
        if (!(node instanceof HTMLAnchorElement) || queue.length >= 6) return;
        const href = pageHref(node.href, place);
        if (!href || seen.has(href)) return;
        seen.add(href);
        queue.push(href);
      });
      const pump = () => {
        const href = queue.shift();
        if (!href) return;
        warm(href);
        queueTimer = window.setTimeout(pump, 2500);
      };
      pump();
    }, 2000);

    return () => {
      window.clearTimeout(hoverTimer);
      window.clearTimeout(startTimer);
      window.clearTimeout(queueTimer);
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerout", onLeave);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("focusin", onDown);
    };
  }, [router]);

  return null;
}
