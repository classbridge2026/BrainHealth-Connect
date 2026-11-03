export function installShortName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 12) return trimmed;
  const first = trimmed.split(" ")[0] ?? trimmed;
  if (first.length >= 2 && first.length <= 12) return first;
  return trimmed.slice(0, 12).trim();
}

export function isStandaloneDisplay(input: {
  displayModeStandalone: boolean;
  navigatorStandalone?: boolean;
}): boolean {
  return input.displayModeStandalone || input.navigatorStandalone === true;
}

/** iPhone, iPad, and iPadOS devices that report themselves as a Mac. */
export function isIosInstallTarget(userAgent: string, maxTouchPoints = 0, platform = ""): boolean {
  if (/android/i.test(userAgent)) return false;
  if (/iphone|ipad|ipod/i.test(userAgent)) return true;
  return platform === "MacIntel" && maxTouchPoints > 1;
}

export type InstallGuide = {
  title: string;
  steps: string[];
};

export function installGuide(kind: "ios" | "browser", systemName: string): InstallGuide {
  const title = `Install ${systemName}`;
  if (kind === "ios") {
    return {
      title,
      steps: [
        "Open this site in Safari.",
        "Tap Share.",
        "Tap Add to Home Screen, then Add.",
      ],
    };
  }
  return {
    title,
    steps: [
      "Open the browser menu, or use the install icon in the address bar.",
      "Choose Install.",
      "Open the icon from your home screen or app list. It uses the same account as this site.",
    ],
  };
}
