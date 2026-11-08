import { PluginApiImpl } from "./plugin-api";
import { PluginRegistry } from "../registry/plugin-registry";

describe("PluginApi.startJob", () => {
  const id = "job-plugin";

  afterEach(() => {
    PluginRegistry.clearPlugin(id);
  });

  function makeApi(jobRegistry?: any) {
    return new PluginApiImpl(
      id,
      "Job Plugin",
      undefined,
      undefined,
      "user",
      undefined,
      { pluginDir: "/tmp/plugin", dataDir: "/tmp/data" },
      undefined,
      undefined,
      jobRegistry,
    );
  }

  function jobDef() {
    return {
      label: "render frames",
      logFilePath: "/tmp/data/jobs/x.log",
      read: async () => ({
        text: "ok",
        offset: 0,
        nextOffset: 2,
        size: 2,
        truncated: false,
      }),
      cancel: () => undefined,
      done: Promise.resolve({ status: "completed" as const, exitCode: 0 }),
    };
  }

  it("registers a shell-kind job with the given session", () => {
    const calls: any[] = [];
    const api = makeApi({
      start: (spec: any) => {
        calls.push(spec);
        return "job-1";
      },
    });

    const jobId = api.startJob(jobDef(), "session-1");
    expect(jobId).toBe("job-1");
    expect(calls).toHaveLength(1);
    expect(calls[0].kind).toBe("shell");
    expect(calls[0].sessionId).toBe("session-1");
    expect(calls[0].label).toBe("render frames");
    expect(calls[0].logFilePath).toBe("/tmp/data/jobs/x.log");
  });

  it("falls back to the injected session when no argument is given", () => {
    const calls: any[] = [];
    const api = makeApi({ start: (spec: any) => calls.push(spec) && "job-2" });
    api.setJobSession("session-2");
    api.startJob(jobDef());
    expect(calls[0].sessionId).toBe("session-2");
  });

  it("rejects without any session context", () => {
    const api = makeApi({ start: () => "job-3" });
    expect(() => api.startJob(jobDef())).toThrow(/session context/);
  });

  it("rejects when the host has no job registry", () => {
    const api = makeApi(undefined);
    expect(() => api.startJob(jobDef(), "session-1")).toThrow(/not available/);
  });

  it("validates the job definition", () => {
    const api = makeApi({ start: () => "job-4" });
    expect(() =>
      api.startJob({ label: "x", read: undefined as any, cancel: () => undefined, done: Promise.resolve({ status: "completed" }) } as any, "s"),
    ).toThrow(/read and cancel/);
    expect(() =>
      api.startJob({ label: "x", read: async () => ({ text: "", offset: 0, nextOffset: 0, size: 0, truncated: false }), cancel: () => undefined } as any, "s"),
    ).toThrow(/done promise/);
  });
});
