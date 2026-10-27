import { describe, expect, it } from "vitest";
import {
  ALL_SANDBOX_MODES,
  isSandboxMode,
  normalizeSandboxMode,
  supportedSandboxModes,
} from "./sandboxMode";

describe("sandboxMode 平台收敛", () => {
  it("词表仍是三档（历史会话/排队消息兼容）", () => {
    expect(ALL_SANDBOX_MODES).toEqual([
      "read-only",
      "workspace-write",
      "danger-full-access",
    ]);
  });

  it("Windows 只提供两档", () => {
    expect(supportedSandboxModes("win32")).toEqual([
      "workspace-write",
      "danger-full-access",
    ]);
  });

  it("macOS / Linux 保留三档", () => {
    expect(supportedSandboxModes("darwin")).toEqual([...ALL_SANDBOX_MODES]);
    expect(supportedSandboxModes("linux")).toEqual([...ALL_SANDBOX_MODES]);
    expect(supportedSandboxModes(null)).toEqual([...ALL_SANDBOX_MODES]);
  });

  it("Windows 上 read-only 归一化为 workspace-write", () => {
    expect(normalizeSandboxMode("read-only", "win32")).toBe("workspace-write");
    expect(normalizeSandboxMode("danger-full-access", "win32")).toBe(
      "danger-full-access",
    );
  });

  it("非 Windows 保留 read-only", () => {
    expect(normalizeSandboxMode("read-only", "darwin")).toBe("read-only");
    expect(normalizeSandboxMode("read-only", "linux")).toBe("read-only");
  });

  it("未知值回退 workspace-write", () => {
    expect(normalizeSandboxMode("yolo", "linux")).toBe("workspace-write");
    expect(normalizeSandboxMode(undefined, "win32")).toBe("workspace-write");
    expect(isSandboxMode("yolo")).toBe(false);
    expect(isSandboxMode("read-only")).toBe(true);
  });
});
