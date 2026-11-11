import { describe, expect, it } from "vitest";
import { installGuide, installShortName, isIosInstallTarget, isIosSafari, isStandaloneDisplay } from "./prompt";

describe("install prompt", () => {
  it("keeps a short name that fits a home screen", () => {
    expect(installShortName("CareCircle MindTogether")).toBe("CareCircle");
    expect(installShortName("BrainHealth Connect")).toBe("BrainHealth");
    expect(installShortName("Hope Health")).toBe("Hope Health");
    expect(installShortName("Supercalifragilistic Clinic")).toBe("Supercalifra");
  });

  it("treats an installed window and an iPhone as install targets", () => {
    expect(isStandaloneDisplay({ displayModeStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ displayModeStandalone: false })).toBe(false);
    expect(isIosInstallTarget("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIosInstallTarget("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIosInstallTarget("Mozilla/5.0", 5, "MacIntel")).toBe(true);
    expect(isIosInstallTarget("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
    expect(isIosInstallTarget("Mozilla/5.0 (Windows NT 10.0)")).toBe(false);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")).toBe(true);
    expect(isIosSafari("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0.6099.119 Mobile/15E148 Safari/604.1")).toBe(false);
  });

  it("explains Safari and other browsers without sending the person off the site", () => {
    const ios = installGuide("ios", "CareCircle MindTogether");
    const browser = installGuide("browser", "CareCircle MindTogether");
    expect(ios.title).toBe("Install CareCircle MindTogether");
    expect(ios.steps.join(" ")).toContain("Add to Home Screen");
    expect(browser.steps.join(" ")).toContain("Choose Install");
    expect(browser.steps.join(" ")).toContain("same account");
  });
});
