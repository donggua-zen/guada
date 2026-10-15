import {
  parseContainerInspect,
  parseImageInspect,
  mapContainerPlatform,
  buildDockerArgs,
  versionAtLeast,
  MIN_AGENT_VERSION_FOR_CONTAINER,
  DOCKER_AGENT_DIR_CANDIDATES,
} from "./docker-agent-connect";

/**
 * docker-agent-connect 纯函数测试：
 * inspect 输出解析、平台映射（选二进制）、docker CLI 参数组装、版本下限判定。
 */
describe("docker-agent-connect 纯函数", () => {
  describe("parseContainerInspect", () => {
    it("解析 Running/Image/WorkingDir/Name（Name 去掉前导 /）", () => {
      const raw = "true|sha256:abc123|/workspace|/guada-dev\n";
      expect(parseContainerInspect(raw)).toEqual({
        running: true,
        image: "sha256:abc123",
        workingDir: "/workspace",
        name: "guada-dev",
      });
    });

    it("未运行时 running=false；WorkingDir 为空回退 /", () => {
      const r = parseContainerInspect("false|sha256:x||/c1");
      expect(r.running).toBe(false);
      expect(r.workingDir).toBe("/");
      expect(r.name).toBe("c1");
    });

    it("多行输出只取首行", () => {
      const r = parseContainerInspect("true|img|/a|/c\nnoise|line");
      expect(r.image).toBe("img");
      expect(r.name).toBe("c");
    });
  });

  describe("parseImageInspect", () => {
    it("解析 Os/Architecture（小写归一）", () => {
      expect(parseImageInspect("Linux|AMD64")).toEqual({ os: "linux", arch: "amd64" });
    });
  });

  describe("mapContainerPlatform", () => {
    it("linux/amd64 与 linux/arm64 映射到对应二进制", () => {
      expect(mapContainerPlatform("linux", "amd64")).toEqual({ ok: true, goArch: "amd64" });
      expect(mapContainerPlatform("linux", "arm64")).toEqual({ ok: true, goArch: "arm64" });
      expect(mapContainerPlatform("linux", "x86_64")).toEqual({ ok: true, goArch: "amd64" });
      expect(mapContainerPlatform("linux", "aarch64")).toEqual({ ok: true, goArch: "arm64" });
    });

    it("Windows 容器明确拒绝（agent 为 POSIX 二进制）", () => {
      const r = mapContainerPlatform("windows", "amd64");
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.reason).toContain("Windows");
    });

    it("其它架构（如 arm/v7）明确拒绝", () => {
      const r = mapContainerPlatform("linux", "arm");
      expect(r.ok).toBe(false);
      if (r.ok === false) expect(r.reason).toContain("arm");
    });
  });

  describe("buildDockerArgs", () => {
    it("未配置 dockerHost 时直传参数", () => {
      expect(buildDockerArgs({}, ["ps"])).toEqual(["ps"]);
    });

    it("配置 dockerHost 时前置 -H", () => {
      expect(buildDockerArgs({ dockerHost: "tcp://1.2.3.4:2375" }, ["exec", "-i", "c", "x"])).toEqual([
        "-H",
        "tcp://1.2.3.4:2375",
        "exec",
        "-i",
        "c",
        "x",
      ]);
    });
  });

  describe("versionAtLeast（容器最低版本判定）", () => {
    it("下限常量与比较语义", () => {
      expect(MIN_AGENT_VERSION_FOR_CONTAINER).toBe("0.6.0");
      expect(versionAtLeast("0.6.0", MIN_AGENT_VERSION_FOR_CONTAINER)).toBe(true);
      expect(versionAtLeast("0.6.1", MIN_AGENT_VERSION_FOR_CONTAINER)).toBe(true);
      expect(versionAtLeast("0.5.1", MIN_AGENT_VERSION_FOR_CONTAINER)).toBe(false);
      expect(versionAtLeast("0.4.10", MIN_AGENT_VERSION_FOR_CONTAINER)).toBe(false);
      expect(versionAtLeast("1.0.0", "0.99.99")).toBe(true);
      expect(versionAtLeast("0.6", "0.6.0")).toBe(true);
    });

    it("空/异常版本按 0 处理（不满足下限）", () => {
      expect(versionAtLeast("", MIN_AGENT_VERSION_FOR_CONTAINER)).toBe(false);
      expect(versionAtLeast("abc", MIN_AGENT_VERSION_FOR_CONTAINER)).toBe(false);
    });
  });

  it("安装目录候选：/tmp 优先，全部为容器内绝对路径", () => {
    expect(DOCKER_AGENT_DIR_CANDIDATES[0]).toBe("/tmp");
    expect(DOCKER_AGENT_DIR_CANDIDATES.every((p) => p.startsWith("/"))).toBe(true);
  });
});
