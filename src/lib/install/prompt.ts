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

const IOS_OTHER_BROWSER = /crios|fxios|edgios|opios|duckduckgo|instagram|fbav|fban|fb_iab|whatsapp|micromessenger|tiktok/i;

/** Safari can add the site to the home screen. Chrome and in-app browsers on iPhone cannot. */
export function isIosSafari(userAgent: string, maxTouchPoints = 0, platform = ""): boolean {
  return isIosInstallTarget(userAgent, maxTouchPoints, platform) && !IOS_OTHER_BROWSER.test(userAgent);
}

export type InstallGuide = {
  title: string;
  steps: string[];
};

export function installGuide(kind: "ios" | "ios-other" | "browser", systemName: string): InstallGuide {
  const title = `Install ${systemName}`;
  if (kind === "ios") {
    return {
      title,
      steps: [
        "Tap Share at the bottom of Safari. It is the square with an arrow.",
        "Scroll the list and tap Add to Home Screen.",
        "Tap Add. The icon then opens from your home screen.",
      ],
    };
  }
  if (kind === "ios-other") {
    return {
      title,
      steps: [
        "Open this page in Safari. In Chrome, tap the menu, then Open in Safari.",
        "Tap Share at the bottom of Safari.",
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
