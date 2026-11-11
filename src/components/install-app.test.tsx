/** @vitest-environment happy-dom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InstallApp } from "./install-app";

const { state, prompt } = vi.hoisted(() => ({
  state: { ready: true, standalone: false, ios: false, canPrompt: true },
  prompt: vi.fn(async () => "accepted" as const),
}));

vi.mock("@/lib/install/store", () => ({
  useInstallState: () => state,
  promptInstall: () => prompt(),
  shareInstall: async () => "unavailable" as const,
}));

describe("install control", () => {
  beforeEach(() => {
    state.ready = true;
    state.standalone = false;
    state.ios = false;
    state.canPrompt = true;
    prompt.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("uses the browser install prompt when the browser offers one", async () => {
    render(<InstallApp systemName="CareCircle MindTogether" />);
    await userEvent.click(screen.getByRole("button", { name: "Install CareCircle MindTogether" }));
    expect(prompt).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the Safari steps on an iPhone", async () => {
    state.canPrompt = false;
    state.ios = true;
    render(<InstallApp systemName="CareCircle MindTogether" placement="menu" />);
    await userEvent.click(screen.getByRole("button", { name: "Install CareCircle MindTogether" }));
    const dialog = screen.getByRole("dialog", { name: "Install CareCircle MindTogether" });
    expect(dialog.textContent).toContain("Add to Home Screen");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("stays hidden after the app is already installed", () => {
    state.standalone = true;
    render(<InstallApp systemName="CareCircle MindTogether" />);
    expect(screen.queryByRole("button", { name: /Install/ })).toBeNull();
  });
});
