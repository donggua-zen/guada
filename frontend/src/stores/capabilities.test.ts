import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const fetchCapabilities = vi.fn();

vi.mock("@/services/ApiService", () => ({
  apiService: {
    fetchCapabilities: (...args: unknown[]) => fetchCapabilities(...args),
  },
}));

import { useCapabilitiesStore } from "./capabilities";
import { ALL_SANDBOX_MODES } from "@/utils/sandboxMode";

describe("useCapabilitiesStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    fetchCapabilities.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("Windows 能力返回后只保留两档，并把 read-only 归一化", async () => {
    fetchCapabilities.mockResolvedValue({
      platform: "win32",
      sandboxModes: ["workspace-write", "danger-full-access"],
    });

    const store = useCapabilitiesStore();
    await store.ensureLoaded();

    expect(store.sandboxModes).toEqual([
      "workspace-write",
      "danger-full-access",
    ]);
    expect(store.isSupported("read-only")).toBe(false);
    expect(store.normalize("read-only")).toBe("workspace-write");
  });

  it("macOS / Linux 保留三档", async () => {
    fetchCapabilities.mockResolvedValue({
      platform: "darwin",
      sandboxModes: [...ALL_SANDBOX_MODES],
    });

    const store = useCapabilitiesStore();
    await store.ensureLoaded();

    expect(store.sandboxModes).toEqual([...ALL_SANDBOX_MODES]);
    expect(store.normalize("read-only")).toBe("read-only");
  });

  it("能力请求失败时回退三档（执行侧后端仍会归一化）", async () => {
    fetchCapabilities.mockRejectedValue(new Error("offline"));

    const store = useCapabilitiesStore();
    await store.ensureLoaded();

    expect(store.sandboxModes).toEqual([...ALL_SANDBOX_MODES]);
  });

  it("能力返回空列表时按平台回退", async () => {
    fetchCapabilities.mockResolvedValue({
      platform: "win32",
      sandboxModes: [],
    });

    const store = useCapabilitiesStore();
    await store.ensureLoaded();

    expect(store.sandboxModes).toEqual([
      "workspace-write",
      "danger-full-access",
    ]);
  });

  it("并发 ensureLoaded 只发一次请求", async () => {
    fetchCapabilities.mockResolvedValue({
      platform: "linux",
      sandboxModes: [...ALL_SANDBOX_MODES],
    });

    const store = useCapabilitiesStore();
    await Promise.all([store.ensureLoaded(), store.ensureLoaded()]);

    expect(fetchCapabilities).toHaveBeenCalledTimes(1);
  });

  it("请求失败后下一次 ensureLoaded 会重试", async () => {
    fetchCapabilities
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({
        platform: "win32",
        sandboxModes: ["workspace-write", "danger-full-access"],
      });

    const store = useCapabilitiesStore();
    await store.ensureLoaded();
    expect(fetchCapabilities).toHaveBeenCalledTimes(1);
    expect(store.sandboxModes).toEqual([...ALL_SANDBOX_MODES]);

    await store.ensureLoaded();
    expect(fetchCapabilities).toHaveBeenCalledTimes(2);
    expect(store.sandboxModes).toEqual([
      "workspace-write",
      "danger-full-access",
    ]);
  });
});
